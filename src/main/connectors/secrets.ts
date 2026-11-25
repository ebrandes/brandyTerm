// Connector secrets, encrypted with the OS keychain (Electron safeStorage), in userData/connector-secrets.json.
import fs from 'node:fs'
import { dirname } from 'node:path'
import { keepCorrupt, writeAtomic } from '../atomic-write.ts'
import type { ConnectorSecrets } from '../../shared/connectors.ts'

export interface Cipher {
  available(): boolean
  encrypt(s: string): string
  decrypt(b64: string): string
}

export class SecretStore {
  private readonly file: string
  private readonly cipher: Cipher
  /** a copy of the current unreadable file already exists; cleared once a write replaces it */
  private corruptKept = false

  constructor(file: string, cipher: Cipher) {
    this.file = file
    this.cipher = cipher
  }

  private read(): Record<string, string> {
    let text: string
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.keep()
      return {}
    }
    try {
      const v = JSON.parse(text)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v
    } catch { /* fall through */ }
    this.keep()
    return {}
  }

  private keep(): void {
    if (this.corruptKept) return
    this.corruptKept = true
    keepCorrupt(this.file, 'connectors')
  }

  private write(all: Record<string, string>): void {
    fs.mkdirSync(dirname(this.file), { recursive: true })
    writeAtomic(this.file, JSON.stringify(all, null, 2), 0o600)
    this.corruptKept = false
  }

  get(id: string): ConnectorSecrets {
    const raw = this.read()[id]
    if (raw === undefined) return {}
    try {
      return JSON.parse(this.cipher.decrypt(raw))
    } catch (e) {
      console.error(`[connectors] segredo de ${id} ilegível:`, e instanceof Error ? e.message : e)
      return {}
    }
  }

  set(id: string, s: ConnectorSecrets): void {
    if (!this.cipher.available()) throw new Error('Criptografia do sistema indisponível; não dá para guardar o segredo.')
    this.write({ ...this.read(), [id]: this.cipher.encrypt(JSON.stringify(s)) })
  }

  patch(id: string, s: Partial<ConnectorSecrets>): void {
    this.set(id, { ...this.get(id), ...s })
  }

  remove(id: string): void {
    const all = this.read()
    if (!(id in all)) return
    delete all[id]
    this.write(all)
  }
}
