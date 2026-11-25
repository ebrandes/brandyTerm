# Artifact Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cards for files a thread created/edited, inline Mermaid diagrams, and a full-screen overlay that renders Markdown, Mermaid, HTML/SVG and code inside BrandyTerm.

**Architecture:** Adapters emit a new `file` event; `thread-events.ts` keeps a deduplicated `Thread.files` list. The main process reads artifacts through a guarded IPC (`artifact:read`) and serves HTML/SVG/images through a new `brandy-art://` scheme limited to project folders. The renderer shows `ArtifactCards`, routes `mermaid` code blocks to a lazily loaded `MermaidBlock`, and opens `ArtifactViewer` as an overlay.

**Tech Stack:** Electron 33, React, TypeScript, react-markdown (existing `Rich`), `mermaid` (new dependency, dynamic import), Node's built-in test runner (`node --test`, Node 26 runs `.ts` directly).

**Spec:** `docs/superpowers/specs/2026-11-24-artifact-viewer-design.md`

## Global Constraints

- No code file above 400 lines; split by responsibility. `src/main/index.ts` (202) and `src/renderer/src/components/Chat.tsx` (332) must stay under 400 after edits.
- Raw HTML never goes into `Rich` (no `rehype-raw`).
- Nothing outside the thread's project folder is read or served; symlinks resolved with `realpathSync` before the check.
- Artifact read cap: 2 MB (`MAX_ARTIFACT = 2 * 1024 * 1024`).
- HTML/SVG iframe: `sandbox=""` (no `allow-scripts`, no `allow-same-origin`); scheme response CSP exactly `default-src 'none'; img-src brandy-art: data:; style-src 'unsafe-inline'`.
- Mermaid: `securityLevel: 'strict'`, loaded only by `import('mermaid')` on first use.
- UI copy in Brazilian Portuguese, like the rest of the app.
- Pure logic lives in Electron-free files so `node --test` can import it.

## Review Focus

1. A path that escapes the project via `..` or a symlink pointing outside: read and scheme must refuse (404 / error), not serve. Tests in Task 2.
2. A file the thread wrote and later deleted (or moved): card shows greyed, does not open; the read returns `{ kind: 'missing' }` instead of throwing. Tests in Task 2.
3. Same file written then edited several times: exactly one card, op of the last event. Test in Task 1.
4. Invalid Mermaid syntax in an answer: the plain code block still renders (no blank space, no thrown error). Covered by Task 5 Step 3 manual check.
5. A project without a path (demo project): no cards, no IPC calls, no crash. Test in Task 1 (`applyThreadEvent` with `p.path` undefined ignores the event).

---

### Task 1: Capture written/edited files on the thread

**Files:**
- Create: `src/main/artifact-files.ts` (pure, no Electron)
- Create: `src/main/artifact-files.test.ts`
- Modify: `src/main/adapters/types.ts` (AgentEvent union)
- Modify: `src/main/adapters/claude-events.ts` (`toolUse`)
- Modify: `src/main/adapters/codex.ts:85-87`
- Modify: `src/main/thread-events.ts`
- Modify: `src/shared/types.ts` (`Thread`)
- Modify: `package.json` (`"test": "node --test src/**/*.test.ts"`)

**Interfaces:**
- Produces: `AgentEvent` member `{ kind: 'file'; path: string; op: 'write' | 'edit' }`
- Produces: `interface ThreadFile { path: string; op: 'write' | 'edit'; at: string }` in `src/shared/types.ts`; `Thread.files?: ThreadFile[]` (`path` is **relative to the project root**, forward slashes)
- Produces: `fileFromTool(name: string, input: any): { path: string; op: 'write' | 'edit' } | null` — `Write` → write; `Edit`, `MultiEdit`, `NotebookEdit` → edit; path from `input.file_path` (or `input.notebook_path`)
- Produces: `filesFromCodex(item: any): { path: string; op: 'write' | 'edit' }[]` — from `item.changes[]` (`{ path, kind }`, `kind === 'add'` → write, `'delete'` skipped, else edit)
- Produces: `addThreadFile(list: ThreadFile[], root: string, abs: string, op, at: string): ThreadFile[]` — returns the new list; ignores paths outside `root`; dedups by relative path, last op wins, moves the entry to the end; max 50 entries (drop oldest)

- [ ] **Step 1: Write failing tests** in `src/main/artifact-files.test.ts` (`node:test` + `node:assert/strict`):
  - `fileFromTool('Write', { file_path: '/p/a.md' })` → `{ path: '/p/a.md', op: 'write' }`; `'Edit'` → op `'edit'`; `'Bash'` → `null`; missing `file_path` → `null`
  - `filesFromCodex({ changes: [{ path: '/p/x.md', kind: 'add' }, { path: '/p/y.ts', kind: 'update' }, { path: '/p/z', kind: 'delete' }] })` → two entries, write then edit
  - `addThreadFile([], '/p', '/p/docs/a.md', 'write', t1)` → `[{ path: 'docs/a.md', op: 'write', at: t1 }]`
  - adding `/p/docs/a.md` again with `'edit'` → one entry, op `'edit'`
  - `/etc/passwd` and `/p/../q/a.md` with root `/p` → list unchanged
- [ ] **Step 2: Run** `npm test` — Expected: FAIL (module not found)
- [ ] **Step 3: Implement** `src/main/artifact-files.ts`; use `path.relative` and reject results starting with `..` or absolute.
- [ ] **Step 4: Wire it:** in `claude-events.ts` `toolUse`, before the final `activity` branch's emit, call `fileFromTool` and emit `{ kind: 'file', ... }` in addition to the activity (keep the activity). In `codex.ts`, on `file_change` with `ev.type === 'item.completed'`, emit one `file` event per `filesFromCodex(it)`. In `applyThreadEvent`, `kind === 'file'`: if `!p.path` return false; else `t.files = addThreadFile(t.files ?? [], p.path, e.path, e.op, now.toISOString())`, return true.
- [ ] **Step 5: Add test** in `artifact-files.test.ts` importing `applyThreadEvent` with a minimal `Project`/`Thread` object: project without `path` → returns `false`, `t.files` stays undefined.
- [ ] **Step 6: Run** `npm test && npm run typecheck` — Expected: all pass, no type errors
- [ ] **Step 7: Commit** `feat: record files a thread writes or edits`

### Task 2: Guarded artifact read and `brandy-art://` scheme

**Files:**
- Create: `src/main/artifact-read.ts` (pure: path guard, kind detection, read)
- Create: `src/main/artifact-read.test.ts`
- Create: `src/main/artifact-ipc.ts` (Electron: scheme + IPC registration)
- Modify: `src/main/index.ts` (register scheme before ready, IPC after ready — next to `registerAttachmentScheme`/`registerAttachmentIpc`)
- Modify: `src/preload/index.ts` and the `BrandyApi` type

**Interfaces:**
- Produces: `type ArtifactKind = 'md' | 'mermaid' | 'html' | 'svg' | 'code'`
- Produces: `artifactKind(path: string): { kind: ArtifactKind; lang?: string }` — `.md/.markdown` → md; `.mmd/.mermaid` → mermaid; `.html/.htm` → html; `.svg` → svg; otherwise code with `lang` = extension (`ts`, `py`, …)
- Produces: `resolveInside(root: string, rel: string): string | null` — `realpathSync` on both; null if outside root or missing
- Produces: `readArtifact(root: string, rel: string): ArtifactContent` where `type ArtifactContent = { kind: 'missing' } | { kind: 'too-big'; size: number } | { kind: ArtifactKind; text: string; lang?: string }` (put `ArtifactContent` in `src/shared/types.ts`)
- Produces IPC: `artifact:read` `({ projectId: string; path: string }) => ArtifactContent`; `artifact:open` `({ projectId, path }) => void` (`shell.openPath` after `resolveInside`)
- Produces preload: `window.brandy.readArtifact(a)`, `window.brandy.openArtifact(a)`
- Produces scheme URL: `brandy-art://p/<projectId>/<url-encoded relative path>`; responses carry header `Content-Security-Policy` (value in Global Constraints); unknown project or `resolveInside` null → 404
- Consumes: project root via `engine.state.projects.find((p) => p.id === projectId)?.path` (pass a `rootOf(id): string | undefined` callback into `registerArtifactIpc`)

- [ ] **Step 1: Write failing tests** in `artifact-read.test.ts`, using a temp dir from `mkdtempSync`:
  - `artifactKind('a/b.md').kind === 'md'`, `'x.mmd'` → mermaid, `'x.HTML'` → html (case-insensitive), `'x.ts'` → `{ kind: 'code', lang: 'ts' }`
  - `resolveInside(root, 'docs/a.md')` → absolute real path; `'../outside.md'` → null; symlink inside root pointing to a file outside → null; missing file → null
  - `readArtifact(root, 'gone.md')` → `{ kind: 'missing' }`; a 2 MB + 1 byte file → `{ kind: 'too-big', size: 2097153 }`; a `.md` file → `{ kind: 'md', text }`
- [ ] **Step 2: Run** `npm test` — Expected: FAIL
- [ ] **Step 3: Implement** `artifact-read.ts` (size via `statSync` before reading).
- [ ] **Step 4: Implement** `artifact-ipc.ts`: `registerArtifactScheme()` (privileged: `standard`, `secure`, `supportFetchAPI`) and `registerArtifactIpc(rootOf)`; scheme handler reads with `net.fetch(pathToFileURL(abs))` and re-wraps the response adding the CSP header. Wire into `index.ts` and preload.
- [ ] **Step 5: Run** `npm test && npm run typecheck` — Expected: pass
- [ ] **Step 6: Commit** `feat: guarded artifact read and brandy-art scheme`

### Task 3: Artifact viewer overlay

**Files:**
- Create: `src/renderer/src/components/ArtifactViewer.tsx`
- Create: `src/renderer/src/components/artifact.css`
- Create: `src/renderer/src/artifacts.ts` (open/close store)
- Modify: `src/renderer/src/App.tsx` (mount `<ArtifactViewer />` once)

**Interfaces:**
- Consumes: `window.brandy.readArtifact`, `window.brandy.openArtifact`, `ArtifactContent` (Task 2); `Rich` (existing); `MermaidBlock` (Task 4 — until then the mermaid kind renders as a code block; Task 4 swaps it)
- Produces: `openArtifact(target: ArtifactTarget): void` and `useArtifact(): ArtifactTarget | null` in `artifacts.ts`, where `type ArtifactTarget = { projectId: string; path: string } | { inline: 'mermaid'; code: string }` (a tiny subscribe/notify store, no new library)

- [ ] **Step 1: Implement the store** `artifacts.ts` (`openArtifact`, `closeArtifact`, `useArtifact` via `useSyncExternalStore`).
- [ ] **Step 2: Implement `ArtifactViewer`:** full-screen overlay (`role="dialog"`, `aria-modal`), closes on Esc and on backdrop click; header with file name, relative path, buttons "Copiar caminho" and "Abrir no app padrão" (`openArtifact` IPC; hidden for inline targets). Body by kind: `md` → `<Rich text>` with `img` resolved to `brandy-art://p/<projectId>/<dir of file>/<src>` for relative `src`; `html`/`svg` → `<iframe sandbox="" src="brandy-art://…">`; `code` → existing `CodeBlock` with `lang`; `missing` → "O arquivo não existe mais."; `too-big` → "Arquivo grande demais para pré-visualizar (X MB)" plus the open button.
- [ ] **Step 3: Verify** `npm run typecheck` — Expected: no errors. Temporarily call `openArtifact({ projectId, path: 'README.md' })` from the dev console (`npm run dev`) and check: Markdown renders, Esc closes, backdrop click closes.
- [ ] **Step 4: Commit** `feat: artifact viewer overlay`

### Task 4: Inline Mermaid

**Files:**
- Create: `src/renderer/src/components/MermaidBlock.tsx`
- Modify: `src/renderer/src/components/CodeBlock.tsx` (`PreBlock`)
- Modify: `src/renderer/src/components/ArtifactViewer.tsx` (mermaid kind + inline target)
- Modify: `package.json` (add `mermaid`)

**Interfaces:**
- Consumes: `openArtifact` (Task 3)
- Produces: `MermaidBlock({ code: string; large?: boolean; fallback: ReactNode })` — renders the SVG from `mermaid.render(id, code)`; on parse error renders `fallback`; when not `large`, click calls `openArtifact({ inline: 'mermaid', code })`

- [ ] **Step 1: Install** `npm install mermaid` — Expected: added to dependencies.
- [ ] **Step 2: Implement `MermaidBlock`:** module-level `let loader: Promise<typeof import('mermaid')> | null`; initialize once with `{ startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default' }` (dark from `matchMedia('(prefers-color-scheme: dark)')`, matching how the app themes). Insert the SVG string returned by `render` (strict mode sanitizes it). In `PreBlock`, `lang === 'mermaid'` → `<MermaidBlock code fallback={<CodeBlock …/>} />`. In the viewer, `mermaid` kind and inline targets → `<MermaidBlock large />`.
- [ ] **Step 3: Verify** with `npm run dev`: send the coordinator a message asking it to reply with a small ```` ```mermaid ```` flowchart; it renders inline; clicking opens it in the overlay; a block with invalid syntax shows as plain code. Check DevTools Network: the mermaid chunk loads only after the first diagram.
- [ ] **Step 4: Run** `npm run typecheck && npm run build` — Expected: pass
- [ ] **Step 5: Commit** `feat: render mermaid diagrams inline`

### Task 5: Artifact cards in the chat and thread view

**Files:**
- Create: `src/renderer/src/components/ArtifactCards.tsx`
- Modify: `src/renderer/src/components/Chat.tsx` (summary item ~line 128, thread view ~line 304)
- Modify: `src/renderer/src/components/artifact.css`

**Interfaces:**
- Consumes: `Thread.files` (Task 1), `openArtifact` (Task 3)
- Produces: `ArtifactCards({ projectId: string; files: ThreadFile[] })` — renders nothing for an empty list

- [ ] **Step 1: Implement `ArtifactCards`:** one card per file, styled like `.tray-file` in `MessageFiles`: lucide icon by kind (`FileText` md, `Workflow` mermaid, `Globe` html, `Image` svg, `FileCode` code), file name, relative path dim, a small "criado"/"editado" tag. On click, call `readArtifact`; if the result is `missing`, mark the card greyed and disabled (component state) and do not open; otherwise `openArtifact({ projectId, path })`. (Your call, recorded: missing files are detected on click, not on mount, to avoid reading every file each render.) Card clicks inside a summary must `stopPropagation` so they do not open the thread.
- [ ] **Step 2: Mount it:** in each summary item with `s.threadId`, look up the thread in `project.threads` and render its files under `.summary-text`; in the thread view, render `<ArtifactCards>` right after `RunPanel`. Skip both when `project.demo || !project.path`.
- [ ] **Step 3: Verify** with `npm run dev`: ask the coordinator for a task that writes `docs/teste.md` with a heading, a table and a mermaid block. When the thread finishes, a card appears in the summary and in the thread view; clicking it shows the formatted Markdown with the diagram; delete the file in the terminal, click again → card turns grey with "O arquivo não existe mais."
- [ ] **Step 4: Run** `npm test && npm run typecheck && wc -l src/renderer/src/components/Chat.tsx src/main/index.ts` — Expected: pass, both under 400 lines
- [ ] **Step 5: Commit** `feat: artifact cards for files threads write`
