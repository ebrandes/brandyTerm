import { cpSync, existsSync, lstatSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { inside } from '../paths.ts'

/** Where a library skill came from; written as its `origem.json` (no path in it). */
export interface SkillMeta {
  repo: string
  commit: string
  licenca: string | null
  estrelas: number | null
}

/** also safe as a path segment and as a CLI argument: no leading `.` or `-` */
const SKILL_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/

export const validSkillName = (nome: string) => SKILL_NAME.test(nome)

/** The skill folder inside a staging: `<staging>/skills/<nome>`, or the staging itself when it is that skill. */
export function skillSource(staging: string, nome: string): string | null {
  const nested = join(staging, 'skills', nome)
  if (existsSync(join(nested, 'SKILL.md'))) return nested
  if (basename(staging) === nome && existsSync(join(staging, 'SKILL.md'))) return staging
  return null
}

/**
 * Copies one staged skill to `<libSkillsDir>/<nome>`, replacing an older copy, and writes its
 * `origem.json`. `.git` and symlinks stay out: a link could point anywhere on this machine.
 */
export function copySkill(staging: string, nome: string, libSkillsDir: string, meta: SkillMeta): void {
  if (!validSkillName(nome)) throw new Error(`Nome de skill inválido: ${nome}`)
  const src = skillSource(staging, nome)
  if (!src) throw new Error(`Skill ${nome} não encontrada na pasta analisada.`)
  // a link in the cloned repo (the skill, or skills/ itself) could reach any folder on this machine
  const real = realpathSync(src)
  const root = realpathSync(staging)
  if (real !== root && !inside(root, real)) throw new Error(`Skill ${nome} aponta para fora da pasta analisada.`)
  const dest = join(libSkillsDir, nome)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(libSkillsDir, { recursive: true })
  cpSync(src, dest, {
    recursive: true,
    filter: (s) => !relative(src, s).split(/[\\/]/).includes('.git') && !lstatSync(s).isSymbolicLink(),
  })
  const origem = { repo: meta.repo, commit: meta.commit, licenca: meta.licenca, estrelas: meta.estrelas, importado: new Date().toISOString() }
  writeFileSync(join(dest, 'origem.json'), JSON.stringify(origem, null, 2) + '\n')
}
