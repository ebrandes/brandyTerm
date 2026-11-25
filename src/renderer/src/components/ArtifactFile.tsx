import { useCallback, useEffect, useMemo, useState } from 'react'
import { Code, Copy, ExternalLink, FileDiff } from 'lucide-react'
import type { ArtifactContent, ThreadFile } from '../types'
import { artifactUrl, fenced, markdownImageSrc, resolveRelative, showArtifact, type ArtifactTarget } from '../artifacts'
import { Rich } from './Rich'
import { api } from '../api'
import { report } from '../notice'
import { hostView } from '../remote/host-file'
import { HostFile } from './HostFile'
import { useFileDiffs, diffStat } from '../useFileDiffs'
import { BigDiagram, Frame } from './ArtifactFrame'
import { ArtifactFileList } from './ArtifactFileList'
import { DiffStat, DiffView } from './ArtifactDiff'

export type FileTarget = Extract<ArtifactTarget, { path: string }>

const mb = (n: number) => (n / 1024 / 1024).toFixed(1).replace('.', ',')
const LIST_KEY = 'brandyterm.artifact.files.open'

/** Body of a project file, by kind. */
function FileBody({ target, content }: { target: FileTarget; content: ArtifactContent }) {
  const dir = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
  const imageSrc = useCallback((src: string) => markdownImageSrc(target.projectId, dir, src), [dir, target.projectId])
  // web links open in the browser; a relative link opens that project file here; anything else (file:, …) does nothing
  const onLink = useCallback(
    (href: string) => {
      if (/^(https?:|mailto:)/i.test(href) || href.startsWith('#')) return false
      const rel = resolveRelative(dir, href)
      if (rel) showArtifact({ projectId: target.projectId, path: rel, threadId: target.threadId })
      return true
    },
    [dir, target.projectId, target.threadId]
  )
  if (content.kind === 'missing') return <p className="art-note">O arquivo não existe mais.</p>
  if (content.kind === 'too-big') return <p className="art-note">Arquivo grande demais para pré-visualizar ({mb(content.size)} MB).</p>
  if (content.kind === 'md') return <Rich text={content.text} imageSrc={imageSrc} onLink={onLink} />
  // a paired machine's media comes over the channel; its pages are never rendered here
  if (hostView(target.projectId, content.kind)) return <HostFile target={target} kind={content.kind} />
  if (content.kind === 'video')
    return <video className="art-media" src={artifactUrl(target.projectId, target.path)} controls autoPlay playsInline />
  if (content.kind === 'image') return <img className="art-media" src={artifactUrl(target.projectId, target.path)} alt={target.path} />
  if (content.kind === 'html' || content.kind === 'svg')
    return <iframe className="art-frame" sandbox="" src={artifactUrl(target.projectId, target.path)} title={target.path} />
  if (!('text' in content)) return null
  if (content.kind === 'mermaid') return <BigDiagram code={content.text} />
  return <Rich text={fenced(content.text, content.lang ?? '')} />
}

function useListOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => localStorage.getItem(LIST_KEY) !== '0')
  const toggle = () =>
    setOpen((o) => {
      localStorage.setItem(LIST_KEY, o ? '0' : '1')
      return !o
    })
  return [open, toggle]
}

/** A project file in the viewer: its thread's files on the side, Código and Diff tabs on top. */
export function FileView({ target, files }: { target: FileTarget; files: ThreadFile[] }) {
  const [content, setContent] = useState<ArtifactContent | null>(null)
  const [copied, setCopied] = useState(false)
  const [tab, setTab] = useState<'code' | 'diff'>('code')
  const [listOpen, toggleList] = useListOpen()
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
  const paths = useMemo(() => {
    const list = files.map((f) => f.path)
    return list.includes(target.path) ? list : [target.path, ...list]
  }, [files, target.path])
  const diffs = useFileDiffs(target.projectId, paths)
  const stat = diffStat(diffs[target.path])
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
      bodyClass="art-split"
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
      {files.length > 0 && (
        <ArtifactFileList
          files={files}
          current={target.path}
          diffs={diffs}
          open={listOpen}
          onToggle={toggleList}
          onPick={(path) => showArtifact({ projectId: target.projectId, path, threadId: target.threadId })}
        />
      )}
      <div className="art-main">
        <div className="art-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'on' : ''} onClick={() => setTab('code')}>
            <Code size={13} /> Código
          </button>
          <button role="tab" aria-selected={tab === 'diff'} className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')}>
            <FileDiff size={13} /> Diff {stat && <DiffStat {...stat} />}
          </button>
        </div>
        <div className="art-content">
          {tab === 'diff' ? (
            <DiffView diff={diffs[target.path]} />
          ) : content ? (
            <FileBody target={target} content={content} />
          ) : (
            <p className="art-note">Carregando…</p>
          )}
        </div>
      </div>
    </Frame>
  )
}
