import type { AskQuestion } from './ask-types.ts'

/** A thread's question shows at most this many options. */
export const MAX_ASK_OPTIONS = 6

const MAX_TEXT = 240
const LEADING = /^[*★]\s*/
const TRAILING = /\s*\((recomendad[oa])\)\s*$/i

/**
 * Parses the `OPCOES:` line of a thread question ("a | *b | c"). The agent marks the
 * option it recommends with a leading `*` (or a trailing "(recomendada)"): that option
 * moves to the top and `recommended` is true. Without a marker the original order stays.
 * Only the first marked option counts; markers on the others are dropped.
 */
export function parseOptions(raw: string): { options: string[]; recommended: boolean } {
  const items: Choice[] = []
  for (const part of raw.split('|')) {
    const t = part.trim()
    const marked = LEADING.test(t) || TRAILING.test(t)
    const label = t.replace(LEADING, '').replace(TRAILING, '').trim()
    if (label) items.push({ label, marked })
  }
  return rankOptions(items)
}

export interface Choice {
  label: string
  marked: boolean
}

/** Puts the first marked option on top and caps the list. */
export function rankOptions(items: Choice[]): { options: string[]; recommended: boolean } {
  const options = items.map((i) => i.label)
  const pick = items.findIndex((i) => i.marked)
  if (pick >= 0) options.unshift(...options.splice(pick, 1))
  return { options: options.slice(0, MAX_ASK_OPTIONS), recommended: pick >= 0 }
}

export function cap(text: string): string {
  return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT - 1) + '…' : text
}

/** A question with its texts capped; the keys of absent choices are left out or undefined. */
export function question(text: string, choices?: { options: string[]; recommended: boolean }): AskQuestion {
  const options = choices?.options.length ? choices.options.map(cap) : undefined
  return { text: cap(text.trim()), options, ...(options && choices?.recommended ? { recommended: true } : {}) }
}
