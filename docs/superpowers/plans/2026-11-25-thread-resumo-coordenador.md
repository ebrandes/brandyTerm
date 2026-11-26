# Resumo da thread para o coordenador — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uma thread manda ao coordenador e à memória um resumo (curto automático, ou completo pelo botão), e o coordenador pode fazer perguntas a uma thread.

**Architecture:** Um `ThreadReporter` (módulo novo, deps injetadas) roda execuções "silenciosas" na sessão da thread com `tools: 'readonly'`, sem mudar o estado visível dela. O engine só ganha ligações de uma linha (está em 389 linhas). O plano do coordenador ganha um campo `ask`, entregue por `dispatchReplies`.

**Tech Stack:** Electron + React/TS, `node --test` (Node roda TS direto), `npm run typecheck`.

**Spec:** `docs/superpowers/specs/2026-11-25-thread-resumo-coordenador-design.md`

## Global Constraints

- Todo texto visível em pt-BR.
- Nenhum arquivo de código acima de 400 linhas; `src/main/engine.ts` (389) recebe no máximo 8 linhas novas — lógica nova vai para `src/main/thread-report*.ts`.
- Commits sem trailer de IA (o hook bloqueia). Nunca dar push.
- Testes: `npm test`; tipos: `npm run typecheck`.
- O resumo não muda `state`, `note`, `todos`, `steps`, `pending` nem `resolved` da thread, e não dispara síntese nem `reportDirect`.

## Review Focus

1. Usuário escreve na thread enquanto o resumo roda → o resumo é cancelado e a mensagem do usuário segue normal (Task 2 `cancel` + Task 3 teste).
2. Coordenador pergunta a uma thread ocupada (running/queued/resumindo) → aviso no reply e a pergunta roda quando ela parar (Task 2 `afterRun`).
3. Thread sem `sessionId` (nunca rodou) → botão desabilitado e `ask` vira aviso, nada roda (Task 2).
4. Execução de resumo falha → mensagem curta de erro para o resumo completo; para o curto automático, cai na mensagem antiga "A thread X respondeu." (Task 2/3).
5. Resposta da thread sem as linhas FEITO:/DECIDIDO: → o texto inteiro (cortado em 600) vai como resumo; nenhuma nota de memória quebrada (Task 1).

---

### Task 1: Textos e leitura do relatório

**Files:**
- Create: `src/main/thread-report-text.ts`
- Test: `src/main/thread-report-text.test.ts`

**Interfaces:**
- Produces:
  - `type ReportKind = 'curto' | 'completo'`
  - `reportPrompt(kind: ReportKind): string`
  - `askPrompt(question: string): string`
  - `parseReport(text: string): Report` com `interface Report { feito?: string; decidido?: string; arquivos?: string; pendente?: string; texto: string }`
  - `reportNotes(title: string, r: Report, kind: ReportKind): MemoryNote[]`
  - `followUpPrompt(title: string, question: string, answer: string): string`

- [ ] **Step 1: Write the failing tests**

```ts
test('reportPrompt pede as linhas certas', () => {
  const c = reportPrompt('curto')
  for (const l of ['FEITO:', 'DECIDIDO:', 'ARQUIVOS:']) assert.ok(c.includes(l))
  assert.ok(!c.includes('PENDENTE:'))
  assert.ok(reportPrompt('completo').includes('PENDENTE:'))
  assert.ok(c.includes('Não altere arquivos'))
})
test('parseReport lê as linhas, multilinha até a próxima etiqueta', () => {
  const r = parseReport('FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada')
  assert.deepEqual(r, { feito: 'a b', decidido: 'c', arquivos: 'x.ts, y.ts', pendente: undefined, texto: 'FEITO: a\nb\nDECIDIDO: c\nARQUIVOS: x.ts, y.ts\nPENDENTE: nada' })
})
test('parseReport sem etiquetas guarda só o texto, cortado em 600', () => {
  const r = parseReport('x'.repeat(700))
  assert.equal(r.feito, undefined)
  assert.equal(r.texto.length, 600)
})
test('reportNotes', () => {
  const r = parseReport('FEITO: f\nDECIDIDO: d\nARQUIVOS: a\nPENDENTE: p')
  assert.deepEqual(reportNotes('T', r, 'completo'), [
    { section: 'Recente', text: '“T”: f' },
    { section: 'Decisões', text: '“T”: d' },
    { section: 'Pendências', text: '“T”: p' }
  ])
  assert.deepEqual(reportNotes('T', r, 'curto').map((n) => n.section), ['Recente', 'Decisões'])
  assert.deepEqual(reportNotes('T', parseReport('solto'), 'curto'), [])
})
test('askPrompt e followUpPrompt carregam pergunta e resposta', () => {
  assert.ok(askPrompt('por que X?').includes('por que X?'))
  const f = followUpPrompt('T', 'por que X?', 'porque Y')
  for (const s of ['“T”', 'por que X?', 'porque Y', '"reply"']) assert.ok(f.includes(s))
})
```

- [ ] **Step 2: Run** `node --test src/main/thread-report-text.test.ts` — Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Prompts in pt-BR:
  - `reportPrompt('curto')`: "Escreva um resumo curto desta thread para o coordenador do projeto, de 3 a 5 linhas no total, só com estas linhas: FEITO: … / DECIDIDO: … (ou "nada") / ARQUIVOS: … (principais, separados por vírgula). Não altere arquivos nem rode comandos." `completo` adds "PENDENTE: …" and allows até 15 linhas, cobrindo a conversa inteira.
  - `askPrompt(q)`: "O coordenador do projeto pergunta: <q>\nResponda em até 10 linhas, com o que você sabe desta thread. Não altere arquivos nem rode comandos."
  - `followUpPrompt`: tells the coordinator the thread “T” answered its question; write in `"reply"` the answer to the user; `tasks=[]`; somente JSON.
  - `parseReport`: labels `FEITO|DECIDIDO|ARQUIVOS|PENDENTE`, case-insensitive at line start; a value runs to the next label, whitespace collapsed; `nada|nenhum|nenhuma|-` → `undefined`; `texto` = trimmed input sliced to 600.
  - `reportNotes`: `“title”: value`, sections Recente←feito, Decisões←decidido, Pendências←pendente (completo only); omit missing.

- [ ] **Step 4: Run** the test — Expected: PASS.

- [ ] **Step 5: Commit** `feat(threads): textos do resumo da thread`

### Task 2: ThreadReporter

**Files:**
- Create: `src/main/thread-report.ts`
- Modify: `src/shared/types.ts` (Thread: `reporting?: boolean`, `reportedAt?: string`)
- Test: `src/main/thread-report.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
```ts
export interface SilentRun { cancel(): void; result: Promise<{ ok: boolean; text: string; error?: string; sessionId?: string }> }
export interface ReportHost {
  msg(author: Message['author'], text: string, extra?: Partial<Message>): Message
  touch(): void
  enqueue(p: Project, job: () => Promise<void>): void
  askCoordinator(p: Project, prompt: string): Promise<{ plan: Plan } | { error: string }>
  remember(p: Project, notes: MemoryNote[]): void
  run(p: Project, t: Thread, prompt: string): SilentRun
}
export class ThreadReporter {
  constructor(host: ReportHost)
  /** false (and nothing runs) when the thread has no session or is busy */
  report(p: Project, t: Thread, kind: ReportKind, onFail?: () => void): boolean
  /** returns a pt-BR note when it could not run now ('' when it ran or was queued) */
  ask(p: Project, t: Thread, question: string): string
  cancel(threadId: string): void
  /** call after a thread's normal run settles: runs a queued question */
  afterRun(p: Project, t: Thread): void
  busy(threadId: string): boolean
}
```

- [ ] **Step 1: Write the failing tests** with a fake host (`run` returns a controllable promise; record pushed messages via `p.messages`).
  - `report curto: pushes one agent message "Resumo da thread “T”" with summaries [{agent,title,text:r.texto,threadId}], calls remember with reportNotes(...,'curto'), sets t.summary = r.feito, t.reportedAt set, t.reporting false after`
  - `report keeps state/note/pending/resolved untouched` (snapshot before/after)
  - `report saves a new sessionId from the run`
  - `report without sessionId returns false and runs nothing`
  - `report while reporting returns false (one at a time)`
  - `report failure: completo pushes system message "Não consegui o resumo da thread “T”: <erro>" isError; curto calls onFail and pushes nothing`
  - `cancel during a report: run.cancel called, no message pushed, t.reporting false`
  - `ask on an idle thread: runs askPrompt, then enqueue → askCoordinator(followUpPrompt) → pushes coordinator message with plan.reply; returns ''`
  - `ask on a running thread (state 'running') returns '' and runs only after afterRun(p,t) with state 'done'`
  - `ask on a thread without session returns "A thread “T” ainda não tem conversa para consultar."`
  - `ask follow-up error pushes coordinator failure via message "Não consegui repassar a resposta da thread “T”."`

- [ ] **Step 2: Run** `node --test src/main/thread-report.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Busy = `t.state === 'running' || t.state === 'queued' || this.busy(t.id)`. Keep `Map<threadId, SilentRun>` and `Map<threadId, string[]>` for queued questions (not persisted). `reporting` flag set/cleared with `touch()`. Message text for report: `Resumo da thread “${t.title}”` (curto) / `Relatório da thread “${t.title}”` (completo).

- [ ] **Step 4: Run** — Expected: PASS; `npm run typecheck` clean.

- [ ] **Step 5: Commit** `feat(threads): ThreadReporter roda resumo e perguntas na sessão da thread`

### Task 3: Ligações no engine, gatilhos automáticos e IPC

**Files:**
- Modify: `src/main/engine.ts` (≤ +8 linhas), `src/main/synthesis.ts`, `src/main/app-ipc.ts`, `src/main/rpc/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/renderer/src/remote/routed-api.ts`
- Test: `src/main/thread-report-wiring.test.ts` (or extend the existing engine-level test that `skill-commands.test.ts` uses for its engine fake — follow its setup)

**Interfaces:**
- Consumes: Task 2.
- Produces: `engine.reporter: ThreadReporter` (public readonly); IPC `thread:report` `{projectId, threadId}` → `engine.reporter.report(p, t, 'completo')`; `api.reportThread(args: { projectId: string; threadId: string }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**
  - `direct turn that auto-resolves runs the short report instead of "A thread X respondeu."` (reportDirect with t.state 'done', t.resolved true → reporter.report called with 'curto'; on fail the old message is pushed)
  - `direct turn left pending still posts the old message and no report`
  - `resolveThread runs the short report`
  - `sendToThread cancels a running report before starting the turn`
  - `afterRun is called after a thread run settles`
  - `channels: 'thread:report' rule is 'pass'`

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement.**
  - engine: field `readonly reporter = new ThreadReporter({...})` with `run` built from `runOnce(ADAPTERS[t.agent], { cwd: p.path!, prompt, sessionId: t.sessionId, model: t.model, effort: t.effort, tools: 'readonly', thread: { projectId: p.id, threadId: t.id }, plugins: this.pluginsFor(p.path ?? null) })`, mapping `r.done` to `{ok,text,error,sessionId}` and adding `r.usage` to `t.usage`. If the field body pushes engine past 400, put the host factory in `src/main/thread-report-host.ts` (`reportHost(engine): ReportHost`) and keep one line in engine.
  - `resolveThread`: after `t.resolved = true`, `this.reporter.report(p, t, 'curto')`.
  - `sendToThread`: first line after finding `t`, `this.reporter.cancel(t.id)`.
  - startThread result: `this.reporter.afterRun(p, t)` before `this.pump(p)`.
  - `reportDirect`: if `t.state === 'done' && t.resolved`, `if (engine.reporter.report(p, t, 'curto', () => post())) return`, where `post()` is the current message push.
  - IPC/api/preload/routed-api/channels: mirror `thread:resolve` exactly.

- [ ] **Step 4: Run** `npm test` and `npm run typecheck` — Expected: all pass; `wc -l src/main/engine.ts` ≤ 400.

- [ ] **Step 5: Commit** `feat(threads): resumo curto ao resolver e canal thread:report`

### Task 4: Coordenador pergunta à thread (`ask`)

**Files:**
- Modify: `src/main/coordinator.ts`, `src/main/plan-dispatch.ts`, `src/main/engine.ts` (only the `dispatchReplies` sender literal, same line)
- Test: `src/main/coordinator.test.ts`, `src/main/plan-dispatch.test.ts`

**Interfaces:**
- Consumes: `ThreadReporter.ask` (Task 2).
- Produces: `Plan.ask: Answer[]` (threadTitle, text = pergunta); `ThreadSender.askThread(p: Project, threadId: string, question: string): string`.

- [ ] **Step 1: Write the failing tests**
  - coordinator: `parsePlan reads ask`, `parsePlan without ask gives []`, `PLAN_SCHEMA has ask`, `buildPlanPrompt explains ask` (prompt includes `"ask"` and the rule text below).
  - plan-dispatch: `ask goes to the matching thread (any non-retired thread with a session)`, `ask with unknown title becomes a note "Pergunta não enviada: nenhuma thread disponível com o título “X”."`, `askThread note (busy/no session) is added to notes`.

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement.** `ask` uses the existing `{threadTitle, text}` shape (`REPLY_LIST`); the JSON line in `buildPlanPrompt` gains `"ask": [{"threadTitle","text"}]`. Prompt rule: `- Para saber detalhes do que uma thread fez ou decidiu (o resumo acima não basta), devolva em "ask" {threadTitle (exato), text (a pergunta)}; a thread responde e você recebe a resposta para responder ao usuário. Diga em "reply" que foi perguntar. Sem pergunta: ask=[].` Matching uses `matchThread(p.threads, title, (t) => !t.retired && !!t.sessionId)`. engine sender literal adds `askThread: (q, id, text) => this.reporter.ask(q, q.threads.find((x) => x.id === id)!, text)`.

- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: pass.

- [ ] **Step 5: Commit** `feat(coordenador): pergunta direto a uma thread`

### Task 5: Botão na thread

**Files:**
- Create: `src/renderer/src/components/ThreadReportButton.tsx`
- Modify: `src/renderer/src/components/Chat.tsx` (render next to `ThreadAttention`, line ~281)
- Test: `src/renderer/src/components/thread-report-button.test.ts` for the pure helper

**Interfaces:**
- Consumes: `api.reportThread` (Task 3), `Thread.reporting`, `Thread.reportedAt`.
- Produces: `reportButtonState(t: Thread): 'hidden' | 'disabled' | 'busy' | 'ready' | 'sent'`.

- [ ] **Step 1: Write the failing test** for `reportButtonState`:
  - not `done` → `'hidden'`; `retired` → `'hidden'`
  - done without `sessionId` → `'disabled'`
  - `reporting` → `'busy'`
  - `reportedAt` newer than the last `user` message → `'sent'`
  - otherwise → `'ready'`

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement** the helper and the button: label "Enviar resumo ao coordenador" (`ready`), "Escrevendo resumo…" disabled (`busy`), "Resumo enviado" with the button still clickable to resend (`sent`), disabled with title "A thread ainda não conversou" (`disabled`). Reuse `attn-actions` styles; icon `Send` from lucide (already a dependency).

- [ ] **Step 4: Run** `npm test`, `npm run typecheck` — Expected: pass. Manual check in the running app: a done thread shows the button; click → "Escrevendo resumo…" → a "Relatório da thread" message appears in the main chat and `.brandyterm/memoria.md` gains the notes.

- [ ] **Step 5: Commit** `feat(threads): botão Enviar resumo ao coordenador`
