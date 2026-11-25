// machineId -> last known address of the hosts this machine dials, in <dir>/remote-hosts.json.
import fs from 'node:fs'
import { join } from 'node:path'

export class HostAddresses {
  private readonly file: string
  private map: Record<string, string>

  constructor(dir: string) {
    this.file = join(dir, 'remote-hosts.json')
    this.map = this.load()
  }

  private load(): Record<string, string> {
    try {
      const v: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
      return Object.fromEntries(Object.entries(v).filter(([, a]) => typeof a === 'string')) as Record<string, string>
    } catch { return {} }
  }

  get(machineId: string): string | undefined { return this.map[machineId] }

  set(machineId: string, address: string): void {
    if (this.map[machineId] === address) return
    this.map = { ...this.map, [machineId]: address }
    this.save()
  }

  delete(machineId: string): void {
    if (!(machineId in this.map)) return
    const { [machineId]: _gone, ...rest } = this.map
    this.map = rest
    this.save()
  }

  private save(): void {
    // best effort: a disk error must not crash the caller (an mDNS callback, for one)
    try {
      const tmp = `${this.file}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(this.map, null, 2))
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[remote] não foi possível salvar os endereços:', e instanceof Error ? e.message : e)
    }
  }
}
