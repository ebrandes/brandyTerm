import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RESULT_CAP, resultText, toolsText } from './result-text.ts'

test('text parts pass through and parts are joined', () => {
  assert.equal(resultText([{ type: 'text', text: 'a "b"\nc' }, { type: 'text', text: 'd' }]), 'a "b"\nc\nd')
})

test('an image becomes a placeholder with its type and decoded size, never its data', () => {
  const data = Buffer.alloc(3000, 7).toString('base64')
  const out = resultText([{ type: 'image', mimeType: 'image/png', data }])
  assert.equal(out, '[imagem image/png, 3000 bytes]')
  assert.equal(out.includes(data.slice(0, 20)), false)
})

test('audio becomes a placeholder', () => {
  assert.equal(resultText([{ type: 'audio', mimeType: 'audio/wav', data: Buffer.alloc(10).toString('base64') }]), '[áudio audio/wav, 10 bytes]')
})

test('resource and resource_link parts show only their uri', () => {
  const out = resultText([
    { type: 'resource', resource: { uri: 'file:///tmp/a.txt', text: 'segredo', mimeType: 'text/plain' } },
    { type: 'resource_link', uri: 'https://x/doc', name: 'doc' },
  ])
  assert.equal(out, '[recurso file:///tmp/a.txt]\n[recurso https://x/doc]')
})

test('a screenshot next to text keeps the text and drops the base64', () => {
  const data = Buffer.alloc(80_000, 1).toString('base64')
  assert.equal(resultText([{ type: 'text', text: 'Tirei a captura.' }, { type: 'image', mimeType: 'image/jpeg', data }]), 'Tirei a captura.\n[imagem image/jpeg, 80000 bytes]')
})

test('long text is capped with the note once', () => {
  assert.equal(resultText([{ type: 'text', text: 'x'.repeat(RESULT_CAP + 5) }]), 'x'.repeat(RESULT_CAP) + '\n(resultado cortado em 100000 caracteres)')
})

test('a tool list is compact JSON', () => {
  const tools = [{ name: 'a', description: 'A', inputSchema: { type: 'object' } }]
  assert.equal(toolsText(tools), JSON.stringify(tools))
})

test('an oversized tool list drops whole tools from the end and says so', () => {
  const tools = Array.from({ length: 50 }, (_, i) => ({ name: `t${i}`, description: 'd'.repeat(4000), inputSchema: { type: 'object' } }))
  const out = toolsText(tools)
  const [json, note] = out.split('\n')
  const kept = JSON.parse(json) as { name: string }[]
  assert.ok(kept.length > 0 && kept.length < 50)
  assert.deepEqual(kept.map(t => t.name), tools.slice(0, kept.length).map(t => t.name))
  assert.ok(json.length <= RESULT_CAP)
  assert.equal(note, `(lista cortada: ${kept.length} de 50 ferramentas)`)
})
