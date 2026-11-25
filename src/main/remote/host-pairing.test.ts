import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { clientProof, PairingWindow } from '../../shared/remote/pairing.ts'
import { newKeyPair, toB64 } from '../../shared/remote/crypto.ts'
import { PROTOCOL_VERSION } from '../../shared/remote/protocol.ts'
import { randomBytes } from '@noble/hashes/utils'
import { handlePair } from './host-pairing.ts'
import { TrustStore } from './trust.ts'

const dirs: string[] = []
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }) })

test('pairing a client under a new key revokes its old client key', () => {
  const d = fs.mkdtempSync(join(os.tmpdir(), 'hp-'))
  dirs.push(d)
  const trust = new TrustStore(d)
  const window = new PairingWindow(() => Date.now())
  const machine = { id: '22222222-2222-4222-8222-222222222222', name: 'Host', os: 'linux' as const }
  trust.add({ pub: 'OLD', role: 'client', machineId: '11111111-1111-4111-8111-111111111111', name: 'Cel', os: 'mac' })
  trust.add({ pub: 'HOSTKEY', role: 'host', machineId: '11111111-1111-4111-8111-111111111111', name: 'Cel', os: 'mac' })
  const code = window.open()
  const k = newKeyPair()
  const nonceC = randomBytes(16)
  const text = JSON.stringify({
    t: 'pair', cpub: toB64(k.pub), nonceC: toB64(nonceC), proof: clientProof(code, k.pub, nonceC),
    machineId: '11111111-1111-4111-8111-111111111111', name: 'Cel', os: 'mac', protocol: PROTOCOL_VERSION
  })
  assert.equal(handlePair(text, { window, code, trust, machine }).paired, true)
  assert.deepEqual(trust.list('client').map(x => x.pub), [toB64(k.pub)])
  assert.equal(trust.list('host').length, 1) // the other direction is untouched
})
