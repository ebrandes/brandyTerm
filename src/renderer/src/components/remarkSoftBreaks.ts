/**
 * Remark plugin: a single newline inside a paragraph becomes a real line break,
 * as in chat apps (standard markdown would join the lines). Code is untouched
 * because code and inlineCode nodes are not "text" nodes.
 */
type MdNode = { type: string; value?: string; children?: MdNode[] }

const NEWLINE = /[ \t]*\r?\n[ \t]*/

function split(node: MdNode): MdNode[] {
  const parts = (node.value ?? '').split(NEWLINE)
  if (parts.length === 1) return [node]
  const out: MdNode[] = []
  parts.forEach((value, i) => {
    if (i > 0) out.push({ type: 'break' })
    if (value) out.push({ type: 'text', value })
  })
  return out
}

function walk(node: MdNode): void {
  if (!node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text') return split(child)
    walk(child)
    return [child]
  })
}

export default function remarkSoftBreaks() {
  return (tree: MdNode): void => walk(tree)
}
