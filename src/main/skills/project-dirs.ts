import { readdirSync } from 'node:fs'
import { readCatalog } from './catalog.ts'
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

/**
 * Plugin dirs for a thread of a project with a skills list: its plugins plus the generated
 * project plugin. `null` means "no list (or a broken one): use the old behaviour".
 */
export function projectDirs(projectPath: string, paths: SkillsPaths, installed: Map<string, string>, platform: NodeJS.Platform): string[] | null {
  const r = resolveFor(projectPath, paths, installed, platform)
  if (!r) return null
  const own = buildProjectPlugin(paths.projectSkills, projectPath, r.skills, libSkillsDir(paths), platform)
  return own ? [...r.pluginDirs, own] : r.pluginDirs
}
