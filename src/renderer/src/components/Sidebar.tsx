import { useState } from 'react'
import { Download, FolderPlus, Loader2 } from 'lucide-react'
import type { AccountsState, AgentInfo, AppSettings, PluginInfo, Project, ProjectSkillsView, UserPluginsState } from '../types'
import { DEFAULT_LIBRARY } from '../../../shared/skills.ts'
import type { ConnectorsState } from '../../../shared/connectors.ts'
import type { MachineInfo } from '../../../shared/remote/machine.ts'
import { UserPluginsPanel } from './UserPluginsPanel'
import { ProjectSkillsPanel } from './ProjectSkillsPanel'
import { AccountsPanel } from './AccountsPanel'
import { ApplyQueuePanel } from './ApplyQueuePanel'
import type { ApplyQueueView } from '../../../shared/apply-queue.ts'
import { ProjectRow, type ProjectAsk } from './ProjectRow'
import { ArchivedProjects } from './ArchivedProjects'
import { ConnectorsSection } from '../connectors/ConnectorsSection'
import { PluginCoverage } from './PluginCoverage'
import { RemotePanel } from './RemotePanel'
import { UsageReportButton } from './UsageReport'
import { SideSection } from './SideSection'
import { MachineGroupHead } from './MachineGroupHead'
import { showGroups, type MachineGroup } from '../machine-groups'
import { readyLabel } from '../side-summary'
import logo from '../assets/logo.png'
import { api } from '../api'
import './machine.css'

interface Props {
  projects: Project[]
  /** projects by owning machine (built once in App, which also drives the chat chip) */
  groups: MachineGroup[]
  agents: AgentInfo[]
  plugins: PluginInfo[]
  accounts?: AccountsState
  userPlugins?: UserPluginsState
  /** the skills panel of the active project (a local project with a folder) */
  projectSkills?: ProjectSkillsView
  connectors?: ConnectorsState
  /** worktrees waiting to be applied */
  applyQueue?: ApplyQueueView
  /** this machine and the app settings (remote access) */
  machine?: MachineInfo
  settings?: AppSettings
  activeId: string
  /** projectId -> ISO time the project was last open */
  lastSeen?: Record<string, string>
  onSelect: (id: string) => void
  /** machineId: a folder of that paired machine; none: this machine's own dialog */
  onOpen: (machineId?: string) => void
  /** a project action that needs a confirmation (clear the coordinator's context, remove) */
  onAsk: (kind: ProjectAsk, id: string) => void
}

function PluginRow({ plugin: p, open, onToggle }: { plugin: PluginInfo; open: boolean; onToggle: () => void }) {
  const canInstall = p.optional && !p.dir
  const blocked = p.review?.blocked && !p.dir
  const status = p.installing ? 'revisando…' : p.dir ? (p.version ?? 'ativo') : blocked ? 'bloqueado' : p.optional ? 'opcional' : 'ausente'
  // installed but not acting on some agent is not the same as active
  const partial = !!p.dir && !!p.coverage?.some((c) => !c.ok)
  return (
    <div className="plugin-row">
      <button className="agent-row plugin-main" onClick={onToggle} title={p.error ?? (p.installing ? p.note : p.dir) ?? p.note}>
        <span className={`dot ${partial ? 'dot-partial' : p.dir ? 'dot-ok' : 'dot-off'}`} />
        <span>{p.name}</span>
        <span className="agent-note">{status}</span>
      </button>
      {canInstall && (open || p.installing) && (
        <button
          className="icon-btn sm"
          disabled={p.installing}
          aria-label={`Instalar ${p.name}`}
          title={`Instalar ${p.name}`}
          onClick={() => void api.installPlugin({ id: p.id })}
        >
          {p.installing ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
        </button>
      )}
      {p.error && open && <div className="plugin-error">{p.error}</div>}
      {p.coverage && open && <PluginCoverage list={p.coverage} />}
      {p.review && open && (
        <div className={blocked ? 'plugin-error' : 'plugin-review'}>
          Claude Security: {p.review.summary}
          {blocked && ' — instalação parada até você revisar.'}
          <div className="plugin-actions">
            {p.review.report && <button onClick={() => void api.openPluginReport(p.id)}>Ver relatório</button>}
            {blocked && !p.installing && (
              <button className="danger" onClick={() => void api.installPlugin({ id: p.id, force: true })}>
                Instalar mesmo assim
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function Sidebar({ projects, groups, agents, plugins, accounts, userPlugins, projectSkills, connectors, applyQueue, machine, settings, activeId, lastSeen, onSelect, onOpen, onAsk }: Props) {
  const [openPlugin, setOpenPlugin] = useState<string | null>(null)
  const grouped = showGroups(groups)
  const viewed = projects.find((p) => p.id === activeId)
  return (
    <aside className="sidebar" id="sidebar">
      <img className="brand" src={logo} alt="BrandyTerm" draggable={false} />
      <div className="side-head">
        <h2 className="side-title">Projetos</h2>
        <button className="icon-btn" onClick={() => onOpen()} aria-label="Abrir pasta" title="Abrir pasta como projeto">
          <FolderPlus size={16} />
        </button>
      </div>
      <nav className="project-list">
        {groups.map((g) => (
          <div key={g.id} className={`machine-group${g.online ? '' : ' offline'}`}>
            {grouped && <MachineGroupHead group={g} onOpen={onOpen} />}
            {g.projects.map((p) => (
              <ProjectRow key={p.id} project={p} active={p.id === activeId} lastSeen={lastSeen?.[p.id]} onSelect={onSelect} onAsk={onAsk} />
            ))}
          </div>
        ))}
        <ArchivedProjects projects={projects.filter((p) => p.archivedAt)} />
      </nav>

      <ApplyQueuePanel queue={applyQueue} projects={projects} />

      {accounts && <AccountsPanel state={accounts} />}
      <UsageReportButton />

      <hr className="side-divider" />

      <SideSection id="agents" title="Agentes" summary={readyLabel(agents.filter((a) => a.installed).length)}>
        {agents.map((a) => (
          <div key={a.id} className="agent-row" title={a.version ?? a.note}>
            <span className={`dot ${a.installed ? 'dot-ok' : 'dot-off'}`} />
            <span>{a.name}</span>
            <span className="agent-note">{a.installed ? 'pronto' : 'não instalado'}</span>
          </div>
        ))}
      </SideSection>

      {(['plugin', 'tool'] as const).map((kind) => {
        const list = plugins.filter((p) => (p.kind ?? 'plugin') === kind)
        return (
          <SideSection key={kind} id={kind === 'tool' ? 'tools' : 'plugins'} title={kind === 'tool' ? 'Ferramentas' : 'Plugins'} summary={list.length}>
            {list.map((p) => (
              <PluginRow key={p.id} plugin={p} open={openPlugin === p.id} onToggle={() => setOpenPlugin(openPlugin === p.id ? null : p.id)} />
            ))}
          </SideSection>
        )
      })}

      <ConnectorsSection state={connectors} projects={projects} active={viewed} viewing={viewed?.machine?.remote ? viewed.machine : undefined} />

      {projectSkills && viewed?.path ? (
        <ProjectSkillsPanel view={projectSkills} projectId={viewed.id} projectName={viewed.name} library={settings?.skillsLibrary ?? DEFAULT_LIBRARY} />
      ) : (
        userPlugins && <UserPluginsPanel state={userPlugins} />
      )}

      <RemotePanel machine={machine} settings={settings} />
    </aside>
  )
}
