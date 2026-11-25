import { Component, useCallback, useEffect, useState, type ReactNode } from 'react'
import { Copy, ExternalLink, X } from 'lucide-react'
import type { ArtifactContent } from '../types'
import { artifactUrl, closeArtifact, fenced, markdownImageSrc, resolveRelative, showArtifact, useArtifact, type ArtifactTarget } from '../artifacts'
import { Rich } from './Rich'
import { CodeBlock } from './CodeBlock'
import { MermaidBlock } from './MermaidBlock'
import { api } from '../api'
import { report } from '../notice'
import './artifact.css'

/** A diagram at full size; invalid code shows as a plain block. */
function BigDiagram({ code }: { code: string }) {
  return <MermaidBlock code={code} large fallback={<CodeBlock lang="mermaid" code={code}>{code}</CodeBlock>} />
}

type FileTarget = Extract<ArtifactTarget, { path: string }>

const mb = (n: number) => (n / 1024 / 1024).toFixed(1).replace('.', ',')

/** Body of a project file, by kind. */
function FileBody({ target, content }: { target: FileTarget; content: ArtifactContent }) {
  const dir = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
  const imageSrc = useCallback((src: string) => markdownImageSrc(target.projectId, dir, src), [dir, target.projectId])
  // web links open in the browser; a relative link opens that project file here; anything else (file:, …) does nothing
  const onLink = useCallback(
    (href: string) => {
      if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return false
      const rel = resolveRelative(dir, href)
      if (rel) showArtifact({ projectId: target.projectId, path: rel })
      return true
    },
    [dir, target.projectId]
  )
  if (content.kind === 'missing') return <p className="art-note">O arquivo não existe mais.</p>
  if (content.kind === 'too-big') return <p className="art-note">Arquivo grande demais para pré-visualizar ({mb(content.size)} MB).</p>
  if (content.kind === 'md') return <Rich text={content.text} imageSrc={imageSrc} onLink={onLink} />
  if (content.kind === 'video')
    return <video className="art-media" src={artifactUrl(target.projectId, target.path)} controls autoPlay playsInline />
  if (content.kind === 'image') return <img className="art-media" src={artifactUrl(target.projectId, target.path)} alt={target.path} />
  if (content.kind === 'html' || content.kind === 'svg')
    return <iframe className="art-frame" sandbox="" src={artifactUrl(target.projectId, target.path)} title={target.path} />
  if (!('text' in content)) return null
  if (content.kind === 'mermaid') return <BigDiagram code={content.text} />
  return <Rich text={fenced(content.text, content.lang ?? '')} />
}

function FileView({ target }: { target: FileTarget }) {
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let live = true
    setContent(null)
    api
      .readArtifact(target)
      .then((c) => live && setContent(c))
      .catch(() => live && setContent({ kind: 'missing' }))
    return () => {
      live = false
    }
  }, [target])
  const name = target.path.split('/').pop() ?? target.path
  const copy = () => {
    void navigator.clipboard.writeText(target.path).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    })
  }
  return (
    <Frame
      title={name}
      sub={target.path}
      actions={
        <>
          <button onClick={copy} title="Copiar caminho">
            <Copy size={14} /> {copied ? 'Copiado' : 'Copiar caminho'}
          </button>
          <button onClick={() => void api.openArtifact(target).catch(report)} title="Abrir no app padrão">
            <ExternalLink size={14} /> Abrir no app padrão
          </button>
        </>
      }
    >
      {content ? <FileBody target={target} content={content} /> : <p className="art-note">Carregando…</p>}
    </Frame>
  )
}

function Frame({ title, sub, actions, children }: { title: string; sub?: string; actions?: ReactNode; children: ReactNode }) {
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
        <div className="art-body">{children}</div>
      </div>
    </div>
  )
}

/** Full-screen overlay for a quick read of an artifact; Esc or a click outside closes it. */
export function ArtifactViewer() {
  const target = useArtifact()
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeArtifact()
    // keys typed inside the sandboxed iframe never reach the app: keep focus here (the wheel still scrolls it)
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement?.tagName === 'IFRAME') document.querySelector<HTMLElement>('.art-close')?.focus()
      })
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('blur', onBlur)
    }
  }, [target])
  if (!target) return null
  return (
    <ViewerBoundary target={target}>
      {'path' in target ? (
        <FileView target={target} />
      ) : (
        <Frame title="Diagrama">
          <BigDiagram code={target.code} />
        </Frame>
      )}
    </ViewerBoundary>
  )
}

/** An artifact that breaks while rendering shows a note in the overlay instead of blanking the app. */
class ViewerBoundary extends Component<{ target: ArtifactTarget; children: ReactNode }, { error: boolean; target: ArtifactTarget }> {
  state = { error: false, target: this.props.target }

  static getDerivedStateFromError(): { error: boolean } {
    return { error: true }
  }

  /** another artifact opened: try rendering again */
  static getDerivedStateFromProps(props: { target: ArtifactTarget }, state: { target: ArtifactTarget }) {
    return props.target !== state.target ? { error: false, target: props.target } : null
  }

  render(): ReactNode {
    if (this.state.error)
      return (
        <Frame title="Não deu para mostrar">
          <p className="art-note">Este artefato não pôde ser exibido aqui. Abra o arquivo pelo terminal ou no seu editor.</p>
        </Frame>
      )
    return this.props.children
  }
}
