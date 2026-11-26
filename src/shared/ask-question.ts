import { extractQuestions } from './ask-detect.ts'
import type { Message, Thread } from './types.ts'

const QUESTION = /^\s*PERGUNTA:\s*(.+)$/im
const OPTIONS = /^\s*OPCOES:\s*(.+)$/im

/**
 * A thread signals that it needs the user with a PERGUNTA: line per decision (each with an optional
 * OPCOES:; the option marked with * is the recommendation and comes first). Questions written as
 * free text are caught too. The first is the key of the card; the others go in `more`.
 */
export function extractQuestion(text: string): NonNullable<Thread['question']> | undefined {
  const [first, ...rest] = extractQuestions(text)
  return first && (rest.length ? { ...first, more: rest } : first)
}

/** The reply without the lines the question card replaces. Questions in free text stay. */
export function stripQuestion(text: string): string {
  if (!QUESTION.test(text)) return text
  return dropLines(dropLines(text, OPTIONS), QUESTION).trim()
}

/** removes the matched lines with their line breaks, keeping the blank lines before them */
function dropLines(text: string, line: RegExp): string {
  return text.replace(new RegExp(`${line.source}\\n?`, `${line.flags}g`), (found) => /^\s*/.exec(found)![0])
}

/**
 * The question of a reply's card inside its thread. A decision found only in the summary is not in
 * the reply's text: the latest reply of a waiting thread then shows the thread's own question.
 */
export function cardQuestion(thread: Thread, message: Message): Thread['question'] {
  const found = extractQuestion(message.text)
  if (found || thread.state !== 'waiting' || !isCurrentAsk(thread.messages, message)) return found
  return thread.question
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
