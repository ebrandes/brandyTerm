// What /skill-init and /skill-refresh tell the thread about a project: dependencies, file types,
// the start of the README and the skills it already has in .claude/skills. Never throws.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'

export interface Signals {
  deps: string[]
  /** top 10 extensions by file count */
  arquivos: Record<string, number>
  readme: string
  skillsLocais: string[]
}

/** build output, dependencies and the app's own staging area say nothing about the project */
const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', '.brandyterm'])
const README = /^readme(\.(md|markdown|txt|rst))?$/i
const MAX_DEPS = 300

const read = (file: string): string | null => {
  try { return readFileSync(file, 'utf8') } catch { return null }
}
const keys = (v: unknown): string[] => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v) : [])
const pyName = (spec: string): string | null => /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)/.exec(spec)?.[1] ?? null

function npm(root: string): string[] {
  const text = read(join(root, 'package.json'))
  if (!text) return []
  try {
    const j = JSON.parse(text)
    return [...keys(j?.dependencies), ...keys(j?.devDependencies)]
  } catch {
    return []
  }
}

function requirements(root: string): string[] {
  const out: string[] = []
  for (const raw of (read(join(root, 'requirements.txt')) ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim()
    const name = line && !line.startsWith('-') ? pyName(line) : null
    if (name) out.push(name)
  }
  return out
}

/** The lines of a TOML section, up to the next header. */
function section(text: string, name: string): string[] {
  const out: string[] = []
  let inside = false
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*\[/.test(line)) {
      inside = line.trim() === `[${name}]`
      continue
    }
    if (inside) out.push(line)
  }
  return out
}

/** Quoted strings of a TOML array that starts at `from` (just after its `[`), stopping at the `]` outside quotes. */
function quoted(text: string, from: number): string[] {
  const out: string[] = []
  for (let i = from; i < text.length; i++) {
    const c = text[i]
    if (c === ']') break
    if (c === '#') i = text.indexOf('\n', i) < 0 ? text.length : text.indexOf('\n', i)
    else if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1)
      if (end < 0) break
      out.push(text.slice(i + 1, end))
      i = end
    }
  }
  return out
}

function pyproject(root: string): string[] {
  const text = read(join(root, 'pyproject.toml'))
  if (!text) return []
  const body = section(text, 'project').join('\n')
  const m = /^\s*dependencies\s*=\s*\[/m.exec(body)
  return m ? quoted(body, m.index + m[0].length).map(pyName).filter((n): n is string => !!n) : []
}

function cargo(root: string): string[] {
  const text = read(join(root, 'Cargo.toml'))
  if (!text) return []
  const names = section(text, 'dependencies').map((l) => /^\s*([A-Za-z0-9_-]+)\s*=/.exec(l)?.[1])
  const tables = [...text.matchAll(/^\s*\[dependencies\.([A-Za-z0-9_-]+)\]/gm)].map((m) => m[1])
  return [...names, ...tables].filter((n): n is string => !!n)
}

function gomod(root: string): string[] {
  const out: string[] = []
  let block = false
  for (const raw of (read(join(root, 'go.mod')) ?? '').split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*/, '').trim()
    if (block) {
      if (line === ')') block = false
      else if (/^\S+\s+v/.test(line)) out.push(line.split(/\s+/)[0])
      continue
    }
    if (/^require\s*\($/.test(line)) block = true
    else {
      const one = /^require\s+(\S+)\s+v/.exec(line)
      if (one) out.push(one[1])
    }
  }
  return out
}

function fileTypes(root: string, limit: number): Record<string, number> {
  const counts = new Map<string, number>()
  const stack = [root]
  let seen = 0
  while (stack.length && seen < limit) {
    const dir = stack.pop()!
    let entries
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      // Dirent never follows links: a link to a big folder is not walked
      if (e.isDirectory()) {
        if (!SKIP.has(e.name)) stack.push(join(dir, e.name))
        continue
      }
      if (!e.isFile()) continue
      if (seen >= limit) break
      seen++
      const ext = extname(e.name).toLowerCase()
      if (ext) counts.set(ext, (counts.get(ext) ?? 0) + 1)
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 10)
  return Object.fromEntries(top)
}

function readme(root: string): string {
  let names: string[]
  try { names = readdirSync(root) } catch { return '' }
  const file = names.find((n) => /^readme\.md$/i.test(n)) ?? names.find((n) => README.test(n))
  return file ? (read(join(root, file)) ?? '').slice(0, 2000) : ''
}

function localSkills(root: string): string[] {
  const dir = join(root, '.claude', 'skills')
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  return names
    .filter((n) => {
      try { return statSync(join(dir, n)).isDirectory() && existsSync(join(dir, n, 'SKILL.md')) } catch { return false }
    })
    .sort()
}

/** `limit` caps how many files the extension count looks at. */
export function projectSignals(projectPath: string, limit = 5000): Signals {
  const deps = [...new Set([...npm(projectPath), ...requirements(projectPath), ...pyproject(projectPath), ...cargo(projectPath), ...gomod(projectPath)])]
  return {
    deps: deps.slice(0, MAX_DEPS),
    arquivos: fileTypes(projectPath, limit),
    readme: readme(projectPath),
    skillsLocais: localSkills(projectPath),
  }
}
