import type { AgentId, Effort, Project, Thread } from '../shared/types.ts'
import { AGENT_NAMES } from '../shared/types.ts'

export interface PlannedTask {
  title: string
  objective: string
  agent: AgentId
  model?: string
  effort: Effort
  why?: string
}

export interface Answer {
  threadTitle: string
  text: string
}

export interface Plan {
  reply: string
  tasks: PlannedTask[]
  answers: Answer[]
}

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    answers: {
      type: 'array',
      items: {
        type: 'object',
        properties: { threadTitle: { type: 'string' }, text: { type: 'string' } },
        required: ['threadTitle', 'text']
      }
    },
    tasks: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          agent: { type: 'string', enum: ['claude', 'codex', 'gemini'] },
          model: { type: 'string' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          why: { type: 'string' }
        },
        required: ['title', 'objective', 'agent', 'effort']
      }
    }
  },
  required: ['reply', 'tasks']
}

function threadLine(t: Thread): string {
  if (t.state === 'waiting' && t.question) {
    return `- "${t.title}" (${AGENT_NAMES[t.agent]}, AGUARDANDO O USUÁRIO) pergunta: ${t.question.text}${t.question.options ? ` [opções: ${t.question.options.join(' | ')}]` : ''}`
  }
  const tail = t.summary ? ` — ${t.summary}` : t.note ? ` — ${t.note}` : ''
  return `- "${t.title}" (${AGENT_NAMES[t.agent]}, ${t.state})${tail}`
}

export function buildPlanPrompt(project: Project, available: AgentId[], userText: string): string {
  const procs = project.processes.length
    ? project.processes.map((x) => `- ${x.name}: \`${x.command}\` (${x.state}${x.ports.length ? `, portas ${x.ports.join(', ')}` : ''})`).join('\n')
    : '(nenhum)'
  const threads = project.threads.length ? project.threads.slice(-12).map(threadLine).join('\n') : '(nenhuma)'
  return `Você é o coordenador do projeto "${project.name}" no BrandyTerm. Pasta: ${project.path}.
Responda SOMENTE com um objeto JSON: {"reply": string, "tasks": [{"title","objective","agent","model"?,"effort","why"}], "answers": [{"threadTitle","text"}]}. Sem texto fora do JSON.

Regras:
- Pergunta simples, conversa ou "como está?": responda em "reply" com tasks=[]. Não crie threads para isso; use o estado das threads abaixo.
- Trabalho que precisa olhar o código, separável ou paralelizável: crie de 1 a 3 tasks. "reply" diz ao usuário, em 1-2 frases, o que foi delegado.
- Cada objective é autocontido, com critério de conclusão, porque a thread não vê esta conversa.
- Escolha o agente pelo assunto. Agentes disponíveis: ${available.map((a) => AGENT_NAMES[a]).join(', ')} (use o id em minúsculas: ${available.join(', ')}).
  claude: investigação de código, raciocínio sobre regras, revisão. codex: rodar/descobrir testes, comandos, verificação prática.
  model só para claude: haiku (tarefa simples), sonnet (padrão), opus (raciocínio difícil). Omita para codex.
  effort: low | medium | high, proporcional à dificuldade.
  why: uma frase curta dizendo por que esse agente/modelo/esforço (ex.: "codex: precisa executar comandos de teste").
- Se uma thread está AGUARDANDO O USUÁRIO e a mensagem do usuário responde essa pergunta, devolva em "answers" {threadTitle (exato), text (a resposta)} e diga em "reply" que repassou. Se não ficar claro a qual thread a resposta pertence, pergunte em "reply" citando os nomes. Sem resposta a repassar: answers=[].
- Processos em execução (servidores de dev, portas) são do usuário; você só os cita, não os controla.
- Prefira poucas threads bem delimitadas a muitas; não duplique trabalho entre threads.
- As threads são SOMENTE LEITURA nesta versão: não editam arquivos. Se o pedido exigir editar, delegue a investigação/plano e avise que a edição está desativada.
- Responda no idioma do usuário.

Threads atuais:
${threads}

Processos do projeto:
${procs}

Mensagem do usuário:
${userText}`
}

export function buildSynthesisPrompt(done: Thread[]): string {
  const body = done
    .map((t) => `### ${t.title} (${AGENT_NAMES[t.agent]}, ${t.state})\n${t.messages.at(-1)?.text ?? t.summary ?? '(sem resultado)'}`)
    .join('\n\n')
  return `As threads do pedido terminaram. Escreva a síntese final para o usuário em "reply" (2-4 frases): o que foi encontrado, o que foi verificado e o que segue pendente. Marque resultado parcial se alguma thread falhou. tasks=[]. Somente JSON.

${body}`
}

function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return undefined
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return undefined
  }
}

const EFFORTS = new Set(['low', 'medium', 'high'])

/** Validates the model's plan against what is really installed. The model proposes, this decides. */
export function parsePlan(
  structured: unknown,
  text: string,
  installed: Map<AgentId, string[]>
): Plan {
  const raw = (structured ?? extractJson(text)) as { reply?: unknown; tasks?: unknown } | undefined
  if (!raw || typeof raw.reply !== 'string') {
    return { reply: text.trim() || 'Não consegui interpretar a resposta do coordenador.', tasks: [], answers: [] }
  }
  const tasks: PlannedTask[] = []
  const fallback = [...installed.keys()][0]
  if (Array.isArray(raw.tasks)) {
    for (const t of raw.tasks.slice(0, 3)) {
      if (!t || typeof t.title !== 'string' || typeof t.objective !== 'string') continue
      const agent: AgentId | undefined = installed.has(t.agent) ? t.agent : fallback
      if (!agent) continue
      const models = installed.get(agent) ?? []
      tasks.push({
        title: t.title.slice(0, 60),
        objective: t.objective,
        agent,
        model: typeof t.model === 'string' && models.includes(t.model) ? t.model : undefined,
        effort: EFFORTS.has(t.effort) ? t.effort : 'medium',
        why: typeof t.why === 'string' ? t.why.slice(0, 160) : undefined
      })
    }
  }
  const answers: Answer[] = []
  const rawAnswers = (raw as { answers?: unknown }).answers
  if (Array.isArray(rawAnswers)) {
    for (const a of rawAnswers) {
      if (a && typeof a.threadTitle === 'string' && typeof a.text === 'string' && a.text.trim()) answers.push({ threadTitle: a.threadTitle, text: a.text })
    }
  }
  return { reply: raw.reply, tasks, answers }
}

export function buildThreadPrompt(project: Project, objective: string, agent: AgentId): string {
  const plan =
    agent === 'claude'
      ? 'Crie o plano com TaskCreate (3-6 tarefas curtas) e marque cada uma com TaskUpdate (in_progress ao começar, completed ao terminar).'
      : 'Mantenha um plano curto (3-6 itens) com a ferramenta de plano (update_plan) e atualize conforme avança.'
  return `Você é uma thread do BrandyTerm trabalhando no projeto "${project.name}" (pasta atual). Modo SOMENTE LEITURA: não edite nem crie arquivos e não rode comandos que alterem o projeto.

Objetivo:
${objective}

ANTES de agir, planeje. ${plan} Trabalhe direto e em silêncio: sem narrar cada passo.

Ao terminar, dê uma resposta FINAL curta (no máximo 12 linhas): resultado, evidências (arquivos e comandos) e pendências. Não cole logs, stack traces nem saída de comandos; cite só a linha decisiva.

Se faltar uma decisão do usuário que bloqueia o trabalho, NÃO adivinhe e NÃO faça a pergunta no meio do texto: encerre a resposta com a linha "PERGUNTA: <pergunta curta>" e, se houver alternativas, outra linha "OPCOES: a | b | c", e pare. Para dúvidas pequenas, escolha o padrão mais razoável e registre a suposição.

Se NÃO houver pergunta, termine com uma última linha: "RESUMO: <uma frase>". Responda no idioma do objetivo.`
}

export function extractSummary(text: string): string {
  const m = text.match(/RESUMO:\s*(.+)\s*$/im)
  if (m) return m[1].trim()
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? flat.slice(0, 197) + '…' : flat
}

/** A thread signals that it needs the user with a trailing PERGUNTA: line (and optional OPCOES:). */
export function extractQuestion(text: string): { text: string; options?: string[] } | undefined {
  const q = text.match(/^\s*PERGUNTA:\s*(.+)$/im)
  if (!q) return undefined
  const o = text.match(/^\s*OPCOES:\s*(.+)$/im)
  const options = o ? o[1].split('|').map((x) => x.trim()).filter(Boolean).slice(0, 6) : undefined
  return { text: q[1].trim(), options: options?.length ? options : undefined }
}
