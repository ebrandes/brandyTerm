import type { AppState } from './types.ts'

export interface BrandyApi {
  platform: string
  getState(): Promise<AppState>
  onState(cb: (s: AppState) => void): () => void
  /** opens the native folder picker; returns the new/existing project id or null */
  openFolder(): Promise<string | null>
  removeProject(projectId: string): Promise<void>
  send(args: { projectId: string; text: string; threadId?: string }): Promise<void>
  cancelThread(args: { projectId: string; threadId: string }): Promise<void>
  startProcess(args: { projectId: string; name: string; command: string }): Promise<void>
  stopProcess(args: { projectId: string; processId: string }): Promise<void>
  removeProcess(args: { projectId: string; processId: string }): Promise<void>
  /** opens http://localhost:PORT in the default browser */
  openPort(port: number): Promise<void>
}
