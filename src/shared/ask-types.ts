/** One decision a thread needs from the user. */
export interface AskQuestion {
  text: string
  options?: string[]
  /** options[0] is the option the agent recommends */
  recommended?: boolean
}

/** A question card in a chat: it routes the answer back to the thread. */
export interface AskRef {
  threadId: string
  /** the first question: the key that tells whether the card can still be answered */
  question: string
  options?: string[]
  recommended?: boolean
  /** the other questions of the same turn, answered together with the first */
  more?: AskQuestion[]
}
