import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hostRunner, type Startable } from './runner.ts'

/** a server whose start fails on the ports in `busy` */
function rig(busy: Set<number>) {
  const log: string[] = []
  let want: number | null = null
  const statuses: string[] = []
  const make = (): Startable => ({
    async start(port) {
      log.push(`start ${port}`)
      if (busy.has(port)) throw new Error(`listen EADDRINUSE: address already in use 0.0.0.0:${port}`)
    },
    async stop() { log.push('stop') }
  })
  const r = hostRunner({ desired: () => want, make, onStatus: s => statuses.push(JSON.stringify(s)) })
  return { r, log, statuses, set: (p: number | null) => { want = p } }
}

test('a port that cannot be opened is reported, not just logged', async () => {
  const { r, set, statuses } = rig(new Set([7777]))
  assert.deepEqual(r.status(), { state: 'off' })
  set(7777)
  await r.sync()
  const s = r.status()
  assert.equal(s.state, 'failed')
  assert.equal(s.state === 'failed' && s.port, 7777)
  assert.match(s.state === 'failed' ? s.error : '', /EADDRINUSE/)
  assert.equal(r.server(), null)
  assert.ok(statuses.at(-1)?.includes('failed'))
})

test('the same failing port is not retried until the settings change; another port starts', async () => {
  const { r, set, log } = rig(new Set([7777]))
  set(7777)
  await r.sync()
  await r.sync()
  assert.equal(log.filter(l => l === 'start 7777').length, 1)
  set(7778)
  await r.sync()
  assert.deepEqual(r.status(), { state: 'on', port: 7778 })
  assert.ok(r.server())
  set(null)
  await r.sync()
  assert.deepEqual(r.status(), { state: 'off' })
  assert.equal(r.server(), null)
})

test('stop closes the server and leaves the status off', async () => {
  const { r, set, log } = rig(new Set())
  set(7000)
  await r.sync()
  assert.deepEqual(r.status(), { state: 'on', port: 7000 })
  await r.stop()
  assert.deepEqual(r.status(), { state: 'off' })
  assert.equal(log.at(-1), 'stop')
  await r.sync()
  assert.equal(r.server(), null, 'no restart after stop')
})
