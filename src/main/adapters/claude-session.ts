import type { Options, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'

// the SDK is ESM-only; the main bundle is CommonJS, so it loads on first use
let sdk: Promise<typeof import('@anthropic-ai/claude-agent-sdk')> | undefined
const loadSdk = () => (sdk ??= import('@anthropic-ai/claude-agent-sdk'))

/**
 * One live Claude Code process driven by the Agent SDK in streaming-input mode. Each
 * `send` is one turn; the process stays up between turns, so a kept-alive session
 * (the coordinator) answers without paying a cold start per message.
 */
export class SdkSession {
  sessionId?: string
  private queue: SDKUserMessage[] = []
  private wake?: () => void
  private closed = false
  private error?: string
  private stderr = ''
  private abort = new AbortController()
  private onMessage?: (ev: any) => void
  private onEnd?: () => void

  constructor(options: Options) {
    void this.loop(options)
  }

  get alive(): boolean {
    return !this.closed
  }

  private async *input(): AsyncGenerator<SDKUserMessage> {
    while (!this.closed) {
      const next = this.queue.shift()
      if (next) yield next
      else await new Promise<void>((r) => (this.wake = r))
    }
  }

  private async loop(options: Options): Promise<void> {
    try {
      const { query } = await loadSdk()
      const q = query({
        prompt: this.input(),
        options: { ...options, abortController: this.abort, stderr: (d) => (this.stderr = (this.stderr + d).slice(-4000)) }
      })
      for await (const ev of q) {
        if ((ev as { session_id?: string }).session_id) this.sessionId = (ev as { session_id: string }).session_id
        this.onMessage?.(ev)
      }
    } catch (err) {
      this.error = this.abort.signal.aborted ? 'cancelado' : this.stderr.trim() || (err as Error).message
    } finally {
      this.closed = true
      this.wake?.()
      this.onEnd?.()
    }
  }

  /**
   * Sends one user message; `handle` sees every message of the turn and returns true on
   * the last one. Resolves with an error text when the process ends before that.
   */
  send(message: SDKUserMessage, handle: (ev: any) => boolean): Promise<string | undefined> {
    if (this.closed) return Promise.resolve(this.error ?? 'a sessão do Claude foi encerrada')
    return new Promise((resolve) => {
      const settle = (err?: string) => {
        this.onMessage = undefined
        this.onEnd = undefined
        resolve(err)
      }
      this.onMessage = (ev) => handle(ev) && settle()
      this.onEnd = () => settle(this.error ?? (this.stderr.trim() || 'Claude terminou sem resultado'))
      this.queue.push(message)
      this.wake?.()
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.abort.abort()
    this.wake?.()
  }
}
