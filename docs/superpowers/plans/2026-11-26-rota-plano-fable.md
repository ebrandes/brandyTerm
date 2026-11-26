# Rota recalibrada e fase de plano no Fable — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O coordenador decide o nível de cada task; threads Claude `pesado` rodam plano (Fable, somente leitura) e depois execução (Sonnet) no mesmo cartão.

**Architecture:** O nível viaja no JSON do coordenador e `routeTasks` vira função pura com dependências injetadas (modo, classificador haiku, nível da thread substituída). As fases ficam num módulo puro (`phases.ts`) que diz como rodar a thread agora e o que fazer quando a rodada termina; `startThread` sai de `engine.ts` para `thread-run.ts` e consulta esse módulo.

**Tech Stack:** TypeScript, Electron (main/renderer), `node --test`, Claude Agent SDK + CLI.

**Spec:** `docs/superpowers/specs/2026-11-26-rota-plano-fable-design.md`

## Global Constraints

- Nenhum arquivo de código acima de 400 linhas (`engine.ts` 395, `shared/types.ts` 376).
- `Effort` continua `low | medium | high`; campos novos de `Thread` são opcionais.
- Textos de interface e prompts de thread em pt-BR.
- Testes com `node --test "src/**/*.test.ts"`, sem chamar modelo.
- Não tocar no trabalho não commitado em `src/renderer/src/components/` (`Chat.tsx`, `ThreadReportButton.tsx`, `thread-report-button*.ts`).
- Degraus: `leve` haiku/low · `padrao` sonnet/medium · `pesado` plano fable/medium + sonnet/medium · `pesado+` plano fable/medium + opus/high.
- Commit só se o usuário pedir; os passos "Commit" abaixo ficam pendentes até lá.

## Review Focus

1. Coordenador Codex devolve task sem `tier` → cai no haiku; haiku falha → modelo/esforço do coordenador, sem fase de plano.
2. Fase de plano falha por limite/indisponibilidade → uma rodada única Opus/high; cancelamento não aciona a reserva.
3. Usuário responde a `PERGUNTA:` do plano → retoma a sessão do plano em Fable somente leitura, depois executa e reporta direto.
4. Plano termina com `RESUMO:` → thread `done` sem execução.
5. Thread salva antes desta versão (sem `tier`/`plan`) → roda como hoje; substituí-la conta como `padrao`.

---

### Task 1: Nível no plano do coordenador

**Files:**
- Modify: `src/shared/types.ts` (tipos), `src/main/coordinator.ts` (schema, parse, prompt), `src/main/router.ts` (reexporta `Tier` de shared)
- Test: `src/main/coordinator.test.ts`

**Interfaces — Produces:**
```ts
// shared/types.ts
export type Tier = 'leve' | 'padrao' | 'pesado'
export interface ThreadPlan { model: string; effort: Effort; sessionId?: string; text?: string; usage?: Usage; done?: boolean }
// Thread ganha: tier?: Tier; boost?: boolean; plan?: ThreadPlan; direct?: boolean
// coordinator.ts — PlannedTask ganha: tier?: Tier; boost?: boolean; plan?: { model: string; effort: Effort }
```

- [ ] **Step 1: testes** em `coordinator.test.ts`: `parsePlan` mantém `tier: 'pesado'`; descarta `tier: 'enorme'` (fica `undefined`); `PLAN_SCHEMA...tasks.items.properties.tier.enum` é `['leve','padrao','pesado']`; `buildPlanPrompt(...)` contém `"tier"` e `Na dúvida, o nível de baixo` e ainda contém `effort: low | medium | high`.
- [ ] **Step 2:** rodar `node --test src/main/coordinator.test.ts` → falha.
- [ ] **Step 3:** implementar. No prompt: `"tier"` entra na lista de campos da task; depois da linha do `why`, a régua da spec (leve / padrao / pesado, "Na dúvida, o nível de baixo: se falhar, a próxima tentativa sobe sozinha", "refazer algo que uma thread entregou errado: um nível acima") e a regra do objetivo em `pesado` (problema, evidência, critério; sem passos nem arquivos prováveis). As linhas de `model`/`effort` ficam numa só.
- [ ] **Step 4:** teste passa. **Step 5:** Commit `feat(rota): nível no plano do coordenador`.

### Task 2: Rota pelo nível, subida na falha, atalhos

**Files:**
- Modify: `src/main/router.ts`, `src/main/engine.ts:248` (chamada), `src/main/new-thread.ts` (copia `tier`, `boost`, `plan`)
- Test: `src/main/router.test.ts` (novo)

**Interfaces — Produces:**
```ts
export type Override = { kind: 'none' | 'skip' | 'plan'; text: string } | { kind: 'model'; model: string; text: string }
export interface RouteDeps {
  mode: Mode
  classify: ((objective: string) => Promise<Tier | null>) | null   // null: Claude não instalado
  previous: (task: PlannedTask) => { tier?: Tier; boost?: boolean } | null  // thread failed/interrupted que a task substitui
}
export async function routeTasks(tasks: PlannedTask[], override: Override, deps: RouteDeps): Promise<PlannedTask[]>
export function routeDeps(cwd: string, threads: Thread[], hasClaude: boolean): RouteDeps  // readMode + classify + matchThread
```

Regras (ordem): `model` → modelo forçado, fase única, em qualquer modo; `skip` → inalterado; `plan` → todas as tasks Claude viram `pesado`, em qualquer modo; `off` → inalterado; nível = `task.tier` ?? `classify` ?? nenhum (mantém escolha do coordenador, nota `sem classificação`); subida: com `previous`, nível = maior entre o da task e o degrau acima do antigo (antigo sem nível = `padrao`; `pesado` → `pesado` com `boost`; `pesado+` continua `pesado+`); `aviso` só anota. Aplicação em Claude: `leve`/`padrao` → modelo+esforço; `pesado` → `model: 'sonnet', effort: 'medium'` (com `boost`: `opus`/`high`) e `plan: { model: 'fable', effort: 'medium' }`. Codex: só esforço (`pesado` → `high`). Antigravity: intocado. `RUBRIC`: trocar a linha do empate por `When torn between two tiers, answer the lower one: a failed attempt is retried one tier up.`

Notas em `why`: `rota: pesado · plano fable → sonnet`, `rota: pesado+ (substitui falha) · plano fable → opus`, `rota: padrao (haiku)`, `rota: padrao (sobe: substitui falha)`.

- [ ] **Step 1: testes** (`deps` falsos): tier do coordenador aplicado sem chamar `classify` (contador = 0); sem tier chama `classify`; `classify` devolve `null` → task inalterada com nota; `pesado` Claude ganha `plan` e modelo `sonnet`; `pesado` com `skill` também ganha `plan`; Codex `pesado` → só `effort: 'high'`, sem `plan`; `previous` `{tier:'leve'}` + task `leve` → `padrao`; `previous` `{tier:'pesado'}` → `boost` e `opus`/`high`; `previous` `{}` + task `leve` → `pesado`; `aviso` não muda modelo; `off` + `!opus` força opus; `off` + `!plano` dá `plan`; `parseOverride('!plano faz x')` → `{kind:'plan', text:'faz x'}`.
- [ ] **Step 2–4:** falha → implementar → passa. Em `engine.ts` a chamada vira `routeTasks(plan.tasks, route, routeDeps(p.path!, p.threads, this.installed().has('claude')))`.
- [ ] **Step 5:** Commit `feat(rota): rota pelo nível do coordenador, subida na falha e !plano`.

### Task 3: Módulo de fases

**Files:**
- Create: `src/main/phases.ts`, `src/main/phases.test.ts`

**Interfaces — Produces:**
```ts
export const inPlan = (t: Thread): boolean            // t.agent === 'claude' && !!t.plan && !t.plan.done
export function sessionModel(t: Thread): { model?: string; effort: Effort }   // do plano enquanto inPlan
export function runSpec(t: Thread): { model?: string; effort: Effort; tools: 'readonly' | 'work' }
export function planPrompt(project: Project, t: Thread): string
export function execPrompt(project: Project, t: Thread): string   // buildThreadPrompt + plano; skill só aqui
export type PlanOutcome = 'exec' | 'fallback' | 'settle'
export function afterPlan(t: Thread, r: RunResult): PlanOutcome
export const PLAN_CLIP = 16000
```

`afterPlan` (só chamado com `inPlan`): cancelada → `settle`. Falhou → `t.plan.done = true`, `t.model = 'opus'`, `t.effort = 'high'`, `t.sessionId = undefined` → `fallback`. Ok com `PERGUNTA:` (via `extractQuestion`) ou com `RESUMO:` (via `extractSummary`) → `settle` (com `RESUMO:` marca `plan.done = true`). Ok com plano → `plan.text` (cortado em `PLAN_CLIP`), `plan.sessionId = t.sessionId`, `t.sessionId = undefined`, `plan.done = true` → `exec`. `planPrompt`: projeto e objetivo, memória do projeto, "não edite nem rode comando que altera", formato do plano da spec (entendimento; arquivos `caminho:linha` e o que muda; passos; armadilhas; como verificar), os três finais (`PERGUNTA:`/`OPCOES:` como em `buildThreadPrompt`; `RESUMO:` quando não há nada a mudar e a resposta é final; senão termina no plano, sem `RESUMO:`), TaskCreate para acompanhar. `execPrompt`: `buildThreadPrompt(...)` + bloco `Plano (feito por outro modelo que leu o código). Siga-o, confira cada ponto antes de editar; se algo no plano estiver errado, corrija o rumo e diga no RESUMO:` + `t.plan.text`.

- [ ] **Step 1: testes:** `runSpec` de thread com plano pendente = fable/medium/readonly e depois de `done` = modelo da thread/work; thread sem plano ou Codex = work; `afterPlan` nos cinco casos acima com os campos conferidos; plano de 20 000 caracteres é cortado; `execPrompt` contém o texto do plano e a linha da skill, `planPrompt` não contém a skill; `sessionModel` devolve fable durante o plano.
- [ ] **Step 2–4:** falha → implementar → passa. **Step 5:** Commit `feat(threads): módulo de fases plano/execução`.

### Task 4: Ligação no motor

**Files:**
- Create: `src/main/thread-run.ts` (corpo de `startThread`, recebe o motor)
- Modify: `src/main/engine.ts` (`startThread` delega; `pump` e `sendToThread` usam o prompt da fase), `src/main/thread-report-host.ts` (usa `sessionModel`)
- Test: `src/main/thread-run.test.ts` (novo, com adaptador falso se `runOnce` permitir injeção; senão testar a função de decisão pós-rodada isolada)

**Interfaces — Consumes:** tudo da Task 3. **Produces:** `runThread(engine, p, t, prompt, direct, attachments)`.

Comportamento: `t.direct = direct` no início. Opções de `runOnce` vêm de `runSpec(t)`. Uso da rodada soma em `t.usage` e, se a rodada foi de plano, também em `t.plan.usage`. Depois da rodada, se ela foi de plano: `afterPlan` → `exec`: empurra mensagem `agent` com o plano (`extra: { plan: true }` — acrescentar `plan?: boolean` em `Message`), e chama `runThread(..., execPrompt(p, t), t.direct, t.attachments)` sem `settleThread`, síntese nem `pump`; `fallback`: mensagem `system` `Plano indisponível (<erro>): seguindo em fase única com opus.` e roda `buildThreadPrompt` normal; `settle`: caminho de hoje. `pump` usa `inPlan(t) ? planPrompt : buildThreadPrompt`. `sendToThread` com thread sem sessão usa o prompt da fase; com sessão, o texto do usuário como hoje.

- [ ] **Step 1: testes** dos três desfechos (ordem das mensagens, estado continua `running` entre fases, `direct` preservado, `plan.usage` preenchido).
- [ ] **Step 2–4:** falha → implementar → passa; `wc -l src/main/engine.ts` < 400.
- [ ] **Step 5:** Commit `feat(threads): fase de plano no Fable antes da execução`.

### Task 5: Selos na interface

**Files:**
- Create: `src/shared/thread-phase.ts` + teste
- Modify: `ThreadCard.tsx:145`, `Board.tsx:45`, `BoardDetail.tsx:49`, `ThreadMetaChips.tsx:42`, componente que desenha mensagens da thread (rótulo "Plano" quando `message.plan`)

**Interfaces — Produces:** `export function modelLabel(t: Thread): string` → `'plano · fable'` durante o plano; `'sonnet'` depois, e `planNote(t): string | undefined` → `'plano: fable'` quando houve plano.

- [ ] **Step 1–4:** teste de `modelLabel`/`planNote` → implementar → trocar `t.model` pelos helpers nos quatro lugares.
- [ ] **Step 5:** Commit `feat(ui): fase da thread nos selos`.

### Task 6: Verificação

- [ ] `npm test` → tudo passa. `npx tsc --noEmit -p .` (ou o script de typecheck do `package.json`) → sem erros.
- [ ] `find src -name '*.ts*' | xargs wc -l | awk '$1>400'` → só o total.
- [ ] Rodar o app e mandar `!plano <tarefa pequena>`: cartão mostra `plano · fable`, depois troca para `sonnet`, plano visível na thread.
