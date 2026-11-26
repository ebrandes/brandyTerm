import { join } from 'node:path'

export interface SkillsPaths {
  userData: string
  /** clone of the library repo; the catalog lives at `<lib>/biblioteca/catalogo.json` */
  lib: string
  /** generated per-project plugins, `<projectSkills>/<hash>/` */
  projectSkills: string
}

export const skillsPaths = (userData: string): SkillsPaths => ({
  userData,
  lib: join(userData, 'biblioteca'),
  projectSkills: join(userData, 'project-skills'),
})

/** Folder of the library's loose skills. */
export const libSkillsDir = (p: SkillsPaths) => join(p.lib, 'biblioteca', 'skills')
