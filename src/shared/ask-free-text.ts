// Numbered questions written as free text, with optional (a)/(b) choices.
import { question, rankOptions, type Choice } from './ask-options.ts'
import type { AskQuestion } from './ask-types.ts'

const TAIL_LINES = 60
/** text lines allowed after the list; more than this and the list was not the closing ask */
const MAX_AFTER = 3
/** explanation allowed after the question mark of an item before it reads as an answered question */
const MAX_ANSWER = 100
const ITEM = /^(\s*)(?:\*\*)?\d{1,2}[.)](?:\*\*)?\s+(.+)$/
const OPTION = /^\s*(?:[-*+]\s+)?(?:\*\*)?\(?[a-f]\)(?:\*\*)?\s+(.+)$/i
const INLINE = /\([a-f]\)\s+/i
const RECOMMENDED = /\s*\(recomendad[oa]\)/i
const CUE = /\?|decid|decis|escolh|prefer|confirm|defin/i

interface Item {
  head: string[]
  options: string[]
}

interface List {
  items: Item[]
  intro: string
  after: number
}

const plain = (text: string): string => text.replace(/\*\*|__|`/g, '').replace(/\s+/g, ' ').trim()

function choice(raw: string): Choice {
  const text = plain(raw)
  const label = text.replace(RECOMMENDED, '').replace(/(?:[\s.;,?]|\sou)+$/i, '')
  return { label, marked: RECOMMENDED.test(text) }
}

/** the last numbered list of the lines */
function lastList(lines: string[]): List {
  const list: List = { items: [], intro: '', after: 0 }
  let indent = 0
  let open = false
  let blank = false
  let lead = ''
  for (const line of lines) {
    if (!line.trim()) {
      blank = true
      continue
    }
    const item = ITEM.exec(line)
    const option = OPTION.exec(line)
    const nested = /^\s/.test(line)
    if (item && (!open || item[1].length <= indent)) {
      // a list that restarts after other text replaces the earlier one
      if (!open) Object.assign(list, { items: [], intro: lead, after: 0 })
      indent = item[1].length
      list.items.push({ head: [item[2]], options: [] })
      open = true
    } else if (open && option) list.items[list.items.length - 1].options.push(option[1])
    else if (open && (nested || !blank)) list.items[list.items.length - 1].head.push(line)
    else {
      open = false
      lead = line
      if (!/^\s*(?:RESUMO|OPCOES):/i.test(line)) list.after++
    }
    blank = false
  }
  return list
}

/** the item as a question, and whether its own words ask something */
function read(item: Item): { asks: boolean; value: AskQuestion } {
  let head = plain(item.head.join(' '))
  let options = item.options
  const parts = head.split(INLINE)
  if (!options.length && parts.length > 2) {
    head = parts[0]
    options = parts.slice(1)
  }
  const choices = options.length > 1 ? rankOptions(options.map(choice)) : undefined
  return { asks: asksIn(plain(item.head.join(' '))), value: question(head.replace(/[\s:–—-]+$/, ''), choices) }
}

/** it has a question mark with little text after it (inline choices included) */
function asksIn(text: string): boolean {
  const mark = text.lastIndexOf('?')
  return mark >= 0 && text.length - mark - 1 <= MAX_ANSWER
}

export function freeTextQuestions(lines: string[]): AskQuestion[] {
  const list = lastList(lines.slice(-TAIL_LINES))
  if (list.after > MAX_AFTER) return []
  const all = list.items.map(read)
  const asking = all.filter((i) => i.asks).length
  const withChoices = all.some((i) => i.value.options)
  const cued = asking > 0 || CUE.test(list.intro)
  if (asking < 2 && !(withChoices && cued)) return []
  // items that neither ask nor offer a choice are not decisions
  return all.filter((i) => i.asks || i.value.options).map((i) => i.value)
}
