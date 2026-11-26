// Finds the decisions a reply leaves with the user. Plain text rules only: no model call.
import { cap, parseOptions, question } from './ask-options.ts'
import type { AskQuestion } from './ask-types.ts'
import { freeTextQuestions } from './ask-free-text.ts'

const QUESTION_LINE = /^\s*PERGUNTA:\s*(.+)$/i
const OPTIONS_LINE = /^\s*OPCOES:\s*(.+)$/i
const MAX_QUESTIONS = 8
const FENCE = /^\s*(```|~~~)/
const SUMMARY_LINE = /^\s*RESUMO:/im
/** the line ends asking, ignoring markdown and quotes after the mark */
const ASKS = /\?[\s*_`"'”’)\]]*$/

/** the lines of the reply, with the ones inside code blocks emptied */
function proseLines(text: string): string[] {
  let fenced = false
  return text.split('\n').map((line) => {
    if (FENCE.test(line)) {
      fenced = !fenced
      return ''
    }
    return fenced ? '' : line
  })
}

/** one question per PERGUNTA: line, each with the OPCOES: that comes before the next one */
function structured(lines: string[]): AskQuestion[] {
  const found: { text: string; options?: string }[] = []
  let early: string | undefined
  for (const line of lines) {
    const q = QUESTION_LINE.exec(line)
    const o = OPTIONS_LINE.exec(line)
    if (q) found.push({ text: q[1] })
    else if (o && found.length) found[found.length - 1].options ??= o[1]
    else if (o) early ??= o[1]
  }
  if (found.length === 1) found[0].options ??= early
  return found.map((f) => question(f.text, f.options ? parseOptions(f.options) : undefined))
}

function closingQuestion(text: string, lines: string[]): AskQuestion[] {
  if (SUMMARY_LINE.test(text)) return []
  const last = text.trimEnd().split('\n').pop() ?? ''
  // a closing code block leaves an empty prose line, which asks nothing
  if (!ASKS.test(last) || !lines.join('\n').trimEnd().endsWith(last)) return []
  const clean = last.replace(/^\s*(?:[-*>#]+\s+|\d+[.)]\s+)?/, '').replace(/\*\*|__|`/g, '').trim()
  return [{ text: cap(clean) }]
}

/** The decisions the reply asks for: PERGUNTA: lines, else a numbered list, else a closing question. */
export function extractQuestions(text: string): AskQuestion[] {
  const lines = proseLines(text)
  let found = structured(lines)
  if (!found.length) found = structured(text.split('\n'))
  if (!found.length) found = freeTextQuestions(lines)
  if (!found.length) found = closingQuestion(text, lines)
  return found.slice(0, MAX_QUESTIONS)
}

const ACT = '(?:escolher|decidir|definir|confirmar|aprovar|responder|validar)'
const DECISION = '(?:decis[ãa]o|resposta|escolha|confirma[çc][ãa]o|aprova[çc][ãa]o)'
const PENDING = [
  `(?:o )?usu[áa]rio (?:ainda )?(?:vai|precisa|deve|tem (?:que|de)|ter[áa] (?:que|de)) (?:ainda )?${ACT}`,
  `falta(?:m)? (?:o usu[áa]rio|voc[êe]) ${ACT}`,
  `aguard(?:a|ando) (?:o usu[áa]rio |voc[êe] )${ACT}`,
  `aguard(?:a|ando) (?:a |uma )?(?:sua ${DECISION}|decis[ãa]o|${DECISION} do usu[áa]rio)`,
  `(?:a )?${DECISION} do usu[áa]rio (?:ainda )?(?:est[áa] |ficou |segue )?(?:pendente|em aberto)`,
  `pendente:? (?:a )?${DECISION} do usu[áa]rio`
].map((source) => new RegExp(source, 'i'))

/** The part of a summary that says a decision of the user is still open. */
export function pendingDecision(text: string): string | undefined {
  for (const pattern of PENDING) {
    const m = pattern.exec(text)
    if (m) return cap(text.slice(m.index).split(/[.;\n]/)[0].trim())
  }
  return undefined
}
