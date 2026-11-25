import { useEffect, useState, type ReactNode } from 'react'
import { showArtifact } from '../artifacts'

type Mermaid = (typeof import('mermaid'))['default']

/** mermaid is heavy: loaded on the first diagram, initialized once */
let loader: Promise<Mermaid> | null = null
let seq = 0

function loadMermaid(): Promise<Mermaid> {
  loader ??= import('mermaid').then(({ default: m }) => {
    // strict: no click handlers or HTML labels; the SVG is sanitized before it is returned
    m.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'dark', fontFamily: 'inherit' })
    return m
  })
  return loader
}

/** A Mermaid diagram from an answer or a file; falls back to `fallback` when the code does not parse. */
export function MermaidBlock({ code, large, fallback }: { code: string; large?: boolean; fallback: ReactNode }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    void loadMermaid()
      .then((m) => m.render(`mmd-${++seq}`, code))
      .then((r) => live && setSvg(r.svg))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [code])
  if (failed) return <>{fallback}</>
  if (!svg) return <div className="mermaid-block loading">Desenhando diagrama…</div>
  return (
    <div
      className={`mermaid-block${large ? ' large' : ' clickable'}`}
      onClick={large ? undefined : () => showArtifact({ inline: 'mermaid', code })}
      title={large ? undefined : 'Ampliar diagrama'}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  )
}
