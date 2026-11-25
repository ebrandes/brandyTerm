import { existsSync, readFileSync, statSync } from 'node:fs'
import type { Attachment } from '../shared/types.ts'

/** How attachments reach a model: listed in the prompt, small text files inlined, images/PDFs as Claude content blocks. */

/** text files above this size are referenced by path instead of inlined */
const MAX_INLINE = 200 * 1024

const label = (a: Attachment) =>
  `${a.name} (${a.kind === 'image' ? (a.marked ? 'imagem com marcações do usuário' : 'imagem') : a.kind === 'pdf' ? 'PDF' : 'arquivo'}) em ${a.path}`

/** Text appended to a prompt: the attachment list, with small text files inlined. */
export function attachmentText(atts: Attachment[]): string {
  if (!atts.length) return ''
  const parts = [`\n\nAnexos do usuário:\n${atts.map((a) => `- ${label(a)}`).join('\n')}`]
  if (atts.some((a) => a.marked)) {
    parts.push('As marcações (traços, caixas, setas e números) foram desenhadas pelo usuário para apontar o que importa na imagem.')
  }
  for (const a of atts) {
    if (a.kind !== 'text' || !existsSync(a.path) || statSync(a.path).size > MAX_INLINE) continue
    parts.push(`<arquivo nome="${a.name}">\n${readFileSync(a.path, 'utf8')}\n</arquivo>`)
  }
  return parts.join('\n\n')
}

/** Claude stream-json user message: text plus image/PDF blocks. */
export function claudeUserMessage(text: string, atts: Attachment[]): string {
  const content: object[] = [{ type: 'text', text }]
  for (const a of atts) {
    if (!existsSync(a.path)) continue
    const data = readFileSync(a.path).toString('base64')
    if (a.kind === 'image') content.push({ type: 'image', source: { type: 'base64', media_type: a.mime, data } })
    else if (a.kind === 'pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: a.name })
  }
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n'
}
