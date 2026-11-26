import type { AskQuestion } from './ask-types.ts'

/** Where the user is in a card with several questions, and what was answered so far. */
export interface Stepper {
  at: number
  /** one per question; empty while unanswered */
  answers: string[]
  /** true when the answer was written instead of picked from the options */
  typed: boolean[]
}

export function start(count: number): Stepper {
  return { at: 0, answers: Array<string>(count).fill(''), typed: Array<boolean>(count).fill(false) }
}

function set(s: Stepper, answer: string, typed: boolean): Stepper {
  return { at: s.at, answers: s.answers.with(s.at, answer), typed: s.typed.with(s.at, typed) }
}

export const pick = (s: Stepper, option: string): Stepper => set(s, option, false)

export const write = (s: Stepper, text: string): Stepper => set(s, text, true)

const answered = (answer: string): boolean => answer.trim() !== ''

/** the next question, only once the current one has an answer */
export function next(s: Stepper): Stepper {
  const can = answered(s.answers[s.at]) && s.at < s.answers.length - 1
  return can ? { ...s, at: s.at + 1 } : s
}

export function back(s: Stepper): Stepper {
  return s.at > 0 ? { ...s, at: s.at - 1 } : s
}

export const complete = (s: Stepper): boolean => s.answers.every(answered)

/** every answer in one message, each under the question it answers */
export function composeAnswers(questions: AskQuestion[], answers: string[]): string {
  return questions.map((q, i) => `${i + 1}. ${q.text}\nResposta: ${answers[i].trim()}`).join('\n\n')
}
