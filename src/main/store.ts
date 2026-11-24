import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Project } from '../shared/types.ts'

export interface Persisted {
  version: 1
  projects: Project[]
}

/** Snapshot persistence behind a tiny interface so SQLite can replace it later. */
export class JsonStore {
  private timer: NodeJS.Timeout | null = null
  private pending: (() => Persisted) | null = null

  private file: string

  constructor(file: string) {
    this.file = file
  }

  load(): Persisted | null {
    for (const f of [this.file, this.file + '.bak']) {
      try {
        if (!existsSync(f)) continue
        const data = JSON.parse(readFileSync(f, 'utf8')) as Persisted
        if (data.version === 1 && Array.isArray(data.projects)) return data
      } catch {
        // try the backup next
      }
    }
    return null
  }

  schedule(snapshot: () => Persisted): void {
    this.pending = snapshot
    if (this.timer) return
    this.timer = setTimeout(() => this.flush(), 400)
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    const snap = this.pending?.()
    this.pending = null
    if (!snap) return
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    writeFileSync(tmp, JSON.stringify(snap), 'utf8')
    if (existsSync(this.file)) {
      try {
        renameSync(this.file, this.file + '.bak')
      } catch {
        // backup is best effort
      }
    }
    renameSync(tmp, this.file)
  }
}
