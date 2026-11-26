import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attributeProcs, candidatePids, procLabel, type ProcEntry, type ProcSnapshot } from './proc-attribution.ts'

const APP = 100
const roots = [{ projectId: 'fix', path: '/Users/u/Projects/fix-everything' }]
const none = { terminals: new Map<string, number>(), managed: [] as number[] }

const p = (pid: number, ppid: number, o: Partial<ProcEntry> = {}): ProcEntry => ({ pid, ppid, command: `cmd-${pid}`, ...o })
const snap = (procs: ProcEntry[], ports: Record<number, number[]>): ProcSnapshot => ({
  procs,
  ports: new Map(Object.entries(ports).map(([k, v]) => [Number(k), v]))
})
const run = (s: ProcSnapshot, owned = none, r = roots, platform = 'darwin') => attributeProcs(s, r, owned, APP, platform)
const brief = (s: ProcSnapshot, owned = none, r = roots, platform = 'darwin') =>
  run(s, owned, r, platform).map((d) => [d.pid, d.projectId, d.origin])

test('a detached daemon with its cwd in a subfolder belongs to the project (the astro preview case)', () => {
  const s = snap([p(17948, 1, { cwd: '/Users/u/Projects/fix-everything/apps/site' })], { 17948: [4321] })
  assert.deepEqual(run(s), [{ pid: 17948, projectId: 'fix', origin: 'external', command: 'cmd-17948', ports: [4321] }])
})

test('a descendant of the project terminal is "terminal", wherever its cwd is', () => {
  const s = snap([p(200, APP), p(201, 200), p(202, 201, { cwd: '/tmp' })], { 202: [5055] })
  const owned = { terminals: new Map([['fix', 200]]), managed: [] }
  assert.deepEqual(brief(s, owned), [[202, 'fix', 'terminal']])
})

test('a pty whose id is not a project (account login) names no project', () => {
  const s = snap([p(200, APP), p(201, 200, { cwd: '/tmp' })], { 201: [5055] })
  assert.deepEqual(brief(s, { terminals: new Map([['login:1', 200]]), managed: [] }), [])
})

test('a grandchild of a thread with its cwd in the project is "thread"', () => {
  const s = snap([p(300, APP), p(301, 300), p(302, 301, { cwd: roots[0].path })], { 302: [3000] })
  assert.deepEqual(brief(s), [[302, 'fix', 'thread']])
})

test('the app and its descendants outside every project stay out', () => {
  const s = snap([p(APP, 1, { cwd: roots[0].path }), p(301, APP, { cwd: '/tmp' }), p(302, APP)], {
    [APP]: [47321], 301: [6000], 302: [6001]
  })
  assert.deepEqual(brief(s), [])
})

test('what the "+" button manages is already listed, children included', () => {
  const cwd = roots[0].path
  const s = snap([p(400, APP, { cwd }), p(401, 400, { cwd })], { 401: [3000] })
  assert.deepEqual(brief(s, { terminals: new Map(), managed: [400] }), [])
})

test('with nested projects the longest root wins; a sibling prefix does not match', () => {
  const r = [{ projectId: 'a', path: '/a/proj' }, { projectId: 'inner', path: '/a/proj/apps/web/' }]
  const s = snap([p(1000, 1, { cwd: '/a/proj/apps/web/src' }), p(1001, 1, { cwd: '/a/proj-2' }), p(1002, 1, { cwd: '/a/proj' })], {
    1000: [1], 1001: [2], 1002: [3]
  })
  assert.deepEqual(brief(s, none, r), [[1000, 'inner', 'external'], [1002, 'a', 'external']])
})

test('mac and windows ignore case; linux does not', () => {
  const s = snap([p(500, 1, { cwd: '/users/u/projects/FIX-everything' })], { 500: [80] })
  assert.equal(run(s).length, 1)
  assert.equal(run(s, none, roots, 'linux').length, 0)
})

test('windows without a cwd matches the command line, with backslashes and any case', () => {
  const r = [{ projectId: 'w', path: 'C:\\Dev\\Proj' }]
  const s = snap([
    p(600, 1, { command: '"C:\\Program Files\\nodejs\\node.exe" c:\\dev\\proj\\node_modules\\vite\\bin\\vite.js' }),
    p(601, 1, { command: 'node C:/Dev/Proj/server.js' }),
    p(602, 1, { command: 'node C:\\Dev\\Proj-2\\server.js' })
  ], { 600: [5173], 601: [3000], 602: [3001] })
  assert.deepEqual(brief(s, none, r, 'win32'), [[600, 'w', 'external'], [601, 'w', 'external']])
})

test('a known cwd outside the project is not overridden by the command line', () => {
  const s = snap([p(650, 1, { cwd: '/tmp', command: `tail -f ${roots[0].path}/log` })], { 650: [9] })
  assert.deepEqual(brief(s), [])
})

test('a ppid cycle does not hang', () => {
  const s = snap([p(700, 701, { cwd: roots[0].path }), p(701, 700)], { 700: [1234] })
  assert.deepEqual(brief(s), [[700, 'fix', 'external']])
})

test('a parent and its workers sharing the same ports are listed once', () => {
  const cwd = roots[0].path
  const s = snap([p(800, 1, { cwd }), p(801, 800, { cwd }), p(802, 800, { cwd })], { 800: [80], 801: [80], 802: [9229] })
  assert.deepEqual(brief(s), [[800, 'fix', 'external'], [802, 'fix', 'external']])
})

const shell = p(200, APP, { pgid: 200, tpgid: 900 })
const term = { terminals: new Map([['fix', 200]]), managed: [] as number[] }

test('the terminal foreground job shows without a port, once, by its leader', () => {
  const job = [p(900, 200, { pgid: 900, tpgid: 900 }), p(901, 900, { pgid: 900, tpgid: 900 })]
  const s = snap([shell, ...job], {})
  assert.deepEqual(run(s, term), [{ pid: 900, projectId: 'fix', origin: 'terminal', command: 'cmd-900', ports: [] }])
  assert.deepEqual(candidatePids(s, term), [900])
})

test('a foreground job that listens shows only the listener; an idle shell shows nothing', () => {
  const job = [p(900, 200, { pgid: 900, tpgid: 900 }), p(901, 900, { pgid: 900, tpgid: 900 })]
  assert.deepEqual(brief(snap([shell, ...job], { 901: [5055] }), term), [[901, 'fix', 'terminal']])
  assert.deepEqual(brief(snap([p(200, APP, { pgid: 200, tpgid: 200 })], {}), term), [])
})

test('labels drop the interpreter and the folders', () => {
  assert.equal(
    procLabel('/opt/homebrew/Cellar/node/26.7.0/bin/node /x/apps/site/node_modules/astro/bin/astro.mjs preview --port 4321 --json'),
    'astro preview --port 4321 --json'
  )
  assert.equal(procLabel('"C:\\Program Files\\nodejs\\node.exe" C:\\p\\node_modules\\vite\\bin\\vite.js --host'), 'vite --host')
  assert.equal(procLabel('node --inspect server.js'), 'node --inspect server.js')
  assert.equal(procLabel('http-server'), 'http-server')
  assert.ok(procLabel(`serve ${'x'.repeat(200)}`).length <= 60)
})

test('mac: composed and decomposed accents are the same folder', () => {
  const snapshot = { procs: [{ pid: 10, ppid: 1, command: 'node s.js', cwd: '/u/\u00c1rea'.normalize('NFD') }], ports: new Map([[10, [3000]]]) }
  const found = attributeProcs(snapshot, [{ projectId: 'a', path: '/u/\u00c1rea' }], { terminals: new Map(), managed: [] }, 99, 'darwin')
  assert.deepEqual(found.map((d) => d.projectId), ['a'])
})

test('label: the unquoted "Application Support" folder does not split the program name', () => {
  assert.equal(procLabel('/Users/u/Library/Application Support/x/bin/tool --serve'), 'tool --serve')
})
