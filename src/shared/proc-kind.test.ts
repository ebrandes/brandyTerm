import { test } from 'node:test'
import assert from 'node:assert/strict'
import { procKind, uptimeLabel } from './proc-kind.ts'

test('known tools get a readable name', () => {
  const cases: [string, string][] = [
    ['/opt/homebrew/bin/node /x/node_modules/astro/bin/astro.mjs preview --port 4321 --json', 'Astro preview'],
    ['"C:\\Program Files\\nodejs\\node.exe" C:\\p\\node_modules\\vite\\bin\\vite.js --host', 'Vite dev'],
    ['node /x/.bin/vite preview', 'Vite preview'],
    ['node /x/.bin/next dev', 'Next dev'],
    ['http-server', 'http-server'],
    ['npm exec http-server@14 -p 5173', 'http-server'],
    ['npx -y serve dist', 'serve'],
    ['node /x/.bin/tsc --watch', 'tsc watch'],
    ['/usr/bin/python3 -m http.server 8000', 'Python http.server'],
    ['python /v/bin/uvicorn app:app', 'Uvicorn'],
    ['php -S localhost:8000', 'Servidor PHP'],
    ['rails server', 'Rails server'],
    ['npm run dev', 'npm run dev'],
    ['node /x/lib/npm-cli.js run build', 'npm run build'],
    ['pnpm run watch', 'pnpm run watch'],
    ['bun run dev', 'bun run dev']
  ]
  for (const [command, label] of cases) assert.equal(procKind(command), label, command)
})

test('anything else falls back to the short command', () => {
  assert.equal(procKind('/usr/local/bin/node /x/server.js --port 3'), 'server --port 3')
  assert.equal(procKind('node -e 1'), 'node -e 1')
  assert.equal(procKind('constructor x'), 'constructor x')
})

test('uptime in words', () => {
  const now = 10 * 24 * 3_600_000
  const ago = (min: number) => uptimeLabel(now - min * 60_000, now)
  assert.deepEqual([0, 12, 60, 135, 3000].map(ago), ['há menos de 1 min', 'há 12 min', 'há 1 h', 'há 2 h 15 min', 'há 2 d'])
  assert.equal(uptimeLabel(undefined, now), '')
})
