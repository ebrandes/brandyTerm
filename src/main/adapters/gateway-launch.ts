// Launch spec for the per-thread gateway MCP server. The provider is installed once the
// socket server is up; until then (and in tests) no thread gets a gateway.
import { join, resolve } from 'node:path'
import type { ThreadRef } from '../../shared/connectors.ts'

export interface GatewaySpec {
  command: string
  args: string[]
  env: Record<string, string>
}

let provider: ((t: ThreadRef) => GatewaySpec | null) | null = null

export function setGatewayProvider(fn: (t: ThreadRef) => GatewaySpec | null): void {
  provider = fn
}

export function gatewayFor(t?: ThreadRef): GatewaySpec | null {
  return t && provider ? provider(t) : null
}

/** Built next to the main bundle (out/main/gateway.js). */
export function gatewayScript(): string {
  // __dirname is absent when the module runs as ESM (tests); the bundle always has it.
  return join(typeof __dirname === 'string' ? __dirname : resolve('out/main'), 'gateway.js')
}

/** `extraEnv` adds flags for this thread's gateway (BRANDY_GATEWAY_SKILLS for /skill-* threads). */
export function gatewaySpec(socket: string, token: string, extraEnv?: Record<string, string>): GatewaySpec {
  return {
    command: process.execPath,
    args: [gatewayScript()],
    env: { ELECTRON_RUN_AS_NODE: '1', BRANDY_GATEWAY_SOCKET: socket, BRANDY_GATEWAY_TOKEN: token, ...extraEnv },
  }
}
