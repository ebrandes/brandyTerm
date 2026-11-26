import type { AgentId, Effort, Project, Thread, Tier } from '../shared/types.ts'
import { AGENT_NAMES } from '../shared/types.ts'
import { MEMORY_REL, MEMORY_RULES, MEMORY_SCHEMA, memoryBlock, parseNotes, type MemoryNote } from './memory.ts'

export interface PlannedTask {
  title: string
  objective: string
  agent: AgentId
  model?: string
  effort: Effort
  /** the coordinator's level for /rota; absent when it gave none */
  tier?: Tier
  /** set by /rota: `pesado+` */
  boost?: boolean
  /** set by /rota: the planning phase's model and effort */
  plan?: { model: string; effort: Effort }
  why?: string
  skill?: string
  /** exact title of an interrupted/failed thread this task takes over; the old one is set aside */
  replaces?: string
}

/** How text shown in the chat should look; the chat renders it as markdown. */
const REPLY_FORMAT = `Formato do "reply" (o chat renderiza markdown; use quebras de linha reais, nunca o texto "\\n" escrito por extenso):
  - Parágrafos curtos (1-3 frases), separados por linha em branco. Nunca um parágrafo único e longo.
  - Passos em ordem viram lista numerada; itens soltos, lista com "-".
  - Rótulos em negrito no início do item ou da linha (ex.: "**Resultado:** ...", "**Pendente:** ...").
  - Caminhos, comandos e nomes de código entre crases; comandos de várias linhas em bloco \`\`\` com a linguagem.
  - Títulos "###" só quando a resposta tiver seções distintas; respostas curtas dispensam títulos.`

export interface Answer {
  threadTitle: string
  text: string
}

export interface Plan {
  reply: string
  tasks: PlannedTask[]
  answers: Answer[]
  /** questions for threads (title + question); the thread's reply comes back to the coordinator */
  ask: Answer[]
  /** interrupted threads to continue, with the message that resumes each */
  resume: Answer[]
  /** notes for the project memory */
  memory: MemoryNote[]
}

const REPLY_LIST = {
  type: 'array',
  items: {
    type: 'object',
    properties: { threadTitle: { type: 'string' }, text: { type: 'string' } },
    required: ['threadTitle', 'text']
  }
}

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    memory: MEMORY_SCHEMA,
    answers: REPLY_LIST,
    ask: REPLY_LIST,
    resume: REPLY_LIST,
    tasks: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          objective: { type: 'string' },
          agent: { type: 'string', enum: ['claude', 'codex', 'antigravity'] },
          model: { type: 'string' },
          effort: { type: 'string', enum: ['low', 'medium', 'high'] },
          tier: { type: 'string', enum: ['leve', 'padrao', 'pesado'] },
          why: { type: 'string' },
          skill: { type: 'string' },
          replaces: { type: 'string' }
        },
        required: ['title', 'objective', 'agent', 'effort']
      }
    }
  },
  required: ['reply', 'tasks']
}

function threadLine(t: Thread): string {
  if (t.state === 'waiting' && t.question) {
    const opts = t.question.options?.map((o, i) => (i === 0 && t.question?.recommended ? `${o} (recomendada)` : o))
    return `- "${t.title}" (${AGENT_NAMES[t.agent]}, AGUARDANDO O USUÁRIO) pergunta: ${t.question.text}${opts ? ` [opções: ${opts.join(' | ')}]` : ''}`
  }
  if (t.retired) {
    const why = t.retired.reason === 'superseded' ? `substituída${t.retired.byTitle ? ` por "${t.retired.byTitle}"` : ''}` : 'descartada'
    return `- "${t.title}" (${AGENT_NAMES[t.agent]}, ${why})`
  }
  const tail = t.summary ? ` — ${t.summary}` : t.note ? ` — ${t.note}` : ''
  const state = t.state === 'interrupted' ? 'INTERROMPIDA, pode ser retomada' : t.state
  return `- "${t.title}" (${AGENT_NAMES[t.agent]}, ${state})${tail}`
}

/** the last 12 threads, plus older ones still open (waiting or interrupted) so they can be resumed */
function listedThreads(threads: Thread[]): Thread[] {
  const recent = threads.slice(-12)
  const open = threads.slice(0, -12).filter((t) => !t.retired && (t.state === 'waiting' || t.state === 'interrupted'))
  return [...open, ...recent]
}

/** the last chat lines, for a coordinator session that was just restarted */
function recentChat(project: Project): string {
  const lines = project.messages
    .filter((m) => (m.author === 'user' || m.author === 'coordinator') && m.text.trim())
    .slice(-6)
    .map((m) => `${m.author === 'user' ? 'Usuário' : 'Você'}: ${m.text.replace(/\s+/g, ' ').slice(0, 300)}`)
  return lines.length ? `\nConversa recente (sua sessão foi reiniciada; a memória acima guarda o resto):\n${lines.join('\n')}\n` : ''
}

export function buildPlanPrompt(project: Project, available: AgentId[], userText: string, skills: string[] = [], fresh = false): string {
  const procs = project.processes.length
    ? project.processes.map((x) => `- ${x.name}: \`${x.command}\` (${x.state}${x.ports.length ? `, portas ${x.ports.join(', ')}` : ''})`).join('\n')
    : '(nenhum)'
  const threads = project.threads.length ? listedThreads(project.threads).map(threadLine).join('\n') : '(nenhuma)'
  return `Você é o coordenador do projeto "${project.name}" no BrandyTerm. Pasta: ${project.path}.
Responda SOMENTE com um objeto JSON: {"reply": string, "tasks": [{"title","objective","agent","tier","model"?,"effort","why","replaces"?}], "answers": [{"threadTitle","text"}], "ask": [{"threadTitle","text"}], "resume": [{"threadTitle","text"}], "memory": [{"section","text"}]}. Sem texto fora do JSON.

Regras:
- Pergunta simples, conversa ou "como está?": responda em "reply" com tasks=[]. Não crie threads para isso; use o estado das threads abaixo.
- Trabalho que precisa olhar o código, separável ou paralelizável: crie de 1 a 3 tasks. "reply" diz ao usuário, em 1-2 frases, o que foi delegado.
- Cada objective é autocontido, com critério de conclusão, porque a thread não vê esta conversa.
- Escolha o agente pelo assunto. Agentes disponíveis: ${available.map((a) => AGENT_NAMES[a]).join(', ')} (use o id em minúsculas: ${available.join(', ')}).
  claude: investigação de código, raciocínio sobre regras, revisão. codex: rodar/descobrir testes, comandos, verificação prática.
  tier: o nível da tarefa, que decide o modelo e se ela é planejada antes.
    leve: consulta, busca, mudança mecânica de uma linha, renomear, formatar.
    padrao: mudança delimitada com caminho claro, em poucos arquivos.
    pesado: precisa entender antes de mexer (vários módulos, decisão de desenho, bug sem causa conhecida, risco de quebrar o que funciona). Outro modelo lê o código e planeja antes da execução.
    Na dúvida, o nível de baixo: se falhar, a próxima tentativa sobe sozinha. Se o pedido é refazer algo que uma thread entregou errado, use um nível acima do dela.
    Em task pesado, o objective descreve o problema, a evidência e o critério de conclusão, sem ditar passos nem arquivos "prováveis": você não lê o código, quem decide o como é o plano.
  model (só claude: haiku, sonnet, opus; omita para codex) e effort: low | medium | high valem quando a rota automática está desligada.
  why: uma frase curta dizendo por que esse agente e esse nível (ex.: "codex: precisa executar comandos de teste").${
    skills.length
      ? `\n  skill (opcional, só claude): o nome exato de UMA skill que a thread deve carregar antes de começar, quando ela claramente se encaixa (ex.: depurar um bug: superpowers:systematic-debugging; planejar: superpowers:writing-plans; revisar: superpowers:requesting-code-review). Omita na dúvida. Skills: ${skills.join(', ')}.`
      : ''
  }
- Se uma thread está AGUARDANDO O USUÁRIO e a mensagem do usuário responde essa pergunta, devolva em "answers" {threadTitle (exato), text (a resposta)} e diga em "reply" que repassou. Se não ficar claro a qual thread a resposta pertence, pergunte em "reply" citando os nomes. Sem resposta a repassar: answers=[].
- Para saber detalhes do que uma thread fez ou decidiu (o resumo acima não basta), devolva em "ask" {threadTitle (exato), text (a pergunta)}; a thread responde e você recebe a resposta para responder ao usuário. Diga em "reply" que foi perguntar. Sem pergunta: ask=[].
- Threads INTERROMPIDAS (o app fechou ou reiniciou no meio) podem ser retomadas. Quando o usuário pedir para continuar ou retomar ("continue", "continue as threads", "retome"), devolva em "resume" {threadTitle (o título exato, entre aspas abaixo), text (instrução curta, ex.: "Continue de onde parou.")} para cada thread interrompida que ele quer de volta e não crie tasks novas para o mesmo trabalho. Se não ficar claro quais threads, pergunte em "reply" citando os nomes. Sem retomada: resume=[].
- Só se for melhor recomeçar do zero uma thread interrompida ou com falha, crie a task com "replaces" (título exato da antiga): ela fica marcada como substituída pela nova.
- Processos em execução (servidores de dev, portas) são do usuário; você só os cita, não os controla.
- Aplicar uma worktree na pasta principal é com a fila do app: a thread faz commit na worktree e chama queue_apply; o app aplica sozinho, depois da aprovação, quando nada estiver rodando. Nunca peça ao usuário para confirmar que não há threads rodando, nem escreva em objective que a thread espere por isso ou aplique à mão.
- Prefira poucas threads bem delimitadas a muitas; não duplique trabalho entre threads.
- As threads podem ler, rodar comandos e editar arquivos do projeto. Comandos que alteram algo e edições passam por aprovação do usuário dentro da própria thread, então delegue também o trabalho de executar e corrigir, não só investigar.
- Responda no idioma do usuário.
${REPLY_FORMAT}
- Use a memória do projeto para responder sem mandar investigar de novo o que já se sabe.
${MEMORY_RULES}

${project.path ? memoryBlock(project.path) : ''}
${fresh ? recentChat(project) : ''}
Threads atuais:
${threads}

Processos do projeto:
${procs}

Mensagem do usuário:
${userText}`
}

export function buildSynthesisPrompt(done: Thread[], root?: string | null): string {
  const body = done
    .map((t) => `### ${t.title} (${AGENT_NAMES[t.agent]}, ${t.state}${t.pending ? `, PENDENTE: ${t.pending}` : t.resolved ? ', resolvida' : ''})\n${t.messages.at(-1)?.text ?? t.summary ?? '(sem resultado)'}`)
    .join('\n\n')
  return `As threads do pedido terminaram. Escreva a síntese final para o usuário em "reply", curta: o que foi encontrado, o que foi verificado e o que segue pendente, de preferência como itens com rótulo em negrito ("**Resultado:**", "**Verificado:**", "**Pendente:**"). Marque resultado parcial se alguma thread falhou. tasks=[]. Somente JSON.
${REPLY_FORMAT}
Atualize a memória do projeto em "memory" com o que estas threads descobriram ou decidiram.
${MEMORY_RULES}

${root ? memoryBlock(root) + '\n\n' : ''}${body}`
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
const TIER_NAMES = new Set(['leve', 'padrao', 'pesado'])

/** answers and resumes: entries with a title and a non-empty text */
function replyList(raw: unknown): Answer[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((a) => a && typeof a.threadTitle === 'string' && a.threadTitle.trim() && typeof a.text === 'string' && a.text.trim())
    .map((a) => ({ threadTitle: a.threadTitle, text: a.text }))
}

/** Validates the model's plan against what is really installed. The model proposes, this decides. */
export function parsePlan(
  structured: unknown,
  text: string,
  installed: Map<AgentId, string[]>
): Plan {
  const raw = (structured ?? extractJson(text)) as { reply?: unknown; tasks?: unknown } | undefined
  if (!raw || typeof raw.reply !== 'string') {
    return { reply: text.trim() || 'Não consegui interpretar a resposta do coordenador.', tasks: [], answers: [], ask: [], resume: [], memory: [] }
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
        tier: TIER_NAMES.has(t.tier) ? t.tier : undefined,
        why: typeof t.why === 'string' ? t.why.slice(0, 160) : undefined,
        skill: agent === 'claude' && typeof t.skill === 'string' && /^[\w:.-]{2,80}$/.test(t.skill) ? t.skill : undefined,
        replaces: typeof t.replaces === 'string' && t.replaces.trim() ? t.replaces : undefined
      })
    }
  }
  const rawAnswers = (raw as { answers?: unknown }).answers
  return { reply: unescapeReply(raw.reply), tasks, answers: replyList(rawAnswers), ask: replyList((raw as { ask?: unknown }).ask), resume: replyList((raw as { resume?: unknown }).resume), memory: parseNotes((raw as { memory?: unknown }).memory) }
}

export function buildThreadPrompt(project: Project, objective: string, agent: AgentId, skill?: string): string {
  const plan =
    agent === 'claude'
      ? 'Crie o plano com TaskCreate (3-6 tarefas curtas) e marque cada uma com TaskUpdate (in_progress ao começar, completed ao terminar).'
      : 'Mantenha um plano curto (3-6 itens) com a ferramenta de plano (update_plan) e atualize conforme avança.'
  return `Você é uma thread do BrandyTerm trabalhando no projeto "${project.name}" (pasta atual). Você pode ler, rodar comandos e editar arquivos do projeto. Leitura e comandos de consulta rodam direto; comandos que alteram algo, edições e acesso à web pedem aprovação do usuário automaticamente: chame a ferramenta normalmente e espere. Se o usuário negar, siga sem aquilo ou pergunte. Serviços externos (Railway, GitHub e outros) ficam disponíveis pelas ferramentas list_connectors, connector_tools e call_connector; use só quando a tarefa precisar. Para levar o que você fez numa git worktree à pasta principal do projeto, faça commit na worktree e chame queue_apply (o usuário aprova uma vez no app, que aplica quando nada estiver rodando): não aplique à mão, não peça confirmação para isso e nunca pergunte ao usuário se há threads rodando (app_status responde isso). Faça o trabalho até o fim (inclusive rodar testes e verificar) em vez de deixar como pendente.

Objetivo:
${objective}
${agent === 'claude' && skill ? `\nComece carregando a skill "${skill}" com a ferramenta Skill e siga o processo dela.\n` : ''}
Se existir ${MEMORY_REL}, leia antes de começar: é a memória do projeto (contexto, decisões, onde ficam as coisas).

ANTES de agir, planeje. ${plan} Trabalhe direto e em silêncio: sem narrar cada passo.

Ao terminar, dê uma resposta FINAL curta (no máximo 12 linhas): resultado, evidências (arquivos e comandos) e pendências. Não cole logs, stack traces nem saída de comandos; cite só a linha decisiva. Escreva em markdown: itens com "-" e rótulo em negrito ("**Resultado:**", "**Evidências:**", "**Pendências:**"), caminhos e comandos entre crases, nada de um parágrafo único longo.

Se faltar uma decisão do usuário que bloqueia o trabalho, NÃO adivinhe e NÃO faça a pergunta no meio do texto: encerre a resposta com a linha "PERGUNTA: <pergunta curta>" e, se houver alternativas, outra linha "OPCOES: *a | b | c", e pare. Marque com * no início a opção que você recomenda (no máximo uma); sem recomendação, não marque nenhuma. Para dúvidas pequenas, escolha o padrão mais razoável e registre a suposição.

Se ficar algo que você realmente não conseguiu concluir (o usuário negou uma ação, falta acesso ou uma decisão para depois), escreva uma linha "PENDENTE: <o que falta, curto>". Se o objetivo foi cumprido por inteiro, NÃO escreva essa linha.

Se NÃO houver pergunta, termine com uma última linha: "RESUMO: <uma frase>". Responda no idioma do objetivo.`
}

export function extractSummary(text: string): string {
  const m = text.match(/RESUMO:\s*(.+)\s*$/im)
  if (m) return m[1].trim()
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 200 ? flat.slice(0, 197) + '…' : flat
}

/** A thread lists what is still open with a PENDENTE: line; "nenhum"/"nada" counts as nothing. */
export function extractPending(text: string): string | undefined {
  const m = text.match(/^\s*PENDENTE:\s*(.+)$/im)
  const v = m?.[1].trim()
  if (!v || /^(nenhum|nenhuma|nada|n\/a|-)\.?$/i.test(v)) return undefined
  return v.slice(0, 240)
}

export { extractQuestion } from '../shared/ask-question.ts'

/**
 * Some replies arrive escaped twice: the line breaks as the literal text "\\n" and code
 * fences without their backticks. Restores both so the chat renders the markdown.
 */
export function unescapeReply(text: string): string {
  if (!/\\n/.test(text)) return text
  let out = text.replace(/\\r\\n|\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\"/g, '"')
  // "...:\nbash\ncmd\n\nNext" lost its fence: a lone language word opens a block that ends at the blank line
  out = out.replace(/(^|\n)(bash|sh|shell|zsh|ts|typescript|js|javascript|json|python|py|diff|sql)\n([\s\S]*?)(?=\n\n|$)/g, (_m, pre, lang, body) => `${pre}\`\`\`${lang}\n${body}\n\`\`\``)
  return out
}
