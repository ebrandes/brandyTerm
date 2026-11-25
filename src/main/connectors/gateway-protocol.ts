// Wire format between the per-thread gateway script and the main process:
// one JSON object per "\n"-terminated line over a local socket.
export interface GwRequest {
  id: number
  token: string
  op: 'list' | 'tools' | 'call'
  name?: string
  tool?: string
  args?: unknown
}

export type GwResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

export const MAX_LINE = 1_048_576
/** Largest connector result, in characters, that crosses the socket and reaches the agent. */
export const MAX_RESULT = 100_000

export const BAD_SESSION = 'Sessão do gateway inválida'
export const NOT_RESPONDING = 'BrandyTerm não está respondendo'

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
