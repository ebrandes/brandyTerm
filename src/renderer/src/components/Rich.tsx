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
type RichProps = {
  text: string
  projectId?: string
  /** rewrites image sources (artifact viewer: project files via brandy-art) */
  imageSrc?: (src: string) => string | undefined
  /** handles a link click instead of the default; return true when handled */
  onLink?: (href: string) => boolean
}

export const Rich = memo(function Rich({ text, projectId, imageSrc, onLink }: RichProps) {
  const components = useMemo<Components>(
    () => ({
      ...STATIC,
      pre: ({ children }) => <PreBlock projectId={projectId}>{children}</PreBlock>,
      ...(imageSrc ? { img: ({ src, alt }) => <img src={imageSrc(String(src ?? ''))} alt={alt ?? ''} loading="lazy" /> } : {}),
      ...(onLink
        ? {
            a: ({ href, children }) => (
              <a href={href} target="_blank" rel="noreferrer" title={href} onClick={(e) => onLink(String(href ?? '')) && e.preventDefault()}>
                {children}
              </a>
            )
          }
        : {})
    }),
    [projectId, imageSrc, onLink]
  )
  return (
    <div className="rich">
      <Markdown remarkPlugins={REMARK} rehypePlugins={REHYPE} components={components}>
        {text}
      </Markdown>
    </div>
  )
})
