import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Copy, Play } from 'lucide-react'
import { runInTerminal } from '../terminals'

const SHELL = new Set(['bash', 'sh', 'zsh', 'shell', 'console', 'terminal', 'powershell', 'ps1', 'cmd'])
const PROMPT = /^\s*\$\s+/
const PROMPT_START = /^\s*\$\s/
const LANG = /language-([\w+-]+)/

/** Plain text of a highlighted code node (rehype-highlight splits it into spans). */
export function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (node && typeof node === 'object' && 'props' in node) return textOf((node.props as { children?: ReactNode }).children)
  return ''
}

/** `$ cmd` prompts are dropped so the command runs as typed. */
function commandOf(code: string): string {
  return code
    .split('\n')
    .map((l) => l.replace(PROMPT, ''))
    .join('\n')
    .trim()
}

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(code)
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1200)
      }}
      title="Copiar"
      aria-label={copied ? 'Copiado' : 'Copiar código'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copiado' : 'Copiar'}
    </button>
  )
}

export function CodeBlock({ lang, code, children, projectId }: { lang: string; code: string; children: ReactNode; projectId?: string }) {
  const runnable = !!projectId && (SHELL.has(lang) || (!lang && PROMPT_START.test(code)))
  return (
    <div className="code-block">
      <div className="code-head">
        <span>{lang || 'texto'}</span>
        <CopyButton code={code} />
        {runnable ? (
          <button type="button" className="code-run" onClick={() => runInTerminal(projectId!, commandOf(code))} title="Rodar no terminal do projeto">
            <Play size={11} /> Rodar
          </button>
        ) : null}
      </div>
      <pre>
        <code className={lang ? `hljs language-${lang}` : 'hljs'}>{children}</code>
      </pre>
    </div>
  )
}

/** Unwraps react-markdown's <pre><code> into a CodeBlock with language, raw text and highlighted children. */
export function PreBlock({ children, projectId }: { children?: ReactNode; projectId?: string }) {
  const code = Array.isArray(children) ? children[0] : children
  const props = (code as { props?: { className?: string; children?: ReactNode } })?.props ?? {}
  const lang = LANG.exec(props.className ?? '')?.[1]?.toLowerCase() ?? ''
  return (
    <CodeBlock lang={lang} code={textOf(props.children).replace(/\n$/, '')} projectId={projectId}>
      {props.children}
    </CodeBlock>
  )
}

/** Short inline code (paths, flags, names) stays on one line; long snippets may wrap. */
const SHORT_INLINE = 40

export function InlineCode({ children, className }: { children?: ReactNode; className?: string }) {
  const short = textOf(children).length <= SHORT_INLINE
  return <code className={[className, short ? 'nowrap' : ''].filter(Boolean).join(' ') || undefined}>{children}</code>
}
