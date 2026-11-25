import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { readClaudeServers, toDraft } from './import-claude.ts'

const FIXTURE = {
  numStartups: 3,
  mcpServers: {
    railway: { type: 'stdio', command: 'npx', args: ['-y', 'railway-mcp'], env: { RAILWAY_TOKEN: 'sek' } },
    docs: { type: 'http', url: 'https://docs.example.com/mcp', headers: { Authorization: 'Bearer x' } },
    plain: { type: 'http', url: 'https://plain.example.com/mcp' },
    old: { type: 'sse', url: 'https://old.example.com/sse' },
  },
}

function fixture(): string {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'imp-'))
  const file = join(dir, '.claude.json')
  fs.writeFileSync(file, JSON.stringify(FIXTURE))
  return file
}

test('reads the servers with key names only, and marks sse unsupported', () => {
  const list = readClaudeServers(fixture())
  assert.deepEqual(list.map((c) => c.name), ['railway', 'docs', 'plain', 'old'])
  assert.deepEqual(list[0].envKeys, ['RAILWAY_TOKEN'])
  assert.deepEqual(list[1].headerKeys, ['Authorization'])
  assert.equal(list[3].unsupported, 'SSE não é suportado')
  assert.equal(list[0].unsupported, undefined)
  const text = JSON.stringify(list)
  assert.ok(!text.includes('sek') && !text.includes('Bearer x'))
})

test('toDraft puts the values in secrets and gives auth none', () => {
  const [stdio, http, plain] = readClaudeServers(fixture())
  const a = toDraft(stdio, FIXTURE.mcpServers.railway)
  assert.deepEqual(a.secrets, { env: { RAILWAY_TOKEN: 'sek' } })
  assert.deepEqual(a.draft.auth, { kind: 'none' })
  assert.equal(a.draft.command, 'npx')
  assert.deepEqual(a.draft.envKeys, ['RAILWAY_TOKEN'])
  assert.ok(!JSON.stringify(a.draft).includes('sek'))
  const b = toDraft(http, FIXTURE.mcpServers.docs)
  assert.deepEqual(b.secrets, { headers: { Authorization: 'Bearer x' } })
  assert.deepEqual(b.draft.auth, { kind: 'none' })
  assert.ok(!JSON.stringify(b.draft).includes('Bearer x'))
  assert.deepEqual(toDraft(plain, FIXTURE.mcpServers.plain).draft.auth, { kind: 'oauth' })
})

test('reading never changes the file', () => {
  const file = fixture()
  const before = fs.readFileSync(file)
  const m = fs.statSync(file).mtimeMs
  readClaudeServers(file)
  assert.deepEqual(fs.readFileSync(file), before)
  assert.equal(fs.statSync(file).mtimeMs, m)
})

test('a missing or unreadable file gives []', () => {
  assert.deepEqual(readClaudeServers(join(os.tmpdir(), 'nope-' + Date.now(), '.claude.json')), [])
  const bad = fixture()
  fs.writeFileSync(bad, '{not json')
  assert.deepEqual(readClaudeServers(bad), [])
})
