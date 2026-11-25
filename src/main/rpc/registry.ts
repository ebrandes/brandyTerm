/** Pure (no electron import): the same registry serves the window IPC and, later, the network server. */

/** What a remote caller may do with a channel. `local-only` gets a remote variant later; until then it is refused. */
export type RemoteRule = 'pass' | 'deny' | 'terminal' | 'local-only'

export interface CallCtx {
  /** the calling window's WebContents (Electron); unknown here to keep this file electron-free */
  sender?: unknown
  remote?: { deviceId: string; terminal: boolean }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (arg: any, ctx: CallCtx) => unknown | Promise<unknown>

export class Registry {
  private map = new Map<string, { fn: Handler; rule: RemoteRule }>()

  add(channel: string, fn: Handler, rule: RemoteRule): void {
    if (this.map.has(channel)) throw new Error(`Canal já registrado: ${channel}`)
    this.map.set(channel, { fn, rule })
  }

  async invoke(channel: string, arg: unknown, ctx: CallCtx): Promise<unknown> {
    const h = this.map.get(channel)
    if (!h) throw new Error(`Canal desconhecido: ${channel}`)
    if (ctx.remote) {
      if (h.rule === 'deny' || h.rule === 'local-only') throw new Error(`Não permitido remotamente: ${channel}`)
      if (h.rule === 'terminal' && !ctx.remote.terminal) throw new Error('Terminal remoto não liberado para este dispositivo')
    }
    return h.fn(arg, ctx)
  }

  rule(channel: string): RemoteRule | undefined {
    return this.map.get(channel)?.rule
  }

  channels(): string[] {
    return [...this.map.keys()]
  }
}

export const registry = new Registry()
