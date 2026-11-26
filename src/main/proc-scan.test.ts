import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createProcScanner, type Run } from './proc-scan.ts'

const owned = { terminals: new Map<string, number>(), managed: [] as number[] }

function fake() {
  const calls: string[] = []
  const state = { fail: false, time: 0 }
  const run: Run = async (file, args) => {
    const starting = file === 'ps' && args.includes('pid=,lstart=')
    calls.push(file === 'lsof' && args.includes('cwd') ? `cwd ${args.at(-1)}` : starting ? `lstart ${args.at(-1)}` : file)
    if (state.fail) throw new Error('timeout')
    if (starting) return '   10 Thu Nov  5 09:04:28 2026\n'
    if (file === 'ps') return '10 1 10 0 node a.js\n11 1 11 0 node b.js\n'
    if (args.includes('cwd')) return 'p10\nfcwd\nn/proj\n'
    return 'p10\nn*:3000\n'
  }
  return { calls, state, scan: createProcScanner('darwin', run, () => state.time) }
}

test('one scan for concurrent calls, cached until it goes stale; cwd asked once per pid', async () => {
  const f = fake()
  const [a, b] = await Promise.all([f.scan(owned), f.scan(owned)])
  assert.equal(a, b)
  assert.equal(a.procs.find((p) => p.pid === 10)?.cwd, '/proj')
  assert.deepEqual([...f.calls].sort(), ['cwd 10', 'lsof', 'lstart 10', 'ps'])
  f.state.time = 3_000
  await f.scan(owned)
  assert.equal(f.calls.length, 4)
  f.state.time = 5_000
  const later = await f.scan(owned)
  assert.deepEqual(f.calls.slice(4).sort(), ['lsof', 'ps'])
  assert.equal(later.procs.find((p) => p.pid === 10)?.cwd, '/proj')
  assert.equal(later.procs.find((p) => p.pid === 10)?.startedAt, new Date(2026, 10, 5, 9, 4, 28).getTime())
})

test('fresh reads again within the ttl, asks the details anew and fails instead of answering with an old list', async () => {
  const f = fake()
  await f.scan(owned)
  await f.scan(owned, true)
  assert.equal(f.calls.filter((c) => c === 'cwd 10').length, 2)
  const running = f.scan(owned, true)
  const after = f.scan(owned, true)
  assert.notEqual(await running, await after)
  f.state.fail = true
  await assert.rejects(f.scan(owned, true), /timeout/)
  assert.equal((await f.scan(owned)).procs.length, 2)
})

test('a failed scan never throws: empty at first, then the last good one', async () => {
  const f = fake()
  f.state.fail = true
  assert.deepEqual((await f.scan(owned)).procs, [])
  f.state.fail = false
  f.state.time = 5_000
  const good = await f.scan(owned)
  f.state.fail = true
  f.state.time = 10_000
  assert.equal(await f.scan(owned), good)
})

test('windows: a single powershell call, cached for longer', async () => {
  const calls: string[] = []
  let time = 0
  const scan = createProcScanner('win32', async (file) => {
    calls.push(file)
    return '{"ports":{"LocalPort":80,"OwningProcess":10},"procs":{"ProcessId":10,"ParentProcessId":1,"Name":"a.exe"}}'
  }, () => time)
  await scan(owned)
  time = 9_000
  assert.deepEqual([...(await scan(owned)).ports], [[10, [80]]])
  assert.deepEqual(calls, ['powershell'])
})

test('an empty cwd answer is not remembered', async () => {
  let cwdCalls = 0
  let time = 0
  const scan = createProcScanner('darwin', async (file, args) => {
    if (args.includes('pid=,lstart=')) throw new Error('no lstart')
    if (file === 'ps') return '10 1 10 0 node a.js\n'
    if (args.includes('cwd')) return ++cwdCalls === 1 ? '' : 'p10\nfcwd\nn/proj\n'
    return 'p10\nn*:3000\n'
  }, () => time)
  await scan(owned)
  time = 5_000
  assert.equal((await scan(owned)).procs[0].cwd, '/proj')
})
