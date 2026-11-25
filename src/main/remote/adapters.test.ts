import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adapterDescriptions, loadAdapterDescriptions, parseAdapters } from './adapters.ts'

test('parseAdapters reads one adapter or a list, and ignores junk', () => {
  assert.deepEqual(parseAdapters('{"Name":"Wi-Fi","InterfaceDescription":"Intel Wireless"}'), { 'Wi-Fi': 'Intel Wireless' })
  const list = '[{"Name":"Ethernet 3","InterfaceDescription":"Fortinet SSL VPN"},{"Name":"x"},null]'
  assert.deepEqual(parseAdapters(list), { 'Ethernet 3': 'Fortinet SSL VPN' })
  assert.deepEqual(parseAdapters('nope'), {})
  assert.deepEqual(parseAdapters(''), {})
})

test('loadAdapterDescriptions asks PowerShell on Windows only and never fails', async () => {
  const runs: string[] = []
  const ok = (_f: string, args: string[], done: (e: Error | null, out: string) => void) => {
    runs.push(args.join(' '))
    done(null, '[{"Name":"Ethernet 3","InterfaceDescription":"Fortinet SSL VPN"}]')
  }
  await loadAdapterDescriptions('darwin', ok)
  assert.deepEqual(runs, [])
  assert.deepEqual(adapterDescriptions(), {})
  await loadAdapterDescriptions('win32', ok)
  assert.equal(runs.length, 1)
  assert.deepEqual(adapterDescriptions(), { 'Ethernet 3': 'Fortinet SSL VPN' })
  await loadAdapterDescriptions('win32', (_f, _a, done) => done(new Error('sem powershell'), ''))
  assert.deepEqual(adapterDescriptions(), {})
})
