// The skills library and the per-project lists (types shared by main and the renderer).

/** the library when the skillsLibrary setting is unset */
export const DEFAULT_LIBRARY = 'ebrandes/claude-kit'

/** An entry of the skills library catalog (`biblioteca/catalogo.json`). */
export interface CatalogItem {
  id: string
  tipo: 'plugin' | 'skill'
  descricao: string
  tags: string[]
  /** in every project unless the list puts it in `sem` */
  sempre?: boolean
  /** never copied, staged or scanned off-machine */
  corporativo?: boolean
  plataformas?: ('mac' | 'win')[]
  /** `dono/repo` for `claude plugin marketplace add` when the store isn't known yet */
  loja?: string
}

/** A project's skills list (`<projeto>/.brandyterm/skills.json`). */
export interface SkillsList {
  versao: 1
  plugins: { id: string; ref?: string }[]
  skills: string[]
  sem: string[]
}

/** One row of a project's skills panel. */
export interface SkillRow {
  id: string
  name: string
  kind: 'plugin' | 'skill'
  /** the plugin ships hooks: they run on every thread */
  hooks: boolean
  skills: number
  commands: number
  agents: number
  description?: string
  on: boolean
  /** plugin installed, or library skill present in the clone */
  installed: boolean
  sempre: boolean
}

/** The skills panel of one project. */
export interface ProjectSkillsView {
  /** `.brandyterm/skills.json` exists and reads */
  hasList: boolean
  /** the list exists but doesn't read: threads use the set from before the list */
  erro?: string
  rows: SkillRow[]
  /** ids that are on but not installed */
  missing: string[]
  /** library absent or unreadable */
  aviso?: string
}
