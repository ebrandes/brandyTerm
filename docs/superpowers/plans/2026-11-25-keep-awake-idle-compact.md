# Keep Awake + Idle Compaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the machine awake while a thread or the coordinator is working, and compact an idle coordinator's context on its own (~4 min idle, inside the prompt cache window).

**Architecture:** Two pure predicates (`shouldStayAwake`, `idleCompactDue`) live in Electron-free files so `node --test` can import them. A small main-process module wraps `powerSaveBlocker`, driven by engine `change` events. A 30-second timer runs the idle check and enqueues the same compaction `/compact` uses, extracted into one shared function so no logic is duplicated. Settings are two new fields on `AppSettings`, toggled next to "permitir tudo".

**Tech Stack:** Electron 33, React, TypeScript, Node's built-in test runner (`node --test`, Node runs `.ts` directly).

**Spec:** `docs/superpowers/specs/2026-11-25-keep-awake-idle-compact-design.md`

## Global Constraints

- No code file above 400 lines. `src/main/engine.ts` is at 397: add nothing to it except a one-line call if unavoidable. `src/main/index.ts` (205) is also a guard: keep additions to wiring only.
- Pure logic in Electron-free files (no `electron` import) so tests run under `node --test`.
- Compaction logic exists once: `/compact` (slash.ts) and idle compaction both call the same shared function.
- Compaction is enqueued through `engine.enqueue`, so a user message sent meanwhile waits and is never lost.
- UI copy in Brazilian Portuguese, like the rest of the app.
- Codex coordinators are never compacted by this feature (Codex compacts itself).

## Review Focus

1. A busy project or a thread `running`/`queued` never gets compacted mid-run (checked inside the job, not only at scheduling time, because `enqueue` may be waiting).
2. Keep awake releases the blocker when the last busy project finishes; no leaked blocker when settings toggle off.
3. Idle compaction fires at most once per idle period: `compactedAt` >= last coordinator activity means skip.
4. A compaction failure produces a quiet system note, not an exception that escapes the timer.
5. `sendToCoordinator`'s behavior is unchanged when idle compaction is off.

---

### Task 1: Pure predicates and tests

**Files:**
- Create: `src/shared/idle.ts` (pure: `shouldStayAwake`, `idleCompactDue`, `IdleCompactCfg`, `DEFAULT_IDLE_COMPACT`)
- Create: `src/shared/idle.test.ts`
- Modify: `src/shared/types.ts` (add `AppSettings.keepAwake?: boolean`, `AppSettings.idleCompact?: IdleCompactCfg`, and `Project.coordinator.compactedAt?: string`)

- [ ] **Step 1: Write failing tests** for `shouldStayAwake`:
  - true when any project `busy`
  - true when any thread `running` or `queued`
  - false when only a dev server process is running (`processes` non-empty, nothing busy)
  - false for empty list

- [ ] **Step 2: Write failing tests** for `idleCompactDue(project, nowMs, cfg)`:
  - true when: agent is `claude`, has `sessionId`, not busy, no thread running/queued, `context.used >= minTokens`, last message older than `minutes`, and `compactedAt` absent or older than last activity
  - false for each condition individually (codex agent, no session, busy, thread queued, used below min, activity too recent, already compacted after activity)
  - false when `cfg.enabled` is false
  - last activity = time of last entry in `project.messages` (ISO string) or last thread message if later

- [ ] **Step 3: Run** `node --test src/shared/idle.test.ts` and confirm failures.

- [ ] **Step 4: Implement** `src/shared/idle.ts` until tests pass. Defaults: `{ enabled: true, minutes: 4, minTokens: 40_000 }`.

- [ ] **Step 5: Run** the test again; all green. Commit: `feat: pure predicates for keep-awake and idle compaction`.

### Task 2: Share the compaction job

**Files:**
- Create: `src/main/compact.ts` (exports `compactCoordinator(e: Engine, p: Project)`: runs `/compact` through `runOnce` on the coordinator session, adds usage, updates `sessionId`, sets `coordinator.compactedAt = now`, pushes the note text)
- Modify: `src/main/slash.ts` (the `/compact` branch for the coordinator calls `compactCoordinator`; thread branch unchanged)

- [ ] **Step 1:** Read `src/main/slash.ts` and `src/main/run.ts` to confirm signatures before editing.
- [ ] **Step 2:** Move the coordinator `work` body into `compact.ts`. Keep the existing note texts: `Contexto compactado.` and `Falha ao compactar: ...`. Note texts for the coordinator path (`note`) must still reach `p.messages`.
- [ ] **Step 3:** Run existing tests and `npm run typecheck` (or the project's equivalent; check `package.json`). Commit: `refactor: extract coordinator compaction into shared job`.

### Task 3: Keep-awake module

**Files:**
- Create: `src/main/keep-awake.ts` (class `KeepAwake` wrapping `powerSaveBlocker`: `sync(projects: Project[], threads..., enabled: boolean)`; starts with `'prevent-app-suspension'` once, stops when false or not needed)
- Modify: `src/main/index.ts` (create one `KeepAwake`, call `sync` on engine `change`, using `appSettings().keepAwake !== false`)

- [ ] **Step 1:** Write `shouldStayAwake` usage in `keep-awake.ts`: it calls the pure predicate from `src/shared/idle.ts` over `engine.state.projects`.
- [ ] **Step 2:** Implement start/stop idempotent: track blocker id, `powerSaveBlocker.isStarted(id)` before starting.
- [ ] **Step 3:** Wire into `index.ts` next to `engine.on('change', pushState)`.
- [ ] **Step 4 (manual):** run app, start a thread, check `powerSaveBlocker` via `pmset -g assertions | grep -i brandy` shows `PreventUserIdleSystemSleep` assertion; after thread ends, assertion is gone.
- [ ] **Step 5:** Commit: `feat: keep the machine awake while threads or the coordinator work`.

### Task 4: Idle compaction timer

**Files:**
- Create: `src/main/idle-compact.ts` (`startIdleCompact(e: Engine, getCfg: () => IdleCompactCfg): () => void`; 30 s `setInterval`; for each project where `idleCompactDue` is true, `e.enqueue(p, () => compactCoordinator(e, p))` and pushes system note `Contexto do coordenador compactado automaticamente (parado há N min).`; catches errors into a quiet note)
- Modify: `src/main/index.ts` (start timer after `engine.init()`, stop on `before-quit`)

- [ ] **Step 1:** Re-check job guard: inside the enqueued job, re-run `idleCompactDue` before compacting, so a message that arrived while waiting in the queue cancels the compaction.
- [ ] **Step 2:** Write the timer. Use `Date.now()` as `nowMs`. Do not touch `p.busy` directly.
- [ ] **Step 3:** Manual check with `minutes` temporarily set to 0.5 and `minTokens` to 1: wait, see note, confirm `coordinator.compactedAt` set in state file.
- [ ] **Step 4:** Commit: `feat: compact an idle coordinator's context automatically`.

### Task 5: Settings UI

**Files:**
- Modify: `src/shared/api.ts` (settings patch type includes `keepAwake`, `idleCompact`)
- Modify: `src/main/settings.ts` (`updateSettings` handles the two keys; `keepAwake` default on when undefined)
- Modify: the renderer component that holds the "permitir tudo" toggle (find with `codegraph explore "permitir tudo allowAllThreads"`). Add two toggles: "Manter o computador acordado enquanto trabalha" and "Compactar contexto do coordenador quando ocioso". Tooltip says closing the MacBook lid still sleeps without an external display.
- If that component is near 400 lines, split the settings section into its own file before adding.

- [ ] **Step 1:** Locate the toggle and read it.
- [ ] **Step 2:** Add the two toggles, wired to `updateSettings`.
- [ ] **Step 3:** Manual check: toggles persist across restart (`settings.json` in userData).
- [ ] **Step 4:** Commit: `feat: settings for keep-awake and idle compaction`.

### Task 6: Verification

- [ ] **Step 1:** `node --test` over `src/shared/idle.test.ts` and any existing suite; all green.
- [ ] **Step 2:** Typecheck and lint per `package.json`.
- [ ] **Step 3:** Check file sizes: `wc -l src/main/*.ts src/renderer/src/**/*.tsx | awk '$1>400'` must show nothing new over 400.
- [ ] **Step 4:** Manual run per Task 3 and Task 4 checks, plus: toggles off → no assertion, no compaction.
