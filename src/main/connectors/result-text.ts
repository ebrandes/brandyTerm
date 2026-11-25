// What a connector's answer looks like to the agent: plain text, media as placeholders, capped without cutting JSON.
import { MAX_RESULT } from './gateway-protocol.ts'

export const RESULT_CAP = MAX_RESULT

const named = (v: unknown): string => (typeof v === 'string' && v ? v : '?')
const bytes = (data: unknown): number => (typeof data === 'string' ? Buffer.byteLength(data, 'base64') : 0)

/** One content part as the agent sees it: text as is; binary data never goes through. */
function partText(part: unknown): string {
  const p = (part ?? {}) as { type?: unknown; text?: unknown; mimeType?: unknown; data?: unknown; uri?: unknown; resource?: { uri?: unknown } }
  if (p.type === 'text' && typeof p.text === 'string') return p.text
  if (p.type === 'image') return `[imagem ${named(p.mimeType)}, ${bytes(p.data)} bytes]`
  if (p.type === 'audio') return `[áudio ${named(p.mimeType)}, ${bytes(p.data)} bytes]`
  if (p.type === 'resource') return `[recurso ${named(p.resource?.uri)}]`
  if (p.type === 'resource_link') return `[recurso ${named(p.uri)}]`
  return `[conteúdo ${named(p.type)}]`
}

/** A tool result's content as one text, cut at RESULT_CAP with a note. */
export function resultText(content: unknown[]): string {
  const text = content.map(partText).join('\n')
  return text.length <= RESULT_CAP ? text : `${text.slice(0, RESULT_CAP)}\n(resultado cortado em ${RESULT_CAP} caracteres)`
}

/** The tool list as compact JSON, measured once; over the cap, whole tools are left out from the end. */
export function toolsText(tools: unknown[]): string {
  const parts = tools.map(t => JSON.stringify(t))
  let len = 2 // the brackets
  let kept = 0
  for (const p of parts) {
    const next = len + p.length + (kept ? 1 : 0)
    if (next > RESULT_CAP) break
    len = next
    kept++
  }
  const json = `[${parts.slice(0, kept).join(',')}]`
  return kept === parts.length ? json : `${json}\n(lista cortada: ${kept} de ${parts.length} ferramentas)`
}
