// The gateway's capability token reaches it through a private file: both agent CLIs receive
// the MCP server's env on their command line, which `ps` shows to anyone on the machine.
// Runs inside gateway.js too, so it imports nothing from electron.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Writes the token to a file only this user can read and returns its path. Same token, same file. */
export function writeTokenFile(dir: string, token: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = join(dir, createHash('sha256').update(token).digest('hex').slice(0, 16))
  writeFileSync(file, token, { mode: 0o600 })
  return file
}

export function readGatewayToken(env: NodeJS.ProcessEnv): string {
  const file = env.BRANDY_GATEWAY_TOKEN_FILE
  if (!file) return env.BRANDY_GATEWAY_TOKEN ?? ''
  try {
    return readFileSync(file, 'utf8')
  } catch {
    // an empty token is refused by main with the "bad session" answer
    return ''
  }
}
