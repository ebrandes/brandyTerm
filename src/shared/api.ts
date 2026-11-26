import type { LogArea, LogSummary, LogsRead } from './logs.ts'
import type { DetectedProc } from './proc-attribution.ts'
import type { FileDiff } from './diff-summary.ts'
import type { MonthReport } from './usage-report.ts'
import type { DiscoveredHost, MachineInfo, RemoteHostInfo, TrustRole, TrustedDevice } from './remote/machine.ts'
import type { RemoteStatus } from './remote/status.ts'
import type { ConnectorDraft, ConnectorPatch, ConnectorSecrets, ImportCandidate, Preset } from './connectors.ts'
import type { AppSettings, ArchivedThreadInfo, AppState, ApprovalDecision, ArtifactContent, Attachment, FsEntry, SlashCommand } from './types.ts'

/** answer of an action the main may refuse (unknown project, empty name, threads running) */
export interface ActionResult {
  ok: boolean
  error?: string
}

/** a thread of a project, or its coordinator chat (no threadId) */
export interface NotifyTarget {
  projectId: string
  threadId?: string
}

export interface BrandyApi {
  platform: string
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  /** opens the native folder picker; returns the new/existing project id or null */
  openFolder(machineId?: string): Promise<string | null>
  /** removes the project from the app (never its folder); refused while it has threads running */
  removeProject(projectId: string): Promise<ActionResult>
  /** display name only; the folder keeps its name */
  renameProject(args: { projectId: string; name: string }): Promise<ActionResult>
  /** moves the project to (or back from) the sidebar's "Arquivados" section */
  setProjectArchived(args: { projectId: string; archived: boolean }): Promise<ActionResult>
  /** the coordinator starts a new session on the next message; memory, threads and chat stay */
  clearCoordinatorContext(args: { projectId: string }): Promise<ActionResult>
  /** opens the project folder in Finder (this machine only) */
  revealProject(args: { projectId: string }): Promise<ActionResult>
  /** saves app preferences (merged into the current ones) */
  setSettings(patch: Partial<AppSettings>): Promise<void>
  /** `answerTo`: the question a card answers; ignored if the thread no longer waits on it */
  send(args: { projectId: string; text: string; threadId?: string; attachments?: Attachment[]; answerTo?: string }): Promise<void>
  /** stores a pasted/dropped/picked file for the project; images may carry the user's marks */
  saveAttachment(args: { projectId: string; name: string; mime: string; data: Uint8Array; marked?: boolean }): Promise<Attachment>
  /** opens a stored attachment with the system's default app */
  openAttachment(path: string, projectId: string): Promise<void>
  /** a file of the project (relative path) for the artifact viewer */
  readArtifact(args: { projectId: string; path: string }): Promise<ArtifactContent>
  /** short read-only `git diff` of a project file (counts and hunks) for the viewer's Diff tab */
  diffArtifact(args: { projectId: string; path: string }): Promise<FileDiff>
  /** opens a project file in the system's default app */
  openArtifact(args: { projectId: string; path: string }): Promise<void>
  /** slash commands for the composer: app commands, plugin skills/commands, project commands */
  listCommands(projectId: string): Promise<SlashCommand[]>
  /** files/folders for an "@" mention: project paths matching `query`, or one level of a "~/" or "/" folder (max 50; [] for demo projects) */
  listFiles(args: { projectId: string; query: string }): Promise<FsEntry[]>
  cancelThread(args: { projectId: string; threadId: string }): Promise<void>
  /** answer the tool approval card of a running thread */
  approveTool(args: { projectId: string; threadId: string; id: string; decision: ApprovalDecision }): Promise<void>
  /** full report of a done thread, posted in the main chat */
  reportThread(args: { projectId: string; threadId: string }): Promise<void>
  /** mark a thread with something pending as resolved */
  resolveThread(args: { projectId: string; threadId: string }): Promise<void>
  /** sets aside an interrupted or failed thread ("descartada"): no longer pending */
  retireThread(args: { projectId: string; threadId: string }): Promise<void>
  /** the apply queue: approve once, drop (or dismiss a finished one), try a failed one again */
  approveApply(id: string): Promise<void>
  cancelApply(id: string): Promise<void>
  retryApply(id: string): Promise<void>
  setAllowAll(args: { projectId: string; threadId: string; on: boolean }): Promise<void>
  /** archived threads of these projects, newest first (read on demand, never pushed with the state) */
  listArchived(projectIds: string[]): Promise<ArchivedThreadInfo[]>
  /** brings an archived thread back into the state; false when it is not in the archive */
  reopenArchived(args: { projectId: string; threadId: string }): Promise<boolean>
  startProcess(args: { projectId: string; name: string; command: string }): Promise<void>
  stopProcess(args: { projectId: string; processId: string }): Promise<void>
  removeProcess(args: { projectId: string; processId: string }): Promise<void>
  /** read-only: what runs for the project without the "+" button (terminal, threads, already running) */
  detectedProcesses(projectId: string): Promise<DetectedProc[]>
  /** opens http://localhost:PORT in the default browser */
  openPort(port: number, projectId: string): Promise<void>
  /** owner only: hides (or shows again) a project from the machines paired to this one */
  setRemoteHidden(args: { projectId: string; hidden: boolean }): Promise<void>
  /** installs an optional plugin through Claude's marketplace */
  installPlugin(args: { id: string; force?: boolean }): Promise<void>
  openPluginReport(id: string): Promise<void>
  /** opens this machine's diagnostic logs folder (mcp, plugins, skills, remote) */
  openLogs(): Promise<void>
  /** the entries of one log area of this machine, oldest first */
  readLogs(area: LogArea): Promise<LogsRead>
  /** asks the model (or the cache) for a short summary of that log: call only while it is on screen */
  summarizeLogs(area: LogArea): Promise<LogSummary>
  cancelLogSummary(area: LogArea): Promise<void>
  /** this machine's tokens, savings and quality of a month ("YYYY-MM"; default: the current one) */
  usageReport(month?: string): Promise<MonthReport>
  /** turns one of the user's own Claude Code plugins (or 'personal' skills) on/off for threads */
  setUserPlugin(args: { id: string; on: boolean }): Promise<void>
  /** the skills panel: one item on or off in this project's list (a missing plugin gets installed) */
  toggleSkill(args: { projectId: string; id: string; on: boolean }): Promise<{ ok: boolean; erro?: string }>
  installMissingSkills(args: { projectId: string }): Promise<{ ok: boolean; erro?: string }>
  /** `dono/repo` or an https URL; empty: the default library */
  setSkillsLibrary(args: { repo: string }): Promise<{ ok: boolean; erro?: string }>
  /** Claude accounts: which subscription pays, limits, automatic switch */
  accounts: {
    activate(id: string): Promise<void>
    setAuto(on: boolean): Promise<void>
    rename(args: { id: string; label: string }): Promise<void>
    remove(id: string): Promise<void>
    probe(id: string): Promise<void>
    addToken(args: { label: string; token: string }): Promise<void>
    /** runs `claude setup-token` in the 'account-login' terminal */
    loginStart(args: { label: string; rows: number }): Promise<void>
    loginCancel(): Promise<void>
  }
  /** MCP connectors of this machine (never routed to a paired machine). Secret values go in, never come out. */
  connectors: {
    presets(): Promise<Preset[]>
    add(args: { preset?: string; draft: ConnectorDraft; secrets?: ConnectorSecrets }): Promise<{ id: string }>
    update(args: { id: string; patch: ConnectorPatch; secrets?: ConnectorSecrets }): Promise<void>
    remove(args: { id: string }): Promise<void>
    enable(args: { id: string; on: boolean }): Promise<void>
    /** connects and counts the tools */
    test(args: { id: string }): Promise<{ tools: number }>
    /** without `values`, opens the login card; with them (even `{}`), runs the login */
    login(args: { id: string; values?: Record<string, string> }): Promise<void>
    loginCancel(args: { id: string }): Promise<void>
    revokeAlways(args: { id: string; tool: string }): Promise<void>
    /** servers in ~/.claude.json: key names only, never values */
    importList(): Promise<ImportCandidate[]>
    /** main re-reads the file for the values; stdio entries need trusted */
    import(args: { names: string[]; trusted: boolean }): Promise<{ imported: string[] }>
  }
  /** native notifications of this machine */
  notify: {
    /** what the window is showing (null: something covers it), so what is in sight is not notified */
    setView(view: NotifyTarget | null): Promise<void>
    /** where the last clicked notification leads, once; null when there is none */
    takeTarget(): Promise<NotifyTarget | null>
    /** a notification was clicked: take the target */
    onOpen(cb: () => void): () => void
  }
  /** other BrandyTerm machines: the ones this machine controls (client) and the devices that control it (host) */
  remote: {
    hosts(): Promise<RemoteHostInfo[]>
    onHosts(cb: (h: RemoteHostInfo[]) => void): () => void
    onState(cb: (e: { machineId: string; state: AppState }) => void): () => void
    /** last state of each paired host (kept while offline) */
    states(): Promise<{ machineId: string; state: AppState }[]>
    call(args: { machineId: string; channel: string; arg: unknown }): Promise<unknown>
    /** writes bytes a host sent to a temp folder and opens (or, if not a passive format, only reveals) them */
    openBytes(args: { machineId: string; name: string; data: Uint8Array }): Promise<void>
    /** host side: whether the server runs, or the port it could not open */
    status(): Promise<RemoteStatus>
    openPairing(): Promise<string>
    closePairing(): Promise<void>
    /** both directions: devices that control this machine (client) and machines it controls (host) */
    devices(): Promise<TrustedDevice[]>
    /** forgets one pairing; a host also stops being dialed and its projects leave the sidebar */
    revoke(args: { pub: string; role: TrustRole }): Promise<void>
    setTerminal(args: { pub: string; on: boolean }): Promise<void>
    /** client side: hosts seen by mDNS that are not paired yet */
    discovered(): Promise<DiscoveredHost[]>
    /** mDNS browsing runs only while the pairing list is open: true when it opens, false when it closes */
    discover(on: boolean): Promise<void>
    pair(args: { address: string; code: string }): Promise<MachineInfo>
    rename(name: string): Promise<MachineInfo>
  }
  /** integrated terminal, one shell per project (id = project id), started in the project folder */
  term: {
    open(args: { id: string; cols: number; rows: number }): Promise<boolean>
    write(args: { id: string; data: string }): Promise<void>
    resize(args: { id: string; cols: number; rows: number }): Promise<void>
    readClipboard(): Promise<string>
    writeClipboard(text: string): Promise<void>
    kill(id: string): Promise<void>
    onData(cb: (e: { id: string; data: string }) => void): () => void
    onExit(cb: (e: { id: string; exitCode: number }) => void): () => void
  }
}
