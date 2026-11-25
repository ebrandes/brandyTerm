// Ready-made connectors offered in the panel.
import type { Preset } from '../../shared/connectors.ts'

export const PRESETS: Preset[] = [
  {
    id: 'railway',
    name: 'Railway',
    description: 'Deploys, logs e variáveis do Railway',
    transport: 'stdio',
    command: 'railway',
    args: ['mcp'],
    auth: { kind: 'cli', command: ['railway', 'login'], check: ['railway', 'whoami'] },
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Repositórios, issues e pull requests do GitHub',
    transport: 'http',
    url: 'https://api.githubcopilot.com/mcp/',
    auth: {
      kind: 'token',
      fields: [{ key: 'token', label: 'Token do GitHub', use: { header: 'Authorization', format: 'Bearer {value}' } }],
    },
  },
  {
    id: 'stripe',
    name: 'Stripe',
    description: 'Pagamentos, clientes e assinaturas do Stripe',
    transport: 'http',
    url: 'https://mcp.stripe.com',
    auth: { kind: 'oauth' },
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Projetos, banco de dados e funções do Supabase',
    transport: 'http',
    url: 'https://mcp.supabase.com/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description: 'Erros e performance do Sentry',
    transport: 'http',
    url: 'https://mcp.sentry.dev/mcp',
    auth: { kind: 'oauth' },
  },
  {
    id: 'chrome-devtools',
    name: 'Chrome DevTools',
    description: 'Controla e depura uma instância do Chrome',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'chrome-devtools-mcp@latest'],
    auth: { kind: 'none' },
  },
]

export function presetById(id: string): Preset | undefined {
  return PRESETS.find(p => p.id === id)
}
