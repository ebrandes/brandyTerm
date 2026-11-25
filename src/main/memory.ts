import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Project memory: one short markdown file per project, `.brandyterm/memoria.md` in the
 * project folder. The coordinator reads it on every message (it has no file tools) and
 * adds notes when a request ends; threads read it before starting. It never grows past
 * a budget: over MEMORY_LIMIT a one-off call rewrites it compactly. Because the file
 * holds what matters, the coordinator's own session can be restarted from time to time
 * instead of growing forever.
 */

export const MEMORY_LIMIT = 8000
/** consolidation aims below the limit so it does not run again right away */
export const MEMORY_TARGET = 5500
export const SECTIONS = ['Projeto', 'Decisões', 'Mapa', 'Pendências', 'Recente'] as const
export type Section = (typeof SECTIONS)[number]

export const MEMORY_REL = '.brandyterm/memoria.md'

export interface MemoryNote {
  section: Section
  text: string
}

export const MEMORY_SCHEMA = {
  type: 'array',
  maxItems: 6,
  items: {
    type: 'object',
    properties: { section: { type: 'string', enum: [...SECTIONS] }, text: { type: 'string' } },
    required: ['section', 'text']
  }
}

const HINTS: Record<Section, string> = {
  Projeto: 'o que é, stack, como rodar e testar',
  Decisões: 'o que foi decidido e por quê',
  Mapa: 'onde ficam as partes importantes do código',
  Pendências: 'o que ficou em aberto',
  Recente: 'últimos pedidos, uma linha cada'
}

const file = (root: string) => join(root, MEMORY_REL)

export function readMemory(root: string): string {
  try {
    return readFileSync(file(root), 'utf8')
  } catch {
    return ''
  }
}

export function writeMemory(root: string, text: string): void {
  const dir = join(root, '.brandyterm')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(file(root), text.trim() + '\n')
}

function skeleton(): string {
  return ['# Memória do projeto', '', ...SECTIONS.flatMap((s) => [`## ${s}`, `<!-- ${HINTS[s]} -->`, ''])].join('\n')
}

/** Appends each note as a bullet under its section (creating the file or section if needed). */
export function addNotes(root: string, notes: MemoryNote[]): number {
  const clean = notes
    .filter((n) => SECTIONS.includes(n.section) && n.text.trim())
    .map((n) => ({ section: n.section, text: n.text.replace(/\s+/g, ' ').trim().slice(0, 400) }))
  let text = readMemory(root) || skeleton()
  if (!clean.length) return text.length
  for (const n of clean) {
    const head = `## ${n.section}`
    if (!text.includes(head)) text = `${text.trimEnd()}\n\n${head}\n`
    const at = text.indexOf(head) + head.length
    const next = text.indexOf('\n## ', at)
    const end = next < 0 ? text.length : next
    const body = text.slice(at, end).trimEnd()
    // the same note twice adds nothing
    if (body.includes(n.text)) continue
    text = `${text.slice(0, at)}${body}\n- ${n.text}\n${next < 0 ? '' : '\n'}${text.slice(end).replace(/^\n+/, '')}`
  }
  writeMemory(root, text)
  return text.length
}

/** Parses the model's `memory` field, tolerating junk. */
export function parseNotes(raw: unknown): MemoryNote[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((n) =>
    n && typeof n.text === 'string' && SECTIONS.includes(n.section) ? [{ section: n.section as Section, text: n.text }] : []
  )
}

export function memoryBlock(root: string): string {
  const m = readMemory(root).trim()
  return m ? `Memória do projeto (${MEMORY_REL}, mantida por você):\n${m}` : `Memória do projeto: (vazia; ${MEMORY_REL} ainda não existe)`
}

export const MEMORY_RULES = `- "memory" (opcional): até 6 notas curtas para a memória do projeto, cada uma {section, text} com section em ${SECTIONS.join(' | ')}. Anote só o que vale para conversas futuras: fatos estáveis do projeto, decisões do usuário e o motivo, onde ficam as coisas, o que ficou pendente, e em Recente uma linha do que foi pedido e o resultado. Nada que já esteja na memória; nada temporário. Sem nada novo: memory=[].`

export function consolidatePrompt(text: string): string {
  return `Reescreva a memória de projeto abaixo para caber em ${MEMORY_TARGET} caracteres, mantendo o formato markdown e as seções ${SECTIONS.map((s) => `"## ${s}"`).join(', ')}.
Junte itens repetidos, corte o que já foi resolvido ou ficou obsoleto, resuma o histórico antigo de "Recente" (mantenha só os 8 mais novos) e preserve decisões e fatos estáveis, com o motivo. Responda SOMENTE com JSON {"memory": "<markdown completo>"}.

${text}`
}

export const CONSOLIDATE_SCHEMA = { type: 'object', properties: { memory: { type: 'string' } }, required: ['memory'] }
