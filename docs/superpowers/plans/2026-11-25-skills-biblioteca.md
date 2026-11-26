# Skills por projeto (biblioteca, catálogo, lista) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each brandyTerm project gets its own versioned skills list (`.brandyterm/skills.json`). Lists point at a private library (`ebrandes/claude-kit/biblioteca`). The panel turns items on per project, and `/skill-init`, `/skill-refresh` and `/skill-install` propose items and install them, with an approval card for each item.

**Architecture:** A new `src/main/skills/` folder holds pure modules that take explicit paths and never import electron: catalog, list, count, resolver, per-project plugin dir, library git, origin/staging, signals, prompts and handler. A thin wiring file connects them to the engine. `userPluginDirs` reads the project list when one exists and falls back to today's behaviour when it doesn't.

The `/skill-*` commands are app commands. Main builds a prompt and starts a Claude thread. The thread acts only through new `skills_*` tools on the existing per-thread MCP gateway. Main routes those tools to the skills handler, which asks for approval through `engine.approvals` (connector cards, so "permitir tudo" never skips them).

**Tech Stack:** Electron + TypeScript, React renderer, `node --test` (Node 26 runs TS directly), `git` and `claude` CLIs, and `gh` for repo metadata.

**Spec:** `docs/superpowers/specs/2026-11-25-skills-biblioteca-design.md`

## Global Constraints

- No code file over 400 lines; split by responsibility. `engine.ts` is at 389, so it gets at most a few lines of wiring.
- All UI text, prompts and card copy in pt-BR.
- Mac and Windows: no absolute path in any synced file (`skills.json`, `catalogo.json`, `origem.json`). Folder links are `symlink(..., 'dir')` on darwin and `'junction'` on win32, the same way `personalDir()` does it.
- The brandyTerm repo is public. Library content never goes into it, and neither do test fixtures copied from real skills.
- Items with `corporativo: true` (for example `vivo@claude-kit-private`): the name may appear in a project list, but their files are never copied, staged, scanned off-machine or pushed anywhere.
- Work goes on `main`, in commits separated by subject (`feat(skills): …`). Every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push; the user pushes everything together later.
- Projects without a list keep exactly today's behaviour (`thread-plugins.json` + "pessoal").
- An item outside the catalog is never installed or copied without the claude-security scan. A blocked scan stops everything and shows the reason.
- Tests: `node --test "src/**/*.test.ts"`. Typecheck: `npx tsc --noEmit -p tsconfig.json`. Both green before every commit.

## Review Focus

1. **Broken or hand-edited `skills.json` / `catalogo.json`** (bad JSON, a missing field, an unknown id). The thread still starts with the fallback set, and the panel shows "lista inválida". No crash and no empty plugin set. Test in Task 2.
2. **A project path with spaces, accents or Windows separators** produces a stable hash dir, and the links resolve. Running twice yields the same dir and drops stale links. Test in Task 4.
3. **Library clone absent or `git pull` offline.** Without a clone, list skills count as missing ("falta instalar") and the threads still start. With a stale clone, it stays in use and a warning appears once. Test in Task 5.
4. **The `/skill-install` origin forms** `https://github.com/o/r`, `https://github.com/o/r/tree/main/sub`, `o/r`, `o/r/sub`, `o/r.git` and a catalog id all parse. `../`, shell metacharacters and non-GitHub hosts are refused. Test in Task 7.
5. **The thread calls `skills_add` for an id the catalog doesn't know, or calls a skills tool from a non-skills thread.** Both are refused with a pt-BR error; nothing is written and no card appears. Test in Task 8.

---

### Task 0: Commit the pending work first

The shared files (`user-plugins.ts`, `commands.ts`, `app-ipc.ts`, `preload/index.ts`, `Sidebar.tsx`, `types.ts`, `api.ts`, `security.ts`) already carry uncommitted connectors/diag/ask-card edits. Interactive staging isn't available, so commit that work before any skills edit. Then each later commit holds only its own subject.

- [ ] **Step 1:** Run the tests and the typecheck. If either is red, stop and report to the user; never commit red work.
- [ ] **Step 2:** Group `git status` by subject and make one commit per group:
  - `feat(connectors): …` for `src/main/connectors/**`, `src/renderer/src/connectors/**` and `src/shared/connectors.ts`;
  - `feat(diag): …` for `diag-*`, `skill-log.ts` and `connect-diag.ts`;
  - `docs: …` for the ask-card spec and plan.

  A file that mixes subjects goes into the group it changes most, and the commit message names the others.
- [ ] **Step 3:** Commit the skills spec on its own: `docs(skills): desenho da biblioteca e listas por projeto`.
- [ ] **Step 4:** `git status` shows only `.brandyterm/memoria.md` or nothing.

---

### Task 1: Recursive skill count (the "sem skills" bug)

**Files:**
- Create: `src/main/skills/count.ts`, `src/main/skills/count.test.ts`
- Modify: `src/main/user-plugins.ts` (`skillCount` → `countSkills`)

**Interfaces:**
- Produces: `countSkills(pluginDir: string): number`

- [ ] **Step 1: Write the failing tests** (temp dirs):
  - `counts nested skills`: `skills/eng/tdd/SKILL.md` and `skills/prod/x/SKILL.md` → `2`.
  - `prefers plugin.json skills[]`: `.claude-plugin/plugin.json` `{"skills":["./skills/a","./skills/b/c"]}` with both folders holding a `SKILL.md` → `2`. An entry whose folder has no `SKILL.md` isn't counted.
  - `flat layout still works`: `skills/a/SKILL.md` → `1`.
  - `no skills dir` → `0`.
  - `ignores node_modules and .git` under `skills/`.
- [ ] **Step 2:** Run `node --test src/main/skills/count.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement it with a depth-first walk over `skills/` that counts dirs containing `SKILL.md`. Cap the depth at 6.
- [ ] **Step 4:** Replace `skillCount(join(dir,'skills'))` in `inspect()` with `countSkills(dir)`, and leave the personal-dir count as is.
- [ ] **Step 5:** Tests and typecheck PASS.
- [ ] **Step 6:** Commit `fix(skills): contagem recursiva de skills (mattpocock aparecia sem skills)`.

---

### Task 2: Catalog and project list

**Files:**
- Create: `src/main/skills/catalog.ts`, `src/main/skills/project-list.ts`, `src/main/skills/catalog.test.ts`, `src/main/skills/project-list.test.ts`
- Modify: `src/shared/types.ts` (add the shared types below, next to `UserPlugin`)

**Interfaces:**
- Produces (in `src/shared/types.ts`):
  - `CatalogItem { id: string; tipo: 'plugin'|'skill'; descricao: string; tags: string[]; sempre?: boolean; corporativo?: boolean; plataformas?: ('mac'|'win')[]; loja?: string }`. `loja` is my addition: the `dono/repo` used by `claude plugin marketplace add` when the store isn't known yet.
  - `SkillsList { versao: 1; plugins: { id: string; ref?: string }[]; skills: string[]; sem: string[] }`
- Produces (`catalog.ts`):
  - `readCatalog(libRoot: string): { itens: CatalogItem[]; erro?: string }` reads `<libRoot>/biblioteca/catalogo.json`.
  - `upsertCatalog(libRoot: string, item: CatalogItem): void` writes 2-space JSON plus a trailing newline, sorted by id.
  - `itemFor(itens, id): CatalogItem | undefined`
  - `forPlatform(item, platform: NodeJS.Platform): boolean`
- Produces (`project-list.ts`):
  - `listPath(projectPath): string` returns `<p>/.brandyterm/skills.json`.
  - `readList(projectPath): { list: SkillsList | null; erro?: string }`
  - `writeList(projectPath, list): void`
  - `turnOn(list, item: CatalogItem): SkillsList`
  - `turnOff(list, item: CatalogItem): SkillsList`
  - `emptyList(): SkillsList`

- [ ] **Step 1: Write the failing tests:**
  - `readCatalog` on the spec's example returns 5 items. A missing file gives `{itens:[]}` with no `erro`. Bad JSON gives `{itens:[], erro:'catalogo.json inválido'}`. An item without `id` or `tipo` is dropped, and the rest are kept.
  - `forPlatform({plataformas:['mac']}, 'win32') === false`, and with no `plataformas` → `true`.
  - `readList` on a missing file gives `{list:null}`, and bad JSON gives `{list:null, erro:'skills.json inválido'}`. Missing arrays default to `[]`.
  - `turnOn` for a plugin adds `{id}` to `plugins` and removes the id from `sem`. For a skill it adds the id to `skills`. Neither duplicates.
  - `turnOff` on a listed item removes it. On a `sempre` item it adds the id to `sem`.
  - `writeList` then `readList` round-trips, and the written file ends with `\n`.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement. Keep parsing tolerant (validate each field, coerce, drop bad entries), and create `.brandyterm/` on write if needed.
- [ ] **Step 4:** Tests and typecheck PASS.
- [ ] **Step 5:** Commit `feat(skills): catálogo da biblioteca e lista do projeto`.

---

### Task 3: Resolver (what a thread receives)

**Files:**
- Create: `src/main/skills/resolve.ts`, `src/main/skills/resolve.test.ts`

**Interfaces:**
- Consumes: `CatalogItem` and `SkillsList` from Task 2.
- Produces:
  - `resolveProject(i: { list: SkillsList; itens: CatalogItem[]; installed: Map<string, string>; libSkills: Set<string>; platform: NodeJS.Platform }): Resolved`
  - `Resolved { pluginDirs: string[]; skills: string[]; missing: { id: string; tipo: 'plugin'|'skill' }[] }`

  `installed` maps plugin id → install dir. `libSkills` holds the folder names under `biblioteca/skills`.

- [ ] **Step 1: Write the failing tests:**
  - `sempre minus sem`: `kit-core` (sempre, installed) plus `kit-tokens` (sempre, in `sem`) → only kit-core's dir.
  - `list plugins`: an installed plugin → its dir; a plugin that isn't installed → `missing`, not in `pluginDirs`.
  - `skills`: present in `libSkills` → `skills`; absent → `missing` with `tipo:'skill'`.
  - `platform`: a `sempre` item with `plataformas:['win']` on darwin is skipped silently (not in `missing`).
  - `id not in catalog` but installed → still loaded. A plugin listed by the user counts even if the catalog lags.
  - No duplicates when an id is both `sempre` and listed.
- [ ] **Step 2:** FAIL. **Step 3:** Implement as a pure function. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(skills): resolve o que cada thread recebe`.

---

### Task 4: Per-project plugin dir and the `userPluginDirs` rewrite

**Files:**
- Create: `src/main/skills/project-plugin.ts`, `src/main/skills/project-plugin.test.ts`, `src/main/skills/paths.ts`
- Modify: `src/main/user-plugins.ts` (`userPluginDirs`, `scan` exposes `installedMap()`)

**Interfaces:**
- Consumes: `resolveProject` (Task 3), `readList` and `readCatalog` (Task 2).
- Produces:
  - `paths.ts`: `SkillsPaths { userData: string; lib: string; projectSkills: string }` and `skillsPaths(userData: string): SkillsPaths`, where `lib` = `<userData>/biblioteca` and `projectSkills` = `<userData>/project-skills`.
  - `project-plugin.ts`:
    - `projectHash(projectPath: string): string` returns the first 12 hex chars of the sha1 of the `path.resolve`d path, lowercased on win32.
    - `buildProjectPlugin(root: string, projectPath: string, skills: string[], libSkillsDir: string, platform: NodeJS.Platform): string | null`. It returns the plugin dir, or `null` when `skills` is empty.
  - `user-plugins.ts`: `installedMap(): Map<string, string>` maps the plain plugin id (without `#project`) to its dir and prefers a user-scope install. `userPluginDirs(projectPath)` keeps its signature.

- [ ] **Step 1: Write the failing tests:**
  - `builds plugin.json and links`: two skills → `<root>/<hash>/.claude-plugin/plugin.json` with `name: "projeto-<hash>"`, and `skills/a` resolves via `realpathSync` to `libSkillsDir/a`.
  - `idempotent and prunes`: build with `[a,b]`, then `[a]` → `skills/b` is gone and `a` is still a link.
  - `link type`: assert the link kind passed to `symlinkSync`, by injecting `link` as an optional last param (`(target, path, platform) => void`, default real). It should be `'junction'` for `'win32'` and `'dir'` for `'darwin'`.
  - `projectHash` is stable for `'/a/b c/ção'` and differs from `'/a/b'`. On win32, `'C:\\X'` and `'c:\\x'` give the same hash.
  - `empty skills` → `null`, and an existing dir for that hash is removed.
- [ ] **Step 2:** FAIL. **Step 3:** Implement.
- [ ] **Step 4:** Rewrite `userPluginDirs(projectPath)`:
  1. Call `readList(projectPath)`.
  2. If `list` is null, return today's code path unchanged, including when it is null because of `erro` (Review Focus 1).
  3. Otherwise, call `resolveProject` with `installedMap()`, `readCatalog(paths.lib)` and the names under `lib/biblioteca/skills`.
  4. Build the project plugin.
  5. Return `[...pluginDirs, projectPluginDir?]`.

  Personal `~/.claude/skills` is no longer added for projects with a list.
- [ ] **Step 5:** Add the test `src/main/skills/user-dirs.test.ts`. Extract steps 1–5 above into `projectDirs(projectPath, paths: SkillsPaths, installed: Map<string,string>, platform): string[] | null`, which returns `null` meaning "use the fallback", in `src/main/skills/project-dirs.ts`, so it is testable without electron. Test that a project without a list → `null`, that a broken list → `null`, and that a list with one installed plugin plus one library skill → 2 dirs.
- [ ] **Step 6:** Tests and typecheck PASS.
- [ ] **Step 7:** Commit `feat(skills): threads leem a lista do projeto`.

---

### Task 5: Library clone and pull, plus the setting

**Files:**
- Create: `src/main/skills/library.ts`, `src/main/skills/library.test.ts`
- Modify: `src/shared/types.ts` (`AppSettings.skillsLibrary?: string`, which defaults to `'ebrandes/claude-kit'` when unset)

**Interfaces:**
- Produces:
  - `libraryUrl(setting?: string): string` turns `dono/repo` into `https://github.com/dono/repo.git` and passes a full https URL through unchanged.
  - `syncLibrary(url: string, dir: string, git?: GitRun): { ok: boolean; aviso?: string }`, where `GitRun = (args: string[], cwd: string) => { code: number; out: string }`. With no `dir/.git` it runs `git clone --depth 50 <url> <dir>`. Otherwise it runs `git -C dir pull --ff-only`.
  - `commitLibrary(dir: string, message: string, paths: string[], git?: GitRun): boolean`
  - `pushLibrary(dir: string, git?: GitRun): { ok: boolean; erro?: string }`

- [ ] **Step 1: Write the failing tests:**
  - Use a fake `GitRun` that records calls.
  - Clone when absent, and pull when `.git` exists.
  - A pull that fails → `{ok:false, aviso:'Biblioteca sem atualizar (sem rede?): usando a cópia que já existe.'}`, and the dir is untouched.
  - A clone that fails → `{ok:false, aviso:'Biblioteca indisponível: skills da biblioteca ficam como "falta instalar".'}`.
  - `libraryUrl` covers both forms; `'foo'` (no slash) → throws `'biblioteca inválida'`.
  - `commitLibrary` runs `add -- <paths>` and then `commit -m`, and returns `false` when there is nothing to commit.
- [ ] **Step 2:** FAIL. **Step 3:** Implement with `spawnSync('git', …)`. Use `GIT_TERMINAL_PROMPT=0` so it never hangs on credentials. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(skills): clone e atualização da biblioteca`.

---

### Task 6: Install what's missing, and scanning a folder

**Files:**
- Create: `src/main/skills/install.ts`, `src/main/skills/install.test.ts`
- Modify: `src/main/security.ts` (extract `scanDir`)

**Interfaces:**
- Consumes: `CatalogItem` (Task 2), `resolveCli` (`src/main/adapters/proc.ts`), `scanPlugin` (`security.ts`).
- Produces:
  - `security.ts`: `scanDir(src: string, scanner: string): Promise<ScanResult>`. `scanPlugin` becomes `fetchSource` + `scanDir`, with the same behaviour and existing tests still green.
  - `install.ts`: `installPlugin(id: string, o: { item?: CatalogItem; knownMarkets: Set<string>; run: CliRun; scan: (spec: string) => Promise<ScanResult> }): Promise<{ ok: boolean; erro?: string }>`, where `CliRun = (args: string[]) => Promise<{ code: number; out: string }>`.

- [ ] **Step 1: Write the failing tests** (fake `run` and `scan`):
  - A catalog item whose store is known → only `['plugin','install',id,'--scope','user']`, and `scan` is not called.
  - A catalog item whose store is unknown and that has `loja` → `['plugin','marketplace','add',loja]`, then install.
  - An unknown store without `loja` → `{ok:false, erro:'Loja <market> desconhecida: rode /skill-install com o repositório dela.'}`.
  - No `item` (not in the catalog) → `scan` runs first. When it is blocked → `{ok:false, erro:'Bloqueado pela checagem de segurança: <describeCounts>'}`, and install never runs.
  - A corporate item is never scanned. It is in the catalog, so this follows from the first case; assert it explicitly.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. `knownMarkets` comes from the keys of `~/.claude/plugins/known_marketplaces.json`; read it in the wiring, not here. **Step 4:** PASS, including the existing security tests.
- [ ] **Step 5:** Commit `feat(skills): instala o que falta (--scope user)`.

---

### Task 7: Origin parser and staging for `/skill-install`

**Files:**
- Create: `src/main/skills/origin.ts`, `src/main/skills/origin.test.ts`, `src/main/skills/stage.ts`, `src/main/skills/stage.test.ts`

**Interfaces:**
- Produces:
  - `parseOrigin(s: string): Origin | { erro: string }`, where `Origin = { kind: 'github'; owner: string; repo: string; sub?: string } | { kind: 'catalog'; id: string }`
  - `stageOrigin(o: GithubOrigin, stagingRoot: string, git?: GitRun): Staged | { erro: string }`, where `Staged = { dir: string; commit: string; kind: 'marketplace' | 'skills'; plugins: string[]; skills: string[] }`

  `stagingRoot` is `<projeto>/.brandyterm/tmp/skill-install`. Staging writes `<projeto>/.brandyterm/tmp/.gitignore` containing `*` if absent, then `git clone --depth 1` into `<stagingRoot>/<owner>-<repo>` (removing the old copy first). It reads `.claude-plugin/marketplace.json` `plugins[].name` → `marketplace`. Otherwise it collects `skills/<nome>/SKILL.md` (or the root `SKILL.md` when `sub` points at one skill) → `skills`.

- [ ] **Step 1: Write the failing tests** for `parseOrigin`, covering every form in Review Focus 4:
  - `https://github.com/CloudAI-X/threejs-skills` → `{github, CloudAI-X, threejs-skills}`
  - `…/tree/main/skills/x` → `sub:'skills/x'`
  - `o/r.git` → `repo:'r'`
  - `impeccable@impeccable` → `{catalog}`
  - `https://gitlab.com/o/r` → `erro`
  - `o/../r` → `erro`
  - `o/r;rm` → `erro`

  Owner and repo must match `^[A-Za-z0-9_.-]+$`.
- [ ] **Step 2: Write the failing tests** for `stageOrigin`, with a fake git that creates a fixture tree:
  - A marketplace repo → `kind:'marketplace'` and its plugin names.
  - A repo with `skills/a/SKILL.md` and `skills/b/SKILL.md` → `kind:'skills'` with `['a','b']`.
  - A repo with neither → `{erro:'Não achei plugin nem skill nesse repositório.'}`.
  - The `.gitignore` is written.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. **Step 5:** PASS.
- [ ] **Step 6:** Commit `feat(skills): lê a origem do /skill-install e baixa para análise`.

---

### Task 8: Gateway `skills_*` tools and the handler

**Files:**
- Create: `src/main/skills/handler.ts`, `src/main/skills/handler.test.ts`, `src/main/skills/import.ts`, `src/main/skills/import.test.ts`
- Modify:
  - `src/main/connectors/gateway-protocol.ts` (`op` adds `'skills'`; add `SKILL_TOOLS`)
  - `src/main/connectors/gateway.ts` (map `skills_*` → `{op:'skills', tool, args}`; list `SKILL_TOOLS` only when `process.env.BRANDY_GATEWAY_SKILLS === '1'`)
  - `src/main/adapters/gateway-launch.ts` (`gatewaySpec(socket, token, extraEnv?: Record<string,string>)`)
  - `src/main/connectors/boot.ts` (route `op==='skills'` to `d.skills?.(ref, req, signal)`; the provider adds `BRANDY_GATEWAY_SKILLS=1` when `d.isSkillsThread?.(ref)`)
  - `src/shared/types.ts` (`Thread.skillsTask?: 'init'|'refresh'|'install'`)

**Interfaces:**
- Consumes: Tasks 2, 5, 6 and 7.
- Produces:
  - `createSkillsHandler(d: SkillsDeps): (ref: ThreadRef, req: GwRequest, signal: AbortSignal) => Promise<unknown>`
  - `SkillsDeps { paths: SkillsPaths; findThread(ref): { p: Project; t: Thread } | undefined; ask(t: Thread, a: ApprovalAsk): Promise<ApprovalDecision>; install(id: string, item?: CatalogItem): Promise<{ok:boolean; erro?:string}>; scanDir(dir: string): Promise<ScanResult>; git?: GitRun; changed(projectId: string): void }`

  The tools, with their inputs and what they do:

  | tool | args | does |
  |---|---|---|
  | `skills_catalog` | – | returns catalog items (id, tipo, descricao, tags, corporativo) plus the current list |
  | `skills_add` | `id`, `motivo` | card; on allow: `turnOn` + `writeList`, and install if it's a missing plugin |
  | `skills_remove` | `id`, `motivo` | card; on allow: `turnOff` + `writeList` |
  | `skills_resolve` | `origem` | `parseOrigin`; a catalog id → `{kind:'catalog', item}`; GitHub → `stageOrigin` plus stars/license via `gh api repos/o/r` (null when `gh` fails) |
  | `skills_import` | `staging`, `itens: {nome, descricao, tags}[]`, `plugin?` | `scanDir` on staging (blocked → error with counts); card per item; skills: copy to `lib/biblioteca/skills/<nome>` + `origem.json` + `upsertCatalog` + `turnOn`; plugin: `marketplace add o/r` + install + `upsertCatalog({loja:'o/r'})` + `turnOn`; then `commitLibrary`; deletes staging |
  | `skills_push` | – | card, then `pushLibrary` |

  Cards use `connector: { id: 'skills', name: 'Skills', tool }`, `tool: 'mcp__skills__<tool>'`, `summary` (e.g. `Ligar impeccable@impeccable neste projeto`) and `detail` (the `motivo` plus the catalog `descricao`). Only `'allow'`, `'always'` and `'all'` proceed. Anything else returns `'Recusado pelo usuário.'` and the thread moves on.

- [ ] **Step 1: Write the failing tests** for `handler.test.ts` (temp project, temp lib, fake `ask`/`install`/`git`):
  - `skills_add` with an id unknown to the catalog → error `'Item fora do catálogo: use skills_resolve.'`. `ask` is never called and no file is written (Review Focus 5).
  - A call from a thread without `skillsTask` → error `'Ferramenta de skills só roda em /skill-init, /skill-refresh ou /skill-install.'` (Review Focus 5).
  - `skills_add` approved → `skills.json` contains the item, and `install` is called once for a missing plugin.
  - `skills_add` denied → no file.
  - `skills_remove` on a `sempre` item → `sem` contains it.
  - `skills_add` on a `corporativo` item adds it to the list, and nothing is copied.
  - `skills_import` with a staging dir outside `<projeto>/.brandyterm/tmp/skill-install` → refused.
  - `skills_import` with a blocked scan → error, and the lib is unchanged.
  - `skills_import` with a name that already exists in the library → a second card `Substituir <nome> na biblioteca?`; denying it leaves the old copy.
- [ ] **Step 2: Write the failing tests** for `import.test.ts`, covering `copySkill(staging, nome, libSkillsDir, meta: { repo: string; commit: string; licenca: string | null; estrelas: number | null }): void`. It copies without `.git`, writes `origem.json` with exactly those 4 keys plus `importado` (ISO date), and leaves no absolute paths in any written JSON.
- [ ] **Step 3:** FAIL. **Step 4:** Implement `import.ts`, `handler.ts` and the protocol/gateway/boot edits. Keep `boot.ts` in the same shape: `d.skills` and `d.isSkillsThread` are optional deps, so the existing boot tests pass unchanged.
- [ ] **Step 5:** Extend `src/main/connectors/boot.test.ts` (or add `gateway-skills.test.ts`) with two tests:
  - a `{op:'skills'}` request reaches `d.skills`, not `calls`;
  - the env flag is set only for skills threads.
- [ ] **Step 6:** Tests and typecheck PASS.
- [ ] **Step 7:** Commit `feat(skills): ferramentas skills_* no gateway com cartão por item`.

---

### Task 9: Signals, prompts and the `/skill-*` app commands

**Files:**
- Create: `src/main/skills/signals.ts`, `src/main/skills/signals.test.ts`, `src/main/skills/prompts.ts`, `src/main/skills/prompts.test.ts`, `src/main/skill-commands.ts`
- Modify: `src/main/commands.ts` (`APP_COMMANDS` gets `skill-init`, `skill-refresh` and `skill-install` with pt-BR descriptions), `src/main/slash.ts` (delegates those names to `runSkillCommand`)

**Interfaces:**
- Produces:
  - `projectSignals(projectPath: string): Signals`, where `Signals { deps: string[]; arquivos: Record<string, number>; readme: string; skillsLocais: string[] }`:
    - `deps` covers the keys of `dependencies` + `devDependencies` in `package.json`, and also the names in `requirements.txt`, `pyproject.toml` `[project] dependencies`, `Cargo.toml` `[dependencies]` and `go.mod` `require`;
    - `arquivos` is the top 10 extensions by count, skipping `node_modules`, `.git`, `dist`, `out` and `build`, with a 5000-file cap;
    - `readme` is the first 2000 chars;
    - `skillsLocais` lists the names in `.claude/skills`.
  - `skillPrompt(kind: 'init'|'refresh'|'install', o: { args: string; itens: CatalogItem[]; list: SkillsList | null; signals: Signals; buscar: boolean }): string`
  - `runSkillCommand(e: Engine, p: Project, cmd: {name: string; args: string}, atts: Attachment[]): void`

  `runSkillCommand` does the following:
  - With no project path → note `'Esse comando precisa de um projeto com pasta.'`.
  - With no Claude → the same note as slash.ts.
  - Otherwise it runs `syncLibrary` (a warning becomes a system note), creates a thread with `skillsTask` set, title `/skill-init` and so on, `effort:'medium'`, and `why:'comando / do usuário'`, then starts it with `skillPrompt(...)`.

- [ ] **Step 1: Write the failing tests** for `signals.test.ts`, using a fixture project with `package.json` (`three`, `react`), 3 `.ts` and 1 `.css` files, a 5000-char README and `.claude/skills/x/SKILL.md`. Expect `deps` ⊇ `['three','react']`, `arquivos['.ts']===3`, `readme.length===2000` and `skillsLocais=['x']`. A project with nothing → empty fields, no throw.
- [ ] **Step 2: Write the failing tests** for `prompts.test.ts`, asserting that the prompt contains these rules:
  - All kinds: the catalog lines as `- <id> [<tags>]: <descricao>`; the signals as a JSON block; `use skills_add para cada item, um por vez, com o motivo em uma linha`; `itens corporativos só se o projeto já tiver a tag ou o usuário pedir`; `responda em português do Brasil`.
  - `refresh`: also `skills_remove` and `não grave nada sem o cartão aprovado`.
  - `install`: the origin string, `chame skills_resolve`, `se a loja tiver vários plugins, pergunte qual` and `skills_import` with pt-BR descriptions written from the `SKILL.md`. At the end, `ofereça skills_push`.
  - `buscar:true`, in this order:
    1. the source order: `claude-plugins-official`/`anthropics/skills`, then `npx skills find <termo>`, then `gh search repos --topic claude-skills --topic agent-skills --topic claude-code-plugin --sort stars`;
    2. the floor: `100 estrelas ou 1 mil instalações, e commit nos últimos 6 meses`, with `"pouco usado"` below it;
    3. the card fields: stars, installs, last commit date and reason;
    4. `candidato novo passa por skills_resolve + skills_import (que roda a checagem de segurança)`.
  - `buscar:false` does not contain `npx skills find`.
- [ ] **Step 3:** FAIL. **Step 4:** Implement. `--buscar` is parsed from `args`. The prompt suggests grouping many items by tag before the cards, but the cards stay one per item. **Step 5:** PASS.
- [ ] **Step 6:** Check `helpText` shows the 3 new commands, and that slash.ts stays under 60 lines.
- [ ] **Step 7:** Commit `feat(skills): /skill-init, /skill-refresh e /skill-install`.

---

### Task 10: Per-project panel state, IPC and UI

**Files:**
- Create:
  - `src/main/skills/view.ts`, `src/main/skills/view.test.ts`
  - `src/main/skills/wiring.ts`, which builds the deps for the handler, IPC and state from the engine and is the only file importing electron
  - `src/main/skills-ipc.ts`
  - `src/renderer/src/components/ProjectSkillsPanel.tsx`
- Modify:
  - `src/shared/types.ts`: `AppState.projectSkills?: Record<string, ProjectSkillsView>`
  - `src/shared/api.ts` and `src/preload/index.ts`: `toggleSkill`, `installMissingSkills`, `setSkillsLibrary`
  - `src/main/app-ipc.ts`: register the skills IPC
  - `src/main/engine.ts`: ≤6 lines, calling `wiring` on `init()` and on state refresh
  - `src/renderer/src/App.tsx` and `Sidebar.tsx`: pass `projectSkills[activeId]`, and render `ProjectSkillsPanel` instead of `UserPluginsPanel` when the active project has a path
  - `src/renderer/src/components/UserPluginsPanel.tsx`: drop the project chip and keep only `hooks` with `title`
  - `userplugins.css`: `.up-tag` gets `text-overflow: ellipsis`

**Interfaces:**
- Produces:
  - `ProjectSkillsView { hasList: boolean; erro?: string; rows: SkillRow[]; missing: string[]; aviso?: string }`
  - `SkillRow { id: string; name: string; kind: 'plugin'|'skill'; hooks: boolean; skills: number; commands: number; agents: number; description?: string; on: boolean; installed: boolean; sempre: boolean }`
  - `projectView(i: { list: SkillsList | null; erro?: string; itens: CatalogItem[]; installed: UserPlugin[]; libSkills: Set<string>; fallbackOn: Set<string>; platform }): ProjectSkillsView`
  - `toggle(projectPath, id, on, deps): Promise<{ok:boolean; erro?:string}>`
  - IPC `skills:toggle {projectId, id, on}`, `skills:installMissing {projectId}` and `skills:setLibrary {repo}`

- [ ] **Step 1: Write the failing tests** for `view.test.ts`:
  - The rows are the catalog items plus installed plugins outside the catalog, minus items whose platform doesn't match.
  - `on` follows the list when one exists, otherwise `fallbackOn`.
  - A listed plugin that isn't installed → `installed:false` and its id in `missing`.
  - `hooks` is true only for plugins with hooks.
  - The sort is on first, then name.
  - A broken list → `erro:'skills.json inválido'` and `hasList:false`.
- [ ] **Step 2: Write the failing tests** for `toggle`, in the same file with temp dirs:
  - With no list, the first toggle creates one from `fallbackOn` (catalog items only) plus the change.
  - Toggling a `sempre` item off writes `sem`.
  - Toggling a missing plugin on calls `install`.
- [ ] **Step 3:** FAIL. **Step 4:** Implement `view.ts` and the `toggle` logic, plus the wiring and IPC.
- [ ] **Step 5: UI** in `ProjectSkillsPanel.tsx` (aim for under 200 lines; split rows out to `SkillRowView.tsx` if it grows):
  - The header is `Skills · <nome do projeto>`, and each row reuses `Toggle`.
  - Only the `hooks` tag appears, with a `title` tooltip showing the full text.
  - The summary line uses `plugin-list.ts` formatting such as `15 skills · 2 agentes`; zero everywhere → `sem skills`.
  - `⚠ falta instalar: a, b` with an `[Instalar]` button.
  - With no list: `Projeto sem lista: a primeira mudança cria .brandyterm/skills.json. Ou rode /skill-init.`
  - The fixed hint `Vale a partir da próxima thread do projeto.`
  - The footer `Biblioteca: <repo>` with an edit-in-place input.

    The input calls `setSkillsLibrary`. That is my call: there is no Configurações screen, so the panel replaces "Configurações → Skills".
  - `aviso` (library offline) shows as a small warning line.
- [ ] **Step 6:** Tests and typecheck PASS. Then run the app (`run` skill), select two projects, toggle an item in one, and confirm that only that project's `skills.json` changed and that the tooltip and hooks tag render.
- [ ] **Step 7:** Commit `feat(skills): painel por projeto`.

---

### Task 11: Migration and docs

**Files:**
- Create (in `~/Projects/claude-kit`, the private repo, **not** brandyTerm): `biblioteca/catalogo.json` and `biblioteca/skills/<nome>/` with `origem.json`
- Modify: `docs/superpowers/specs/2026-11-25-multi-machine-design.md` (section 8), `CLAUDE.md`/README if they describe the skills panel

- [ ] **Step 1:** Write `catalogo.json` from what's installed after the cleanup (spec §7, "Ficou"):
  - Include every plugin there with `loja`. `kit-core`, `kit-tokens`, `kit-router` and `kit-model-stack` get `sempre: true`, and `vivo@claude-kit-private` gets `corporativo: true`.
  - Each `descricao` is one pt-BR line written for suggesting the item.
  - Skip `synced`: it is Claude.ai's own and stays outside the library.
- [ ] **Step 2:** Copy the loose skills `graphify`, `instalar-com-seguranca`, `find-skills`, `vercel-react-best-practices`, `orca-cli`, `orca-computer-use` and `orchestration` from `~/.claude/skills` to `biblioteca/skills/`. Write `origem.json` for each: the repo when known, otherwise `"repo": null`. Before copying, check that none of them is corporate.
- [ ] **Step 3:** In claude-kit, run `git add biblioteca && git commit`, and **don't push**. The user reviews the descriptions first.
- [ ] **Step 4:** Make no seed list files. Instead, check that `/skill-init` on dark-factory proposes `impeccable` and that on canal-youtube it proposes `hyperframes`, per spec §8.2. Doing this by hand once the app runs is enough; record it in the final report.
- [ ] **Step 5:** Update multi-machine spec §8. For projects with a list, skills and `thread-plugins.json` now travel through the project's git and the library. Parity keeps hooks, MCPs, app settings and plugins installed outside any list.
- [ ] **Step 6:** Commit in brandyTerm: `docs(skills): paridade entre máquinas usa a lista do projeto`.

---

### Final: whole-branch check

- [ ] `node --test "src/**/*.test.ts"` and the typecheck are green.
- [ ] `wc -l src/main/skills/*.ts src/main/skill-commands.ts src/main/skills-ipc.ts src/renderer/src/components/ProjectSkillsPanel.tsx`: everything under 400. Check that `engine.ts` stays ≤ 400.
- [ ] `git grep -n "claude-kit-private" -- src` shows only the corporate-handling code, with no copied content.
- [ ] Nothing pushed, in either repo.
