/** A thread's question shows at most this many options. */
export const MAX_ASK_OPTIONS = 6

const LEADING = /^[*★]\s*/
const TRAILING = /\s*\((recomendad[oa])\)\s*$/i

/**
 * Parses the `OPCOES:` line of a thread question ("a | *b | c"). The agent marks the
 * option it recommends with a leading `*` (or a trailing "(recomendada)"): that option
 * moves to the top and `recommended` is true. Without a marker the original order stays.
 * Only the first marked option counts; markers on the others are dropped.
 */
export function parseOptions(raw: string): { options: string[]; recommended: boolean } {
  let pick = -1
  const options: string[] = []
  for (const part of raw.split('|')) {
    const t = part.trim()
    const marked = LEADING.test(t) || TRAILING.test(t)
    const clean = t.replace(LEADING, '').replace(TRAILING, '').trim()
    if (!clean) continue
    if (marked && pick < 0) pick = options.length
    options.push(clean)
  }
  if (pick < 0) return { options: options.slice(0, MAX_ASK_OPTIONS), recommended: false }
  const [top] = options.splice(pick, 1)
  return { options: [top, ...options].slice(0, MAX_ASK_OPTIONS), recommended: true }
}
