import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_FILES, type AppState } from './types'
import { Chat } from './components/Chat'
import { Overview } from './components/Overview'
import { Sidebar } from './components/Sidebar'
import { Board } from './components/Board'
import { upload } from './attach'
import { useDraftFiles } from './useDraftFiles'
import { useResizablePanel } from './useResizablePanel'
import { useLastSeen } from './useLastSeen'
import { ResizeHandle } from './components/ResizeHandle'
import logo from './assets/logo.png'
import { ArtifactViewer } from './components/ArtifactViewer'
import { api } from './api'
import { Notice } from './components/Notice'
import { useRemoteHosts } from './useRemoteHosts'
import { groupProjects, showGroups, showRemoteToggle } from './machine-groups'
import { report } from './notice'
import { RemoteFolderHost } from './components/RemoteFolderHost'
import { ProjectDialogs } from './components/ProjectDialogs'
import type { ProjectAsk } from './components/ProjectRow'

const PANEL = { storageKey: 'brandy:overview-width', defaultWidth: 420, minWidth: 280, maxRatio: 0.5 }
const SIDE = { storageKey: 'brandy:sidebar-width', defaultWidth: 272, minWidth: 232, maxWidth: 380, side: 'left' } as const

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [selected, setSelected] = useState<Record<string, string | undefined>>({})
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const files = useDraftFiles()
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string>()
  const [ask, setAsk] = useState<{ kind: ProjectAsk; id: string } | null>(null)
  const closeAsk = useCallback(() => setAsk(null), [])
  const [board, setBoard] = useState(false)
  const [terminals, setTerminals] = useState<Record<string, boolean>>({})
  const toggleTerminal = useCallback((id: string) => setTerminals((t) => ({ ...t, [id]: !t[id] })), [])
  const hosts = useRemoteHosts()
  const closeBoard = useCallback(() => setBoard(false), [])

  // Cmd/Ctrl+B opens the agents board, also when the side panel is hidden on narrow windows
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`' && activeRef.current) {
        e.preventDefault()
        toggleTerminal(activeRef.current)
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        setBoard((v) => !v)
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [])

  // a "Rodar" button in a message opens that project's terminal
  useEffect(() => {
    const open = (e: Event) => {
      const id = (e as CustomEvent<{ projectId: string }>).detail.projectId
      setTerminals((t) => ({ ...t, [id]: true }))
    }
    window.addEventListener('brandy:terminal', open)
    return () => window.removeEventListener('brandy:terminal', open)
  }, [])
  const panel = useResizablePanel(PANEL)
  const side = useResizablePanel(SIDE)
  const activeRef = useRef<string | null>(null)

  useEffect(() => {
    let alive = true
    void api.getState().then((s) => alive && setState(s))
    const off = api.onState((s) => setState(s))
    return () => {
      alive = false
      off()
    }
  }, [])

  const lastId = state?.settings?.lastProjectId
  // an archived project leaves the list, so it is not the one shown (unless every project is archived)
  const listed = state?.projects.filter((p) => !p.archivedAt) ?? []
  const project = listed.find((p) => p.id === (activeId ?? lastId)) ?? listed[0]
    ?? state?.projects.find((p) => p.id === (activeId ?? lastId)) ?? state?.projects[0]
  // reopen on the project used last
  useEffect(() => {
    if (project && project.id !== lastId) void api.setSettings({ lastProjectId: project.id })
  }, [project?.id, lastId])
  useLastSeen(project?.id)
  activeRef.current = project && !project.demo ? project.id : null
  const threadId = project ? selected[project.id] : undefined
  const thread = project?.threads.find((t) => t.id === threadId)
  const draftKey = project ? `${project.id}:${thread?.id ?? 'main'}` : ''

  const pending = files.get(draftKey)
  const send = useCallback(async () => {
    if (!project) return
    const text = (drafts[draftKey] ?? '').trim()
    if (!text && !pending.length) return
    if (pending.length > MAX_FILES) return setSendError(`Envie no máximo ${MAX_FILES} arquivos por mensagem.`)
    setSending(true)
    setSendError(undefined)
    try {
      const attachments = pending.length ? await upload(project.id, pending) : undefined
      // only what was sent leaves the composer: text typed or files added during the upload stay
      setDrafts((d) => ((d[draftKey] ?? '').trim() === text ? { ...d, [draftKey]: '' } : d))
      for (const f of pending) files.remove(draftKey, f.key)
      await api.send({ projectId: project.id, text, threadId: thread?.id, attachments })
    } catch (e) {
      setSendError(String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    } finally {
      setSending(false)
    }
  }, [project, drafts, draftKey, thread?.id, pending, files])

  /** machineId: a folder of that paired machine (picker); none: this machine's own dialog */
  const openFolder = async (machineId?: string) => {
    const id = await api.openFolder(machineId)
    if (id) setActiveId(id)
  }

  const askProject = ask ? state?.projects.find((p) => p.id === ask.id) : undefined
  const connectorNames = useMemo(
    () => Object.fromEntries((state?.connectors?.list ?? []).map((c) => [c.id, c.name])),
    [state?.connectors?.list]
  )
  const groups = state ? groupProjects(listed.length ? state.projects.filter((p) => !p.archivedAt) : [], hosts, state.machine) : []
  if (!state) return <div className="app" />
  if (!project) {
    return (
      <div className="app empty-app">
        <div className="titlebar" />
        <div className="empty-hero">
          <img className="hero-logo" src={logo} alt="BrandyTerm" draggable={false} />
          <p>Abra uma pasta para começar um projeto.</p>
          <button className="primary" onClick={() => void openFolder()}>Abrir pasta</button>
        </div>
      </div>
    )
  }

  return (
    <div className="app" style={{ ['--panel-w' as string]: `${panel.width}px`, ['--side-w' as string]: `${side.width}px` }}>
      <div className="titlebar" />
      <Sidebar
        projects={state.projects}
        groups={groups}
        agents={state.agents}
        plugins={state.plugins}
        accounts={state.accounts}
        userPlugins={state.userPlugins}
        connectors={state.connectors}
        machine={state.machine}
        settings={state.settings}
        activeId={project.id}
        lastSeen={state.settings?.lastSeen}
        onSelect={setActiveId}
        onOpen={(machineId) => void openFolder(machineId)}
        onAsk={(kind, id) => setAsk({ kind, id })}
      />
      <ResizeHandle handle={side.handleProps} dragging={side.dragging} label="Redimensionar o menu lateral" controls="sidebar" />
      <Chat
        project={project}
        thread={thread}
        draft={drafts[draftKey] ?? ''}
        onDraft={(t) => setDrafts((d) => ({ ...d, [draftKey]: t }))}
        files={pending}
        onAddFiles={(f) => void files.add(draftKey, f)}
        onRemoveFile={(k) => files.remove(draftKey, k)}
        onMarked={(k, blob, marks, original) => files.mark(draftKey, k, blob, marks, original)}
        sending={sending}
        sendError={sendError}
        onSend={() => void send()}
        onBack={() => setSelected((s) => ({ ...s, [project.id]: undefined }))}
        terminalOpen={!!terminals[project.id]}
        onToggleTerminal={() => toggleTerminal(project.id)}
        onOpenThread={(id) => setSelected((s) => ({ ...s, [project.id]: id }))}
        showMachine={showGroups(groups)}
        connectorNames={connectorNames}
      />
      <ResizeHandle handle={panel.handleProps} dragging={panel.dragging} label="Redimensionar a visão do projeto" controls="overview" />
      <ProjectDialogs ask={ask && askProject ? { kind: ask.kind, project: askProject } : null} onClose={closeAsk} />
      <Overview
        project={project}
        allowAllThreads={!!state.settings?.allowAllThreads}
        keepAwake={state.settings?.keepAwake !== false}
        idleCompact={state.settings?.idleCompact?.enabled !== false}
        showRemote={showRemoteToggle(state.settings?.remote?.enabled === true, groups)}
        selectedId={thread?.id}
        onSelect={(id) => setSelected((s) => ({ ...s, [project.id]: s[project.id] === id ? undefined : id }))}
        onCancel={(id) => void api.cancelThread({ projectId: project.id, threadId: id })}
        onBoard={() => setBoard(true)}
      />
      {board && (
        <Board
          projects={state.projects}
          currentId={project.id}
          onClose={closeBoard}
          onOpenThread={(projectId, threadId) => {
            setBoard(false)
            setActiveId(projectId)
            setSelected((s) => ({ ...s, [projectId]: threadId }))
          }}
        />
      )}
      <ArtifactViewer projects={state.projects} />
      <RemoteFolderHost />
      <Notice />
    </div>
  )
}
