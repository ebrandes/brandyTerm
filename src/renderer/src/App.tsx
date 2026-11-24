import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppState } from './types'
import { Chat } from './components/Chat'
import { Overview } from './components/Overview'
import { Sidebar } from './components/Sidebar'

const MIN_PANEL = 280
const MAX_PANEL = 640

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, string | undefined>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [removing, setRemoving] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(492)
  const dragging = useRef(false)

  useEffect(() => {
    let alive = true
    void window.brandy.getState().then((s) => alive && setState(s))
    const off = window.brandy.onState((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const project = state?.projects.find((p) => p.id === activeId) ?? state?.projects[0]
  const threadId = project ? selected[project.id] : undefined
  const thread = project?.threads.find((t) => t.id === threadId)
  const draftKey = project ? `${project.id}:${thread?.id ?? 'main'}` : ''

  const send = useCallback(() => {
    if (!project) return
    const text = (drafts[draftKey] ?? '').trim()
    if (!text) return
    setDrafts((d) => ({ ...d, [draftKey]: '' }))
    void window.brandy.send({ projectId: project.id, text, threadId: thread?.id })
  }, [project, drafts, draftKey, thread?.id])

  const openFolder = async () => {
    const id = await window.brandy.openFolder()
    if (id) setActiveId(id)
  }

  if (!state) return <div className="app" />
  if (!project) {
    return (
      <div className="app empty-app">
        <div className="titlebar" />
        <div className="empty-hero">
          <h1>BrandyTerm</h1>
          <p>Abra uma pasta para começar um projeto.</p>
          <button className="primary" onClick={openFolder}>Abrir pasta</button>
        </div>
      </div>
    )
  }

  const onDividerDown = (e: React.PointerEvent) => {
    dragging.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onDividerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return
    setPanelWidth(Math.min(MAX_PANEL, Math.max(MIN_PANEL, window.innerWidth - e.clientX)))
  }

  return (
    <div className="app" style={{ ['--panel-w' as string]: `${panelWidth}px` }}>
      <div className="titlebar" />
      <Sidebar
        projects={state.projects}
        agents={state.agents}
        plugins={state.plugins}
        activeId={project.id}
        onSelect={setActiveId}
        onOpen={openFolder}
        onRemove={setRemoving}
      />
      <Chat
        project={project}
        thread={thread}
        draft={drafts[draftKey] ?? ''}
        onDraft={(t) => setDrafts((d) => ({ ...d, [draftKey]: t }))}
        onSend={send}
        onBack={() => setSelected((s) => ({ ...s, [project.id]: undefined }))}
      />
      <div
        className="divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onDividerDown}
        onPointerMove={onDividerMove}
        onPointerUp={() => (dragging.current = false)}
      />
      {removing && (
        <div className="modal-back" role="dialog" aria-modal="true" aria-label="Remover projeto">
          <div className="modal">
            <h3>Remover “{state.projects.find((p) => p.id === removing)?.name}” da lista?</h3>
            <p>As conversas e threads salvas do projeto serão apagadas. A pasta no disco não é alterada.</p>
            <div className="modal-actions">
              <button onClick={() => setRemoving(null)} autoFocus>Cancelar</button>
              <button
                className="danger"
                onClick={() => {
                  void window.brandy.removeProject(removing)
                  setRemoving(null)
                }}
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
      <Overview
        project={project}
        selectedId={thread?.id}
        onSelect={(id) => setSelected((s) => ({ ...s, [project.id]: s[project.id] === id ? undefined : id }))}
        onCancel={(id) => void window.brandy.cancelThread({ projectId: project.id, threadId: id })}
      />
    </div>
  )
}
