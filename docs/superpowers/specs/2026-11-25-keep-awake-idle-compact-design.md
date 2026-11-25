# Keep awake while working + idle compaction of the coordinator

## Intent

Two small savings of the user's time and tokens:
1. The computer must not go to sleep while a thread or the coordinator is working
   (a long run dies or stalls when the machine sleeps).
2. A project coordinator that sits idle gets its context compacted on its own, the
   way Claude Code does, so the next message starts small, fast and cheap.

## Decisions (user)

- "Working" means only threads (running/queued) or a coordinator call in flight.
  Long-lived processes kept by the process manager (dev servers) do **not** keep
  the machine awake.
- Idle compaction fires at ~4 minutes idle, inside Claude's ~5-minute prompt cache,
  so the summary rereads the history at the cached price.

## Approaches

- Keep awake: Electron `powerSaveBlocker` (`prevent-app-suspension`, display may
  still sleep) vs. spawning `caffeinate`. **Picked: powerSaveBlocker** (builder's
  call: native, cross-platform, no child process).
- Idle compaction: run the existing `/compact` on the coordinator session vs.
  dropping the session for free (next turn restarts with recent chat + memory, which
  loses detail). Firing late (30 min) vs. inside the cache window. **Picked:
  `/compact` at ~4 min**, agreed with the user.

## Design

**Keep awake.** Main process watches engine `change` events; a pure
`shouldStayAwake(projects)` is true when any project is `busy` or has a thread
`running`/`queued`. True starts one blocker, false stops it. Known limit, said in the
UI tooltip: closing a MacBook lid still sleeps without an external display.

**Idle compaction.** A 30-second timer checks every project with a pure
`idleCompactDue(project, nowMs, cfg)`:
coordinator agent is Claude, has a session, project not busy, no thread running or
queued, `context.used >= minTokens` (default 40 000), last coordinator activity
(last message time) older than `minutes` (default 4), and not compacted since that
activity (`coordinator.compactedAt`). When due, it enqueues the same compaction as
`/compact` (shared function, no duplicated logic) through `engine.enqueue`, so a
user message sent meanwhile waits for it and is never lost. It also updates the
coordinator's context use. Chat note: "Contexto do coordenador compactado
automaticamente (parado há N min)." Failures are a quiet system note.

**Settings.** `AppSettings.keepAwake` (default on) and
`AppSettings.idleCompact: { enabled, minutes, minTokens }` (default on, 4, 40 000),
toggled in the same place as "permitir tudo".

## Non-goals

- Compacting threads; compacting Codex coordinators (Codex compacts itself).
- Preventing lid-close sleep.

## Constraints

- No code file over 400 lines; `engine.ts` is at 397, so nothing is added there.
- UI copy in Brazilian Portuguese.

## Left to the builder

File layout, timer cadence details, exact settings UI.
