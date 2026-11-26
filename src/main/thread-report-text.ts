import type { MemoryNote } from './memory.ts'

export type ReportKind = 'curto' | 'completo'

export interface Report {
  feito?: string
  decidido?: string
  arquivos?: string
  pendente?: string
  /** the whole answer, trimmed and uncut */
  texto: string
}

const EMPTY_RE = /^(nada|nenhum|nenhuma|-)[.!;,]*$/i
// scoped to this answer: a killed silent turn may leave it in the session before the user's next message
const NO_CHANGES = 'Não altere arquivos nem rode comandos nesta resposta.'
// RESUMO/PERGUNTA/OPCOES (the thread's own closing lines) end the current label and are not kept
const LABEL_RE = /^\s*(?:[-*]\s+)?\**\s*(FEITO|DECIDIDO|ARQUIVOS|PENDENTE|RESUMO|PERGUNTA|OPCOES)\**\s*:\**/i
const STOP = new Set(['resumo', 'pergunta', 'opcoes'])
const FIELDS = [
  ['feito', 'Feito'],
  ['decidido', 'Decidido'],
  ['arquivos', 'Arquivos'],
  ['pendente', 'Pendente']
] as const
/** raw text shown when no label was parsed */
const RAW_MAX: Record<ReportKind, number> = { curto: 600, completo: 2000 }
const SHORT_MAX = 200

export function reportPrompt(kind: ReportKind): string {
  if (kind === 'curto') {
    return (
      'Escreva um resumo curto desta thread para o coordenador do projeto, de 3 a 5 linhas no total, ' +
      'só com estas linhas:\n' +
      'FEITO: …\n' +
      'DECIDIDO: … (ou "nada")\n' +
      'ARQUIVOS: … (principais, separados por vírgula)\n' +
      NO_CHANGES
    )
  }
  return (
    'Escreva um resumo desta thread para o coordenador do projeto, cobrindo a conversa inteira, ' +
    'em até 15 linhas, só com estas linhas:\n' +
    'FEITO: …\n' +
    'DECIDIDO: … (ou "nada")\n' +
    'ARQUIVOS: … (principais, separados por vírgula)\n' +
    'PENDENTE: … (ou "nada")\n' +
    NO_CHANGES
  )
}

export function askPrompt(question: string): string {
  return (
    `O coordenador do projeto pergunta: ${question}\n` +
    `Responda em até 10 linhas, com o que você sabe desta thread. ${NO_CHANGES}`
  )
}

export function followUpPrompt(title: string, question: string, answer: string): string {
  return (
    `A thread “${title}” respondeu à sua pergunta.\n` +
    `Pergunta: ${question}\n` +
    `Resposta: ${answer}\n` +
    'Escreva em "reply" a resposta para o usuário, com tasks=[]. Responda somente com o JSON.'
  )
}

function clean(value: string): string | undefined {
  const v = value.replace(/\s+/g, ' ').trim()
  return !v || EMPTY_RE.test(v) ? undefined : v
}

export function parseReport(text: string): Report {
  const trimmed = text.trim()
  const values: Record<string, string> = {}
  let current: string | null = null
  for (const line of trimmed.split('\n')) {
    const m = LABEL_RE.exec(line)
    if (m) {
      const label = m[1].toLowerCase()
      current = STOP.has(label) ? null : label
      if (current) values[current] = line.slice(m[0].length)
    } else if (current) {
      values[current] += ' ' + line
    }
  }
  return {
    feito: clean(values.feito ?? ''),
    decidido: clean(values.decidido ?? ''),
    arquivos: clean(values.arquivos ?? ''),
    pendente: clean(values.pendente ?? ''),
    texto: trimmed
  }
}

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** The visible report (markdown): one item per field, or the raw answer when it had no labels. */
export function reportBody(r: Report, kind: ReportKind): string {
  const items = FIELDS.filter(([key]) => kind === 'completo' || key !== 'pendente')
    .filter(([key]) => r[key])
    .map(([key, label]) => `- **${label}:** ${r[key]}`)
  return items.length ? items.join('\n') : cap(r.texto, RAW_MAX[kind])
}

/** The short line of the summary card that links to the thread. */
export function reportShort(r: Report): string {
  return r.feito ?? cap(r.texto, SHORT_MAX)
}

export function reportNotes(title: string, r: Report, kind: ReportKind): MemoryNote[] {
  const notes: MemoryNote[] = []
  const add = (section: MemoryNote['section'], value?: string): void => {
    if (value) notes.push({ section, text: `“${title}”: ${value}` })
  }
  add('Recente', r.feito)
  add('Decisões', r.decidido)
  if (kind === 'completo') add('Pendências', r.pendente)
  return notes
}
