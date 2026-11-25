import { memo, useMemo } from 'react'
import Markdown, { type Components, type Options } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { InlineCode, PreBlock } from './CodeBlock'
import remarkSoftBreaks from './remarkSoftBreaks'
import './markdown.css'

// Hoisted so every render reuses the same plugin lists. Raw HTML is never rendered
// (no rehype-raw): react-markdown escapes it, which keeps agent output safe.
const REMARK: Options['remarkPlugins'] = [remarkGfm, remarkSoftBreaks]
const REHYPE: Options['rehypePlugins'] = [[rehypeHighlight, { detect: false, ignoreMissing: true }]]

const STATIC: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer" title={href}>
      {children}
    </a>
  ),
  code: ({ className, children }) => <InlineCode className={className}>{children}</InlineCode>,
  table: ({ children }) => (
    <div className="table-wrap">
      <table>{children}</table>
    </div>
  )
}

/** Markdown for agent output: GFM (tables, task lists, links), soft line breaks, highlighted code, runnable shell blocks. */
export const Rich = memo(function Rich({ text, projectId }: { text: string; projectId?: string }) {
  const components = useMemo<Components>(() => ({ ...STATIC, pre: ({ children }) => <PreBlock projectId={projectId}>{children}</PreBlock> }), [projectId])
  return (
    <div className="rich">
      <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {text}
      </Markdown>
    </div>
  )
})
