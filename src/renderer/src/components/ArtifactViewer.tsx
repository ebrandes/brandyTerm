import { Component, useEffect, useMemo, type ReactNode } from 'react'
import type { Project } from '../types'
import { closeArtifact, useArtifact, type ArtifactTarget } from '../artifacts'
import { viewerThreadFiles } from '../artifact-files'
import { BigDiagram, Frame } from './ArtifactFrame'
import { FileView, type FileTarget } from './ArtifactFile'
import './artifact.css'
import './artifact-viewer.css'

/** A project file with the files of the thread that wrote it. */
function ThreadFileView({ target, projects }: { target: FileTarget; projects: Project[] }) {
  const threads = projects.find((p) => p.id === target.projectId)?.threads
  const files = useMemo(() => viewerThreadFiles(threads ?? [], target.path, target.threadId), [threads, target.path, target.threadId])
  return <FileView target={target} files={files} />
}

/** Full-screen overlay for a quick read of an artifact; Esc or a click outside closes it. */
export function ArtifactViewer({ projects }: { projects: Project[] }) {
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
        <ThreadFileView target={target} projects={projects} />
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
