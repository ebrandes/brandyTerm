import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateCustom } from './custom-form.ts'

const ok = { name: 'Meu', transport: 'stdio' as const, command: 'node', url: '' }

test('an empty name asks for the name', () => {
  assert.equal(validateCustom({ ...ok, name: '  ' }), 'Informe o nome')
})

test('stdio without a command asks for the command', () => {
  assert.equal(validateCustom({ ...ok, command: ' ' }), 'Informe o comando')
})

test('http needs an https url, or localhost', () => {
  const http = { ...ok, transport: 'http' as const, command: '' }
  assert.equal(validateCustom({ ...http, url: 'http://example.com/mcp' }), 'Use uma URL https')
  assert.equal(validateCustom({ ...http, url: 'não é url' }), 'Use uma URL https')
  assert.equal(validateCustom({ ...http, url: '' }), 'Informe a URL')
  assert.equal(validateCustom({ ...http, url: 'https://example.com/mcp' }), null)
  assert.equal(validateCustom({ ...http, url: 'http://localhost:3000/mcp' }), null)
  assert.equal(validateCustom({ ...http, url: 'http://127.0.0.1:3000/mcp' }), null)
})

test('a valid draft gives null', () => {
  assert.equal(validateCustom(ok), null)
})
