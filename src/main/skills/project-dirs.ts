import { existsSync, readdirSync } from 'node:fs'
import { catalogPath, readCatalog } from './catalog.ts'
import { libSkillsDir, type SkillsPaths } from './paths.ts'
import { buildProjectPlugin } from './project-plugin.ts'
import { readList } from './project-list.ts'
import { resolveProject, type Resolved } from './resolve.ts'

function dirNames(dir: string): Set<string> {
  try {
    return new Set(readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() || e.isSymbolicLink()).map((e) => e.name))
  } catch {
    return new Set()
  }
}

/** What a project's list resolves to, or `null` when the project has no usable list. */
export function resolveFor(projectPath: string, paths: SkillsPaths, installed: Map<string, string>, platform: NodeJS.Platform): Resolved | null {
  const { list } = readList(projectPath)
  if (!list) return null
  return resolveProject({ list, itens: readCatalog(paths.lib).itens, installed, libSkills: dirNames(libSkillsDir(paths)), platform })
}

/** False when the library has no clone, no catalog or a broken one: the base items are unknown. */
export function catalogReadable(libRoot: string): boolean {
  return existsSync(catalogPath(libRoot)) && !readCatalog(libRoot).erro
}

/**
 * Plugin dirs for a thread of a project with a skills list: its plugins plus the generated
 * project plugin. `null` means "no list (or a broken one): use the old behaviour". Without a
 * readable catalog the base can't be told apart, so `old` (the set from before the list) comes too.
 */
export function projectDirs(projectPath: string, paths: SkillsPaths, installed: Map<string, string>, platform: NodeJS.Platform, old: string[] = []): string[] | null {
  const r = resolveFor(projectPath, paths, installed, platform)
  if (!r) return null
  const own = buildProjectPlugin(paths.projectSkills, projectPath, r.skills, libSkillsDir(paths), platform)
  const dirs = own ? [...r.pluginDirs, own] : r.pluginDirs
  return catalogReadable(paths.lib) ? dirs : [...dirs, ...old.filter((d) => !dirs.includes(d))]
}
