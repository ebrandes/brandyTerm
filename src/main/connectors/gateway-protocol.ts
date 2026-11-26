// Wire format between the per-thread gateway script and the main process:
// one JSON object per "\n"-terminated line over a local socket.
// `cancel` is not a request: it names, by `id`, an earlier request on the same socket that the agent gave up on.
// Main aborts that request (its login wait, its approval card, a running call) and sends no answer for either.
// `skills` carries one of SKILL_TOOLS (in `tool`) to the skills handler, for /skill-* threads only.
// `app` carries one of APP_TOOLS the same way, for every thread: they talk about BrandyTerm itself.
export interface GwRequest {
  id: number
  token: string
  op: 'list' | 'tools' | 'call' | 'cancel' | 'skills' | 'app'
  name?: string
  tool?: string
  args?: unknown
}

export type GwResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

export const MAX_LINE = 1_048_576
/** Largest connector result, in characters, that reaches the agent; calls.ts cuts there and adds a short note. */
export const MAX_RESULT = 100_000
/** Backstop for a whole reply, above MAX_RESULT and its note, so a result calls.ts capped is never cut again. */
export const MAX_REPLY = MAX_RESULT + 1_000

export const BAD_SESSION = 'Sessão do gateway inválida'
export const NOT_RESPONDING = 'BrandyTerm não está respondendo'
export const CALL_CANCELLED = 'Chamada cancelada'

export const TOOLS = [
  {
    name: 'list_connectors',
    description: 'Lista os conectores MCP disponíveis neste projeto.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'connector_tools',
    description: 'Lista as ferramentas de um conector.',
    inputSchema: {
      type: 'object' as const,
      properties: { name: { type: 'string', description: 'Nome do conector' } },
      required: ['name'],
    },
  },
  {
    name: 'call_connector',
    description: 'Chama uma ferramenta de um conector.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nome do conector' },
        tool: { type: 'string', description: 'Nome da ferramenta' },
        args: { type: 'object', description: 'Argumentos da ferramenta' },
      },
      required: ['name', 'tool'],
    },
  },
]

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object' as const, properties, required })
const text = (description: string) => ({ type: 'string', description })

/** Listed in every thread's gateway. Neither changes a file itself: queue_apply files a request the app applies later. */
export const APP_TOOLS = [
  {
    name: 'app_status',
    description: 'Diz o que está rodando no BrandyTerm agora, em todos os projetos (threads e coordenadores), e a fila de aplicações de worktrees. Use em vez de perguntar isso ao usuário.',
    inputSchema: obj({}),
  },
  {
    name: 'queue_apply',
    description: 'Pede para aplicar o que uma worktree commitou na pasta principal do projeto (git apply, sem commit). O app aplica sozinho quando nada estiver rodando, uma aplicação por vez; só pede aprovação ao usuário quando a mudança é no próprio BrandyTerm e exige reiniciá-lo. Faça commit na worktree antes.',
    inputSchema: obj(
      {
        worktree: text('Caminho da worktree'),
        title: text('O que será aplicado, em uma linha'),
        base: text('Opcional: commit a partir do qual aplicar (padrão: merge-base com a pasta principal). Use quando a worktree começa com um commit que copia mudanças não commitadas.'),
      },
      ['worktree', 'title'],
    ),
  },
]

/** Listed only in a /skill-* thread's gateway (BRANDY_GATEWAY_SKILLS=1). Every change asks the user first. */
export const SKILL_TOOLS = [
  {
    name: 'skills_catalog',
    description: 'Lista os itens do catálogo da biblioteca de skills e a lista atual do projeto.',
    inputSchema: obj({}),
  },
  {
    name: 'skills_add',
    description: 'Liga um item do catálogo neste projeto. Mostra um cartão ao usuário; se for um plugin que falta, instala.',
    inputSchema: obj({ id: text('Id do item no catálogo'), motivo: text('Por que serve a este projeto, em uma linha') }, ['id', 'motivo']),
  },
  {
    name: 'skills_remove',
    description: 'Tira um item da lista deste projeto (um item da base vai para "sem"). Mostra um cartão ao usuário.',
    inputSchema: obj({ id: text('Id do item'), motivo: text('Por que não serve mais, em uma linha') }, ['id', 'motivo']),
  },
  {
    name: 'skills_resolve',
    description: 'Lê a origem do /skill-install (URL do GitHub, dono/repo, dono/repo/pasta ou id do catálogo) e baixa o repositório para análise.',
    inputSchema: obj({ origem: text('Origem como o usuário escreveu') }, ['origem']),
  },
  {
    name: 'skills_import',
    description: 'Importa para a biblioteca o que skills_resolve baixou: roda a checagem de segurança, mostra um cartão por item, liga no projeto e faz o commit no clone da biblioteca.',
    inputSchema: obj(
      {
        staging: text('Pasta devolvida por skills_resolve'),
        itens: {
          type: 'array',
          description: 'Um por skill (ou o plugin escolhido), com descrição em pt-BR escrita a partir do SKILL.md',
          items: obj({ nome: text('Nome da skill ou do plugin'), descricao: text('Uma linha em pt-BR'), tags: { type: 'array', items: { type: 'string' } } }, ['nome', 'descricao']),
        },
        plugin: text('Numa loja de plugins: o plugin escolhido'),
      },
      ['staging', 'itens'],
    ),
  },
  {
    name: 'skills_push',
    description: 'Envia os commits da biblioteca para o GitHub (git push). Mostra um cartão ao usuário.',
    inputSchema: obj({}),
  },
]

/**
 * Splits a byte stream into "\n"-terminated lines. A line (or unterminated tail) longer than
 * MAX_LINE bytes is refused before it is parsed: feed() returns false and the caller drops the socket.
 */
export class LineReader {
  private buf: Buffer = Buffer.alloc(0)
  feed(chunk: Buffer, onLine: (line: string) => void): boolean {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk
    let nl: number
    while ((nl = this.buf.indexOf(10)) >= 0) {
      if (nl > MAX_LINE) return false
      const line = this.buf.subarray(0, nl).toString('utf8')
      this.buf = this.buf.subarray(nl + 1)
      onLine(line)
    }
    return this.buf.length <= MAX_LINE
  }
}
