import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { PluginInfo } from '../shared/types.ts'

interface Wanted {
  id: string
  name: string
  /** directory name of the plugin inside each marketplace cache folder */
  dirName: string
  missing: string
}

/** Plugins every Claude thread loads by default, in any project. */
const DEFAULTS: Wanted[] = [
  {
    id: 'superpowers',
    name: 'Superpowers',
    dirName: 'superpowers',
    missing: 'instale com: claude plugin marketplace add obra/superpowers-marketplace'
  },
  {
    id: 'tokeneconomizer',
    name: 'TokenEconomizer',
    dirName: 'tokeneconomizer',
    missing:
      'instale com: git clone https://github.com/microsoft/TokenEconomizer.git && claude plugin marketplace add ./TokenEconomizer && claude plugin install tokeneconomizer@tokeneconomizer'
  }
]

function cmpVersion(a: string, b: string): number {
  const pa = a.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.\-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d) return d
  }
  return 0
}

function dirs(p: string): string[] {
  try {
    return readdirSync(p, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)
  } catch {
    return []
  }
}

/** Finds the newest installed version of each default plugin in Claude's plugin cache. */
export function discoverPlugins(): PluginInfo[] {
  const cache = join(homedir(), '.claude', 'plugins', 'cache')
  return DEFAULTS.map((w) => {
    let best: { dir: string; version: string } | null = null
    for (const market of dirs(cache)) {
      for (const version of dirs(join(cache, market, w.dirName))) {
        const dir = join(cache, market, w.dirName, version)
        if (!existsSync(join(dir, '.claude-plugin', 'plugin.json'))) continue
        if (!best || cmpVersion(version, best.version) > 0) best = { dir, version }
      }
    }
    return {
      id: w.id,
      name: w.name,
      dir: best?.dir,
      version: best?.version,
      note: best ? 'carregado em todas as threads do Claude' : w.missing
    }
  })
}
