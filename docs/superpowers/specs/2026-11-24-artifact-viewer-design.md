# Artifact viewer (cards + overlay)

## Intent

Quick reading, inside BrandyTerm, of what the agents produce: a `.md` a thread
wrote, a diagram, an HTML page. Today a file either is not surfaced at all or
opens in the OS default app. Goal: click a card, read it nicely formatted, Esc,
back to the chat.

## Goals

- A card for every file a thread **created or edited** (Write/Edit tool events).
- ```` ```mermaid ```` blocks in any agent answer render as a diagram in place.
- Clicking a card or a diagram opens a **full-screen overlay**, closed with Esc
  or a click outside.
- Overlay renders by type: Markdown (formatted), Mermaid (`.mmd`/`.mermaid`),
  HTML and SVG (static), anything else as highlighted code.

## Non-goals

- Cards from file paths merely mentioned in the text.
- Editing, live reload, version history.
- Running scripts in HTML artifacts (they render static).
- Side panel or separate window.

## Anti-goals

- Agent output must never run code with access to the app (Node, preload, IPC).
- No reading files outside the thread's project folder.

## Approaches considered

- **Where the viewer opens:** side panel (keeps the chat visible), overlay
  (simplest, chat hidden), separate window (multi-monitor, more to manage).
  **Picked: overlay**, by the user, because the use is a quick read.
- **What makes a card:** files written/edited by the thread (reliable), any path
  in the text (more coverage, false positives), inline mermaid blocks
  (complement). **Picked: written/edited files + inline mermaid**, by the user.

## Design

**Capturing files (main).** A new `AgentEvent` `{ kind: 'file'; path; op: 'write' | 'edit' }`.
`claude-events.ts` emits it from `toolUse` for `Write`, `Edit`, `MultiEdit` and
`NotebookEdit` (`input.file_path`). `codex.ts` emits it from `file_change` items
(each changed path). `thread-events.ts` keeps a deduplicated `files` list on the
thread (last op wins), only for paths inside the project folder.

**Cards (renderer).** Under the thread's report in the chat and in the thread
view: one small card per file — icon by extension, file name, relative path.
Deleted files show greyed and do not open.

**Reading (main).** IPC `artifact:read({ projectId, path })`: resolves the real
path (symlinks included), refuses anything outside the project root, caps at
2 MB, returns `{ kind: 'md' | 'mermaid' | 'html' | 'svg' | 'code', text, lang? }`.

**HTML/SVG.** Served by a new `brandy-art://` scheme limited to project folders,
with a strict CSP (`default-src 'none'; img-src brandy-art: data:; style-src 'unsafe-inline'`),
inside `<iframe sandbox="">` (no `allow-scripts`, no same-origin).

**Mermaid.** `mermaid` loaded with a dynamic import on the first diagram,
`securityLevel: 'strict'`, theme following the app. `PreBlock` routes
`language-mermaid` to a `MermaidBlock`; a parse error falls back to the plain
code block. Clicking the diagram opens it larger in the overlay.

**Overlay.** `ArtifactViewer`: header with name, relative path, copy-path and
"open in default app"; body by kind (`Rich` for Markdown, `MermaidBlock`, iframe,
highlighted code). Relative images inside a Markdown file resolve via `brandy-art://`.

## Constraints

- No code file above 400 lines; split by responsibility.
- Raw HTML stays out of `Rich` (no `rehype-raw`).

## Left to the builder

File/component layout, card styling consistent with `MessageFiles`, overlay
animation, extension-to-icon map.
