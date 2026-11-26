// One update check: the latest GitHub release first, then (git clones only) how far HEAD is behind
// origin/main. Network and git come injected. No Electron import.
import { isNewer, parseVersion } from '../shared/semver.ts'
import type { UpdateNotice } from '../shared/update.ts'

const REPO = 'ebrandes/brandyTerm'
export const LATEST_RELEASE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`

export interface HttpAnswer {
  status: number
  body: unknown
}

export interface CheckDeps {
  version: string
  fetchLatest: () => Promise<HttpAnswer>
  /** runs git in the clone and answers its trimmed stdout; absent outside a clone */
  git?: (args: string[]) => Promise<string>
  log: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void
}

export interface CheckResult {
  commit?: string
  /** absent: the check could not tell, so what was known before stays */
  update?: UpdateNotice | null
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** the notice of a newer release, null when there is none, undefined when GitHub did not answer */
async function releaseNotice(deps: CheckDeps): Promise<UpdateNotice | null | undefined> {
  try {
    const { status, body } = await deps.fetchLatest()
    // 404: the repository has no published release
    if (status === 404) return null
    if (status !== 200) throw new Error(`HTTP ${status}`)
    const { tag_name: tag, html_url: page } = (body ?? {}) as { tag_name?: unknown; html_url?: unknown }
    if (typeof tag !== 'string' || !parseVersion(tag) || !isNewer(tag, deps.version)) return null
    const url = typeof page === 'string' && page.startsWith(`https://github.com/${REPO}/`) ? page : RELEASES_PAGE
    return { kind: 'release', version: tag.replace(/^v/, ''), url }
  } catch (e) {
    deps.log('warn', 'não foi possível consultar a release no GitHub', { error: reason(e) })
    return undefined
  }
}

/** commits of origin/main missing from HEAD; fetches only when the remote commit is not here yet */
async function commitsBehind(git: NonNullable<CheckDeps['git']>, head: string): Promise<number> {
  // ls-remote writes nothing in the clone
  const remote = (await git(['ls-remote', 'origin', 'refs/heads/main'])).split(/\s/)[0]
  if (!/^[0-9a-f]{40,64}$/.test(remote)) throw new Error('origin não tem a branch main')
  if (remote === head) return 0
  const here = await git(['cat-file', '-e', `${remote}^{commit}`]).then(() => true, () => false)
  if (!here) await git(['fetch', '--quiet', '--no-tags', '--no-recurse-submodules', 'origin', 'main'])
  const count = Number(await git(['rev-list', '--count', `${head}..${remote}`]))
  if (!Number.isInteger(count)) throw new Error('contagem de commits ilegível')
  return count
}

export async function checkForUpdate(deps: CheckDeps): Promise<CheckResult> {
  const { git } = deps
  const head = git ? await git(['rev-parse', 'HEAD']).catch((e) => {
    deps.log('warn', 'git não leu o commit atual', { error: reason(e) })
    return ''
  }) : ''
  const commit = head ? { commit: head.slice(0, 7) } : {}
  const release = await releaseNotice(deps)
  if (release) return { ...commit, update: release }
  if (!git || !head) return release === null ? { update: null } : commit
  try {
    const behind = await commitsBehind(git, head)
    if (behind > 0) {
      const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
      const command = branch === 'main' ? 'git pull' : 'git pull origin main'
      return { ...commit, update: { kind: 'git', behind, command } }
    }
    return release === null ? { ...commit, update: null } : commit
  } catch (e) {
    deps.log('warn', 'git não comparou com origin/main', { error: reason(e) })
    return commit
  }
}
