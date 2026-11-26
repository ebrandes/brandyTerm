import { parseOptions } from './ask-options.ts'
import type { Message, Thread } from './types.ts'

const QUESTION = /^\s*PERGUNTA:\s*(.+)$/im
const OPTIONS = /^\s*OPCOES:\s*(.+)$/im

/**
 * A thread signals that it needs the user with a trailing PERGUNTA: line (and optional OPCOES:).
 * The option marked with * is the agent's recommendation: it comes first and `recommended` is set.
 */
export function extractQuestion(text: string): NonNullable<Thread['question']> | undefined {
  const q = text.match(QUESTION)
  if (!q) return undefined
  const o = text.match(OPTIONS)
  const parsed = o ? parseOptions(o[1]) : undefined
  const options = parsed?.options.length ? parsed.options : undefined
  return { text: q[1].trim(), options, ...(options && parsed?.recommended ? { recommended: true } : {}) }
}

/** The reply without the lines the question card replaces (the same ones extractQuestion reads). */
export function stripQuestion(text: string): string {
  if (!QUESTION.test(text)) return text
  return dropLine(dropLine(text, OPTIONS), QUESTION).trim()
}

/** removes the matched line with its line break, keeping the blank lines before it */
function dropLine(text: string, line: RegExp): string {
  return text.replace(new RegExp(`${line.source}\\n?`, line.flags), (found) => /^\s*/.exec(found)![0])
}

/** true while the thread still waits on exactly this question */
export function canAnswer(thread: Thread | undefined, question: string): boolean {
  return thread?.state === 'waiting' && thread.question?.text === question
}

/**
 * An answer given on a question card (`answerTo`) after the question was already resolved,
 * on this card or the other one. A message typed in the composer has no `answerTo`.
 */
export function isStaleAnswer(thread: Thread | undefined, answerTo: string | undefined): boolean {
  return answerTo !== undefined && !canAnswer(thread, answerTo)
}

/**
 * true when no later reply of the thread replaced this one: an older card must stay closed
 * even if the thread asks the same words again.
 */
export function isCurrentAsk(messages: Message[], message: Message): boolean {
  return messages.findLast((m) => m.author === 'agent' && !m.plan)?.id === message.id
}
