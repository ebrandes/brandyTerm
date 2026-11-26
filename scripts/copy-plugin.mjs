// Copies a plugin folder out of a throwaway clone. Some plugins link to code elsewhere in
// their repo (TokenEconomizer: plugin/lib -> ../../src), so those links become real copies:
// a link kept as a link would dangle once the clone is deleted.
import { copyFileSync, existsSync, mkdirSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

/** a real path the copy may read: inside the clone and outside its .git */
function allowed(repo, real) {
  const rel = relative(repo, real)
  return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel) && !rel.split(sep).includes('.git')
}

/** Copies `src` (inside `repoRoot`) to `target`. Returns the entries it refused, relative to `src`. */
export function copyPlugin(repoRoot, src, target) {
  const repo = realpathSync(repoRoot)
  const skipped = []
  const walk = (from, to, rel, open) => {
    mkdirSync(to, { recursive: true })
    for (const entry of readdirSync(from, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const path = join(from, entry.name)
      const name = rel ? `${rel}/${entry.name}` : entry.name
      let real, info
      try {
        real = realpathSync(path)
        info = statSync(real)
      } catch {
        skipped.push(name)
        continue
      }
      // `open` holds the folders being copied: pointing back at one of them would never end
      if (!allowed(repo, real) || open.has(real)) skipped.push(name)
      else if (info.isDirectory()) walk(real, join(to, entry.name), name, new Set([...open, real]))
      else if (info.isFile()) copyFileSync(real, join(to, entry.name))
    }
  }
  const start = realpathSync(src)
  if (!allowed(repo, start)) throw new Error('pasta do plugin fora do repositório')
  walk(start, target, '', new Set([start]))
  return skipped
}

/** Which of the files a plugin needs to work are not there (a dangling link counts as missing). */
export function missingFiles(dir, requires = []) {
  return requires.filter((file) => !existsSync(join(dir, file)))
}
