/**
 * Practical check on a real machine: starts a disposable server in a temp folder, finds it with the
 * panel's own scan, stops it with the app's own code and confirms the port is free.
 * Run with `node scripts/proc-stop-check.ts` (needs ps/lsof or PowerShell, outside any sandbox).
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createProcScanner } from '../src/main/proc-scan.ts'
import { checkStoppable, stopTree, systemDeps } from '../src/main/proc-stop.ts'
import { attributeProcs } from '../src/shared/proc-attribution.ts'

const listen = (port: number) =>
  new Promise<number>((resolve, reject) => {
    const server = createServer().once('error', reject)
    server.listen(port, () => {
      const used = (server.address() as { port: number }).port
      server.close(() => resolve(used))
    })
  })
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'proc-stop-')))
const port = await listen(0)
// the server has a child of its own, like a dev server with workers: both must go
writeFileSync(join(dir, 'server.js'), [
  "require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })",
  `require('http').createServer((q, r) => r.end('ok')).listen(${port})`
].join('\n'))
// started through a shell, like a package script
const parent = process.platform === 'win32'
  ? spawn('cmd', ['/c', 'node server.js'], { cwd: dir, stdio: 'ignore' })
  : spawn('sh', ['-c', 'node server.js; true'], { cwd: dir, stdio: 'ignore', detached: true })
// seen from outside the app, this script's own tree would be hidden as the app's
const APP_PID = -1
const owned = { terminals: [], managed: [] }

try {
  const scan = createProcScanner(process.platform)
  const roots = [{ projectId: 'check', path: dir }]
  let snapshot = await scan(owned, true)
  let list = attributeProcs(snapshot, roots, owned, APP_PID, process.platform)
  for (let i = 0; i < 20 && !list.some((d) => d.ports.includes(port)); i++) {
    await sleep(500)
    snapshot = await scan(owned, true)
    list = attributeProcs(snapshot, roots, owned, APP_PID, process.platform)
  }
  const found = list.find((d) => d.ports.includes(port))
  assert.ok(found, `the server on port ${port} did not show up`)
  console.log('listed:', found.pid, found.command, found.ports, `folder='${found.folder}'`, `startedAt=${found.startedAt}`)
  const child = snapshot.procs.find((p) => p.ppid === found.pid)
  assert.ok(child, 'the server has no child in the snapshot')

  const check = { shown: list, fresh: list, appPid: process.pid, snapshot }
  for (const pid of [1, process.pid, process.ppid]) {
    const refusal = checkStoppable({ ...check, pid })
    assert.ok(refusal, `pid ${pid} should be refused`)
    console.log(`refused ${pid}: ${refusal}`)
  }
  assert.equal(checkStoppable({ ...check, pid: found.pid }), undefined)

  const result = await stopTree(found.pid, snapshot, systemDeps())
  console.log('stop:', JSON.stringify(result))
  assert.ok(result.ok)
  await listen(port)
  console.log(`port ${port} is free`)
  assert.ok(!systemDeps().alive(found.pid), 'the server survived')
  assert.ok(!systemDeps().alive(child.pid), 'its child survived')
  console.log(`server ${found.pid} and child ${child.pid} are gone`)
} finally {
  if (parent.exitCode === null && parent.signalCode === null) parent.kill('SIGKILL')
  rmSync(dir, { recursive: true, force: true })
}
