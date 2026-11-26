import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fixPastedCommand, splitCommandLine } from './install-command.ts'

test('splitCommandLine keeps quoted parts together', () => {
  assert.deepEqual(splitCommandLine(`npx -y "@scope/a b" 'x y' z`), ['npx', '-y', '@scope/a b', 'x y', 'z'])
  assert.deepEqual(splitCommandLine('  '), [])
})

test('the Context7 case: claude mcp add pasted as command + one argument line becomes the http URL', () => {
  const fix = fixPastedCommand('claude', ['mcp add --transport http context7 https://mcp.context7.com/mcp'])
  assert.equal(fix?.kind, 'install')
  assert.deepEqual(fix?.fixed, { transport: 'http', url: 'https://mcp.context7.com/mcp', headers: {}, env: {} })
  assert.equal(fix?.name, 'context7')
})

test('the whole claude mcp add line in the command field, with a header', () => {
  const fix = fixPastedCommand('claude mcp add -t http -s user ctx https://mcp.context7.com/mcp --header "CONTEXT7_API_KEY: abc"', [])
  assert.deepEqual(fix?.fixed, { transport: 'http', url: 'https://mcp.context7.com/mcp', headers: { CONTEXT7_API_KEY: 'abc' }, env: {} })
})

test('a stdio claude mcp add keeps the server command after --, with its env', () => {
  const fix = fixPastedCommand('claude', ['mcp', 'add', 'context7', '-e', 'K=v', '--', 'npx', '-y', '@upstash/context7-mcp'])
  assert.deepEqual(fix?.fixed, { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], headers: {}, env: { K: 'v' } })
})

test('codex mcp add with --url, and claude.exe on Windows', () => {
  assert.deepEqual(fixPastedCommand('codex', ['mcp add ctx --url https://mcp.context7.com/mcp'])?.fixed,
    { transport: 'http', url: 'https://mcp.context7.com/mcp', headers: {}, env: {} })
  assert.equal(fixPastedCommand('C:\\Users\\x\\claude.exe', ['mcp', 'add', 'a', 'https://h.example/mcp'])?.kind, 'install')
})

test('a command with its arguments typed in the command field is split', () => {
  const fix = fixPastedCommand('npx -y @upstash/context7-mcp', [])
  assert.equal(fix?.kind, 'split')
  assert.deepEqual(fix?.fixed, { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'], headers: {}, env: {} })
})

test('a well-formed command is left alone', () => {
  assert.equal(fixPastedCommand('npx', ['-y', '@upstash/context7-mcp']), null)
  assert.equal(fixPastedCommand('claude', ['mcp', 'serve']), null)
  assert.equal(fixPastedCommand('', []), null)
})
