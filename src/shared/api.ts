import type { FileDiff } from './diff-summary.ts'
import type { DiscoveredHost, MachineInfo, RemoteHostInfo, TrustRole, TrustedDevice } from './remote/machine.ts'
import type { RemoteStatus } from './remote/status.ts'
import type { AppSettings, ArchivedThreadInfo, AppState, ApprovalDecision, ArtifactContent, Attachment, FsEntry, SlashCommand } from './types.ts'

/** answer of an action the main may refuse (unknown project, empty name, threads running) */
export interface ActionResult {
  ok: boolean
  error?: string
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
  send(args: { projectId: string; text: string; threadId?: string; attachments?: Attachment[] }): Promise<void>
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
  /** mark a thread with something pending as resolved */
  resolveThread(args: { projectId: string; threadId: string }): Promise<void>
  setAllowAll(args: { projectId: string; threadId: string; on: boolean }): Promise<void>
  /** archived threads of these projects, newest first (read on demand, never pushed with the state) */
  listArchived(projectIds: string[]): Promise<ArchivedThreadInfo[]>
  /** brings an archived thread back into the state; false when it is not in the archive */
  reopenArchived(args: { projectId: string; threadId: string }): Promise<boolean>
  startProcess(args: { projectId: string; name: string; command: string }): Promise<void>
  stopProcess(args: { projectId: string; processId: string }): Promise<void>
  removeProcess(args: { projectId: string; processId: string }): Promise<void>
  /** opens http://localhost:PORT in the default browser */
  openPort(port: number, projectId: string): Promise<void>
  /** owner only: hides (or shows again) a project from the machines paired to this one */
  setRemoteHidden(args: { projectId: string; hidden: boolean }): Promise<void>
  /** installs an optional plugin through Claude's marketplace */
  installPlugin(args: { id: string; force?: boolean }): Promise<void>
  openPluginReport(id: string): Promise<void>
  /** turns one of the user's own Claude Code plugins (or 'personal' skills) on/off for threads */
  setUserPlugin(args: { id: string; on: boolean }): Promise<void>
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
