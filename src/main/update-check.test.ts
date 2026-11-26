import test from 'node:test'
import assert from 'node:assert/strict'
import { checkForUpdate, type CheckDeps } from './update-check.ts'

const URL_ = 'https://github.com/ebrandes/brandyTerm/releases/tag/v0.2.0'
const release = (tag: string, url = URL_) => async () => ({ status: 200, body: { tag_name: tag, html_url: url } })
const noReleases = async () => ({ status: 404, body: { message: 'Not Found' } })
const offline = async (): Promise<never> => { throw new Error('getaddrinfo ENOTFOUND api.github.com') }

interface Clone { head?: string; remote?: string; branch?: string; known?: boolean; behind?: number; offline?: boolean }

function fakeGit(c: Clone) {
  const calls: string[] = []
  let known = c.known ?? false
  const head = c.head ?? 'a'.repeat(40)
  const git = async (args: string[]): Promise<string> => {
    const line = args.join(' ')
    calls.push(line)
    if (line === 'rev-parse HEAD') return head
    if (line === 'rev-parse --abbrev-ref HEAD') return c.branch ?? 'main'
    if (args[0] === 'ls-remote') {
      if (c.offline) throw new Error('could not resolve host')
      return `${c.remote ?? head}\trefs/heads/main`
    }
    if (args[0] === 'cat-file') {
      if (!known) throw new Error('missing object')
      return ''
    }
    if (args[0] === 'fetch') { known = true; return '' }
    if (args[0] === 'rev-list') return String(c.behind ?? 0)
    throw new Error(`unexpected git ${line}`)
  }
  return { git, calls, fetched: () => calls.some((l) => l.startsWith('fetch')) }
}

function deps(over: Partial<CheckDeps>) {
  const logs: string[] = []
  const d: CheckDeps = { version: '0.1.0', fetchLatest: noReleases, log: (level, msg) => logs.push(`${level} ${msg}`), ...over }
  return { d, logs }
}

const B = 'b'.repeat(40)

test('a newer release wins and git is not asked about the remote', async () => {
  const g = fakeGit({ remote: B, behind: 3 })
  const r = await checkForUpdate(deps({ fetchLatest: release('v0.2.0'), git: g.git }).d)
  assert.deepEqual(r.update, { kind: 'release', version: '0.2.0', url: URL_ })
  assert.equal(r.commit, 'aaaaaaa')
  assert.equal(g.calls.some((l) => l.startsWith('ls-remote')), false)
})

test('packaged app: equal, older or no release means no update', async () => {
  for (const fetchLatest of [release('v0.1.0'), release('v0.0.9'), noReleases]) {
    const r = await checkForUpdate(deps({ fetchLatest }).d)
    assert.deepEqual(r, { update: null })
  }
})

test('a release link outside GitHub is replaced by the repository releases page', async () => {
  const r = await checkForUpdate(deps({ fetchLatest: release('v0.2.0', 'https://evil.example/x') }).d)
  assert.equal(r.update?.kind === 'release' && r.update.url, 'https://github.com/ebrandes/brandyTerm/releases/latest')
})

test('clone without a newer release: counts commits behind after a light fetch', async () => {
  const g = fakeGit({ remote: B, behind: 4 })
  const r = await checkForUpdate(deps({ fetchLatest: release('v0.1.0'), git: g.git }).d)
  assert.deepEqual(r.update, { kind: 'git', behind: 4, command: 'git pull' })
  const fetch = g.calls.find((l) => l.startsWith('fetch'))
  assert.equal(fetch, 'fetch --quiet --no-tags --no-recurse-submodules origin main')
})

test('clone in sync or already holding the remote commit does not fetch', async () => {
  const same = fakeGit({})
  assert.equal((await checkForUpdate(deps({ git: same.git }).d)).update, null)
  assert.equal(same.fetched(), false)
  const ahead = fakeGit({ remote: B, known: true, behind: 0 })
  assert.equal((await checkForUpdate(deps({ git: ahead.git }).d)).update, null)
  assert.equal(ahead.fetched(), false)
})

test('on another branch the suggested command names origin main', async () => {
  const g = fakeGit({ remote: B, behind: 1, branch: 'feat/x' })
  const r = await checkForUpdate(deps({ git: g.git }).d)
  assert.deepEqual(r.update, { kind: 'git', behind: 1, command: 'git pull origin main' })
})

test('network failure is logged and leaves the update unknown', async () => {
  const packaged = deps({ fetchLatest: offline })
  assert.deepEqual(await checkForUpdate(packaged.d), {})
  assert.match(packaged.logs.join(), /warn .*release/)
  const g = fakeGit({ offline: true })
  const clone = deps({ fetchLatest: offline, git: g.git })
  assert.deepEqual(await checkForUpdate(clone.d), { commit: 'aaaaaaa' })
  assert.match(clone.logs.join(), /warn .*git/)
})

test('rate limit counts as a failure; a clone in sync cannot rule out a release', async () => {
  const limited = deps({ fetchLatest: async () => ({ status: 403, body: {} }), git: fakeGit({}).git })
  assert.equal('update' in (await checkForUpdate(limited.d)), false)
})

test('release lookup failing still reports a clone that is behind', async () => {
  const r = await checkForUpdate(deps({ fetchLatest: offline, git: fakeGit({ remote: B, behind: 2 }).git }).d)
  assert.equal(r.update?.kind, 'git')
})
