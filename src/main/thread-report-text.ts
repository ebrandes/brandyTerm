import type { MemoryNote } from './memory.ts'

export type ReportKind = 'curto' | 'completo'

export interface Report {
  feito?: string
  decidido?: string
  arquivos?: string
  pendente?: string
  texto: string
}

const EMPTY_RE = /^(nada|nenhum|nenhuma|-)[.!;,]*$/i
const NO_CHANGES = 'Não altere arquivos nem rode comandos.'
const LABEL_RE = /^\s*(?:[-*]\s+)?\**\s*(FEITO|DECIDIDO|ARQUIVOS|PENDENTE)\**\s*:\**/i

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
      current = m[1].toLowerCase()
      values[current] = line.slice(m[0].length)
    } else if (current) {
      values[current] += ' ' + line
    }
  }
  return {
    feito: clean(values.feito ?? ''),
    decidido: clean(values.decidido ?? ''),
    arquivos: clean(values.arquivos ?? ''),
    pendente: clean(values.pendente ?? ''),
    texto: trimmed.slice(0, 600)
  }
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
