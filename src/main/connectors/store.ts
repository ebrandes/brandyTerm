// Connector definitions (no secrets) in userData/connectors.json.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { writeAtomic, keepCorrupt } from '../atomic-write.ts'
import type { Connector } from '../../shared/connectors.ts'
import { connectorProblem } from '../../shared/connector-problem.ts'
import { activeIn } from '../../shared/connector-scope.ts'
import { readConnectors } from './store-load.ts'

export class ConnectorStore extends EventEmitter {
  private items: Connector[]
  private readonly file: string
  /** set when connectors.json could not be read as a list */
  fault?: string

  constructor(file: string) {
    super()
    this.file = file
    this.items = this.load()
  }

  /** every entry comes back, repaired or marked broken; the file as it was is copied aside before any rewrite */
  private load(): Connector[] {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [] // not created yet
      this.fault = `connectors.json não pôde ser lido: ${e instanceof Error ? e.message : String(e)}`
      return []
    }
    const r = readConnectors(text)
    if (r.changed) keepCorrupt(this.file, 'connectors')
    this.fault = r.fault
    return r.items
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

  /** `undefined` in a patch removes that field */
  update(id: string, patch: Partial<Omit<Connector, 'id'>>): Connector {
    const i = this.items.findIndex(x => x.id === id)
    if (i < 0) throw new Error('Conector não encontrado')
    if (patch.name !== undefined) this.requireName(patch.name, id)
    const { id: _ignored, ...rest } = patch as Partial<Connector>
    const next: Connector = { ...this.items[i], ...rest, id }
    for (const k of Object.keys(next) as (keyof Connector)[]) if (next[k] === undefined) delete next[k]
    this.items[i] = next
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

  /** a connector with a problem in its definition stays in the panel but is not offered to threads */
  visibleFor(projectPath: string): Connector[] {
    return this.items
      .filter(c => c.enabled && activeIn(c, projectPath) && !connectorProblem(c))
      .map(c => ({ ...c }))
  }
}
