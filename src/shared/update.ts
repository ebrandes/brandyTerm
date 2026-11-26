/** The version shown next to the logo and the update notice. The app only tells; it never installs. */

export type UpdateNotice =
  | { kind: 'release'; version: string; url: string }
  | { kind: 'git'; behind: number; command: string }

export interface UpdateStatus {
  /** app.getVersion() */
  version: string
  /** short HEAD hash, only when running from a git clone */
  commit?: string
  update: UpdateNotice | null
}

export interface UpdateApi {
  get(): Promise<UpdateStatus>
  onChange(cb: (s: UpdateStatus) => void): () => void
  /** opens the release page of the current notice in the browser */
  openRelease(): Promise<void>
}
