import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { closeArtifact } from '../artifacts'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'

/** A diagram at full size; invalid code shows as a plain block. */
export function BigDiagram({ code }: { code: string }) {
  return <MermaidBlock code={code} large fallback={<CodeBlock lang="mermaid" code={code}>{code}</CodeBlock>} />
}

/** The overlay's dialog: title, actions and close button over a scrolling body. */
export function Frame({ title, sub, actions, bodyClass, children }: { title: string; sub?: string; actions?: ReactNode; bodyClass?: string; children: ReactNode }) {
  return (
    <div className="art-back" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.target === e.currentTarget && closeArtifact()}>
      <div className="art-panel">
        <header className="art-head">
          <div className="art-title">
            <strong>{title}</strong>
            {sub && <span>{sub}</span>}
          </div>
          <div className="art-actions">
            {actions}
            <button className="art-close" onClick={closeArtifact} title="Fechar (Esc)" aria-label="Fechar" autoFocus>
              <X size={16} />
            </button>
          </div>
        </header>
        <div className={bodyClass ? `art-body ${bodyClass}` : 'art-body'}>{children}</div>
      </div>
    </div>
  )
}
