import { ASK_RULE } from './ask-rule.ts'
import type { Effort, Project, Thread } from '../shared/types.ts'
import { buildThreadPrompt, extractQuestion } from './coordinator.ts'
import { MEMORY_REL } from './memory.ts'
import type { RunResult } from './run.ts'

/**
 * The two phases of a `pesado` Claude thread: the plan's model reads the code read-only and
 * writes a plan, then the thread's own model executes it in a fresh session. The engine asks
 * here how to run the thread now and what the end of a planning run means.
 */

/** the plan embedded in the execution prompt is held to this many characters */
export const PLAN_CLIP = 16000
/** what executes a thread whose planning phase failed: the old `pesado` */
const FALLBACK = { model: 'opus', effort: 'high' as Effort }

export const inPlan = (t: Thread): boolean => t.agent === 'claude' && !!t.plan && !t.plan.done

/** The model of the session the thread is in now (`t.sessionId`). */
export function sessionModel(t: Thread): { model?: string; effort: Effort } {
  return inPlan(t) ? { model: t.plan!.model, effort: t.plan!.effort } : { model: t.model, effort: t.effort }
}

export function runSpec(t: Thread): { model?: string; effort: Effort; tools: 'readonly' | 'work' } {
  return { ...sessionModel(t), tools: inPlan(t) ? 'readonly' : 'work' }
}

/** The prompt that opens the thread's current session: the plan, the execution of a plan, or the usual one. */
export function firstPrompt(project: Project, t: Thread): string {
  if (inPlan(t)) return planPrompt(project, t)
  return t.plan?.text ? execPrompt(project, t) : buildThreadPrompt(project, t.objective, t.agent, t.skill)
}

export type PlanOutcome = 'exec' | 'fallback' | 'settle'

/**
 * What a finished planning run means. `settle`: the usual end (a question, a final answer, a
 * cancel, also one the thread's state does not show: `cancelled`). `exec`: the plan is stored and the session freed for execution. `fallback`: planning
 * failed, so the thread is set to run once without a plan.
 */
export function afterPlan(t: Thread, r: RunResult, cancelled = false): PlanOutcome {
  const plan = t.plan!
  if (cancelled || (t.state as string) === 'cancelled') return 'settle'
  if (!r.done?.ok) {
    plan.done = true
    Object.assign(t, FALLBACK)
    t.sessionId = undefined
    return 'fallback'
  }
  const text = r.done.text
  if (extractQuestion(text)) return 'settle'
  plan.done = true
  // a final answer, not a plan: the thread stays in this session, so it takes this session's model
  if (/^\s*RESUMO:/m.test(text) && !/\*\*Passos:?\*\*/i.test(text)) {
    t.model = plan.model
    t.effort = plan.effort
    return 'settle'
  }
  plan.text = text.length > PLAN_CLIP ? `${text.slice(0, PLAN_CLIP)}\n[... plano cortado: confira o código antes de seguir]` : text
  plan.sessionId = t.sessionId
  t.sessionId = undefined
  return 'exec'
}

export function planPrompt(project: Project, t: Thread): string {
  return `Você é a fase de PLANO de uma thread do BrandyTerm no projeto "${project.name}" (pasta atual). Outro modelo vai executar o seu plano em seguida, numa conversa nova: ele não vê nada do que você leu, só o texto do plano.

Objetivo:
${t.objective}

Se existir ${MEMORY_REL}, leia antes de começar: é a memória do projeto (contexto, decisões, onde ficam as coisas).

Leia o código até entender o problema de verdade. NÃO edite arquivos e NÃO rode comandos que alteram algo: aqui você só lê (Read, Grep, Glob e comandos de consulta como git diff, ls, cat, rg). Você não consegue rodar testes nem o build; se o problema precisa ser reproduzido, faça disso o primeiro passo do plano. Acompanhe a leitura com TaskCreate/TaskUpdate (3-6 tarefas curtas) e trabalhe em silêncio.

Termine de UMA destas três formas:

1. O plano (o caso normal). Em markdown, sem "RESUMO:", com estas partes:
- **Entendimento:** o que o objetivo pede e a causa ou o desenho que você encontrou.
- **Arquivos:** cada \`caminho:linha\` e o que muda ali.
- **Passos:** em ordem, cada um verificável.
- **Armadilhas:** o que pode quebrar, o que parece certo e não é.
- **Como verificar:** comandos de teste e o resultado esperado (são propostas, você não rodou).
Aponte lugares em vez de reproduzir código; cole só o trecho que decide algo. No máximo cerca de 120 linhas.

2. Se faltar uma decisão do usuário que muda o plano, NÃO adivinhe: encerre a resposta assim: ${ASK_RULE} Para dúvidas pequenas, escolha o padrão mais razoável e registre a suposição no plano.

3. Se não há nada a mudar (o objetivo era investigar, revisar ou responder algo sobre o código), a sua resposta é a final: no máximo 12 linhas com resultado e evidências (arquivos e linhas), terminando com a linha "RESUMO: <uma frase>". Nesse caso não haverá execução.

Responda no idioma do objetivo.`
}

export function execPrompt(project: Project, t: Thread): string {
  return `${buildThreadPrompt(project, t.objective, t.agent, t.skill)}

Plano (feito por outro modelo, que leu o código mas não rodou nada). Siga-o e confira cada ponto no código antes de editar; se algo no plano estiver errado, corrija o rumo e diga no RESUMO:

${t.plan?.text ?? ''}`
}
