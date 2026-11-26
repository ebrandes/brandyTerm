import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLsofCwds, parseLsofPorts, parsePs, parsePsStarts, parseWindows } from './proc-scan-parse.ts'

// trimmed from real macOS output
const LSOF_PORTS = `p477
f8
n*:7000
f9
n*:7000
f10
n*:5000
p17948
f15
n[::1]:4321
p59006
f7
n[::1]:5433
f8
n127.0.0.1:5433
`

const LSOF_CWD = `p17948
fcwd
n/Users/brnds/Projects/fix-everything/apps/site
p24899
fcwd
n/Users/brnds/Projects/fix-everything
`

const PS = `17948     1 17948    0 /opt/homebrew/Cellar/node/26.7.0/bin/node /Users/brnds/Projects/fix-everything/apps/site/node_modules/astro/bin/astro.mjs preview --port 4321 --json
22712 22374 22374 22374 node /opt/homebrew/bin/codegraph serve --mcp
  746   464   464    0 /Applications/Claude.app/Contents/Frameworks/Claude Helper.app/Contents/MacOS/Claude Helper --type=utility
24899 24870 24870   -1 http-server
`

test('lsof ports: after the last colon, once per pid across IPv4 and IPv6', () => {
  assert.deepEqual([...parseLsofPorts(LSOF_PORTS)], [[477, [5000, 7000]], [17948, [4321]], [59006, [5433]]])
  assert.deepEqual([...parseLsofPorts('')], [])
})

test('lsof cwd: one folder per pid', () => {
  assert.deepEqual([...parseLsofCwds(LSOF_CWD)], [
    [17948, '/Users/brnds/Projects/fix-everything/apps/site'],
    [24899, '/Users/brnds/Projects/fix-everything']
  ])
})

test('ps: ids and the whole command line, spaces included', () => {
  const list = parsePs(PS)
  assert.equal(list.length, 4)
  assert.deepEqual(list[1], { pid: 22712, ppid: 22374, pgid: 22374, tpgid: 22374, command: 'node /opt/homebrew/bin/codegraph serve --mcp' })
  assert.match(list[0].command, /astro\.mjs preview --port 4321 --json$/)
  assert.match(list[2].command, /^\/Applications\/Claude\.app.*Claude Helper --type=utility$/)
  assert.equal(list[3].command, 'http-server')
})

test('windows json: ports per process, name when there is no command line', () => {
  const s = parseWindows(JSON.stringify({
    ports: [{ LocalPort: 5173, OwningProcess: 10 }, { LocalPort: 5173, OwningProcess: 10 }, { LocalPort: 135, OwningProcess: 4 }],
    procs: [
      { ProcessId: 10, ParentProcessId: 5, Name: 'node.exe', CommandLine: 'node vite' },
      { ProcessId: 4, ParentProcessId: 0, Name: 'System', CommandLine: null }
    ]
  }))
  assert.deepEqual([...s.ports], [[10, [5173]], [4, [135]]])
  assert.deepEqual(s.procs, [{ pid: 10, ppid: 5, command: 'node vite' }, { pid: 4, ppid: 0, command: 'System' }])
})

test('windows json: a single item comes as an object; broken output throws', () => {
  const s = parseWindows('﻿{"ports":{"LocalPort":80,"OwningProcess":10},"procs":{"ProcessId":10,"ParentProcessId":1,"Name":"a.exe"}}')
  assert.deepEqual([...s.ports], [[10, [80]]])
  assert.equal(s.procs[0].command, 'a.exe')
  assert.throws(() => parseWindows('Get-NetTCPConnection : error'))
})

test('ps lstart: one and two digit days, as local time; junk is skipped', () => {
  assert.deepEqual([...parsePsStarts('45505 Thu Nov 26 12:24:28 2026\n    7 Thu Nov  5 09:04:08 2026    \nx\n')], [
    [45505, new Date(2026, 10, 26, 12, 24, 28).getTime()], [7, new Date(2026, 10, 5, 9, 4, 8).getTime()]
  ])
})

test('windows json: the start time in ms; absent when the system has none', () => {
  const { procs } = parseWindows('{"procs":[{"ProcessId":1,"ParentProcessId":0,"Started":123},{"ProcessId":2,"ParentProcessId":0,"Started":null}]}')
  assert.deepEqual(procs.map((p) => p.startedAt), [123, undefined])
})
