// The queue's own file under userData: written synchronously around every transition, because
// applying restarts the app (the engine's state is saved with a delay).
import fs from 'node:fs'
import { join } from 'node:path'
import type { ApplyItem } from '../shared/apply-queue.ts'
import { keepCorrupt, writeAtomic } from './atomic-write.ts'

export class ApplyStore {
  private file: string
  private patches: string

  constructor(userData: string) {
    this.file = join(userData, 'apply-queue.json')
    this.patches = join(userData, 'apply-queue')
  }

  load(): ApplyItem[] {
    if (!fs.existsSync(this.file)) return []
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (data?.version === 1 && Array.isArray(data.items)) return data.items as ApplyItem[]
    } catch {
      // kept aside below
    }
    keepCorrupt(this.file, 'apply')
    return []
  }

  save(items: ApplyItem[]): void {
    fs.mkdirSync(this.patches, { recursive: true })
    writeAtomic(this.file, JSON.stringify({ version: 1, items }, null, 2))
  }

  patchFile(id: string): string {
    fs.mkdirSync(this.patches, { recursive: true })
    return join(this.patches, `${id}.patch`)
  }

  dropPatch(id: string): void {
    fs.rmSync(this.patchFile(id), { force: true })
  }
}
