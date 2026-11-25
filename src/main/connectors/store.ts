// Connector definitions (no secrets) in userData/connectors.json.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeAtomic, keepCorrupt } from '../atomic-write.ts'
import type { Connector } from '../../shared/connectors.ts'

export class ConnectorStore extends EventEmitter {
  private items: Connector[]
  private readonly file: string

  constructor(file: string) {
    super()
    this.file = file
    this.items = this.load()
  }

  private load(): Connector[] {
    try {
      const v = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      if (Array.isArray(v)) return v
    } catch { /* missing or corrupt */ }
    keepCorrupt(this.file, 'connectors')
    return []
  }

  private save(): void {
    fs.mkdirSync(dirname(this.file), { recursive: true })
    writeAtomic(this.file, JSON.stringify(this.items, null, 2), 0o600)
    this.emit('change')
  }

  list(): Connector[] {
    return this.items.map(c => ({ ...c }))
  }

  get(id: string): Connector | undefined {
    const c = this.items.find(x => x.id === id)
    return c && { ...c }
  }

  byName(name: string): Connector | undefined {
    const n = name.toLowerCase()
    const c = this.items.find(x => x.name.toLowerCase() === n)
    return c && { ...c }
  }

  private requireName(name: string, exceptId?: string): void {
    const dup = this.byName(name)
    if (dup && dup.id !== exceptId) throw new Error(`Já existe um conector chamado ${dup.name}`)
  }

  add(c: Omit<Connector, 'id' | 'alwaysAllow'>): Connector {
    this.requireName(c.name)
    const made: Connector = { ...c, id: randomUUID(), alwaysAllow: [] }
    this.items.push(made)
    this.save()
    return { ...made }
  }

  update(id: string, patch: Partial<Omit<Connector, 'id'>>): Connector {
    const i = this.items.findIndex(x => x.id === id)
    if (i < 0) throw new Error('Conector não encontrado')
    if (patch.name !== undefined) this.requireName(patch.name, id)
    const { id: _ignored, ...rest } = patch as Partial<Connector>
    this.items[i] = { ...this.items[i], ...rest, id }
    this.save()
    return { ...this.items[i] }
  }

  remove(id: string): void {
    this.items = this.items.filter(x => x.id !== id)
    this.save()
  }

  allow(id: string, tool: string): void {
    const c = this.items.find(x => x.id === id)
    if (!c || c.alwaysAllow.includes(tool)) return
    c.alwaysAllow = [...c.alwaysAllow, tool]
    this.save()
  }

  revoke(id: string, tool: string): void {
    const c = this.items.find(x => x.id === id)
    if (!c || !c.alwaysAllow.includes(tool)) return
    c.alwaysAllow = c.alwaysAllow.filter(t => t !== tool)
    this.save()
  }

  visibleFor(projectPath: string): Connector[] {
    return this.items.filter(c => c.enabled && (!c.projects || c.projects.includes(projectPath))).map(c => ({ ...c }))
  }
}
