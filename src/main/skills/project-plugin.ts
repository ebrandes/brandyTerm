import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve, win32 } from 'node:path'

export type LinkFn = (target: string, path: string, kind: 'dir' | 'junction') => void

const realLink: LinkFn = (target, path, kind) => symlinkSync(target, path, kind)

/** First 12 hex chars of sha1 of the resolved path; case-blind on win32. */
export function projectHash(projectPath: string, platform: NodeJS.Platform = process.platform): string {
  const abs = platform === 'win32' ? win32.resolve(projectPath).toLowerCase() : resolve(projectPath)
  return createHash('sha1').update(abs).digest('hex').slice(0, 12)
}

function linkTarget(path: string): string | null {
  try {
    return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : null
  } catch {
    return null
  }
}

/** Removes the entry itself; a link is unlinked, never followed. */
const drop = (path: string) => rmSync(path, { recursive: true, force: true })

/**
 * The generated plugin for one project: `<root>/<hash>/skills/<nome>` are links into the
 * library. Re-running converges: missing links are made, stale ones dropped. Returns
 * `null` (and removes the dir) when the project has no library skills.
 */
export function buildProjectPlugin(
  root: string,
  projectPath: string,
  skills: string[],
  libSkillsDir: string,
  platform: NodeJS.Platform,
  link: LinkFn = realLink
): string | null {
  const hash = projectHash(projectPath, platform)
  const dir = join(root, hash)
  if (!skills.length) {
    drop(dir)
    return null
  }
  const skillsDir = join(dir, 'skills')
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  mkdirSync(skillsDir, { recursive: true })
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: `projeto-${hash}`, version: '1.0.0', description: 'Skills da biblioteca para este projeto' }) + '\n'
  )
  const want = new Set(skills)
  for (const name of readdirSync(skillsDir)) if (!want.has(name)) drop(join(skillsDir, name))
  const kind = platform === 'win32' ? 'junction' : 'dir'
  for (const name of want) {
    const target = join(libSkillsDir, name)
    const path = join(skillsDir, name)
    const current = linkTarget(path)
    if (current !== null && resolve(skillsDir, current) === resolve(target) && existsSync(path)) continue
    drop(path)
    link(target, path, kind)
  }
  return dir
}
