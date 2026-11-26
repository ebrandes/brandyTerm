import type { SkillRow } from '../types'
import { countLine } from '../plugin-list'
import { Toggle } from './Toggle'
import { HOOKS_TIP } from './UserPluginsPanel'

function tip(r: SkillRow): string {
  return [
    r.description,
    r.sempre && 'Base: entra em todo projeto; desligar tira só deste.',
    r.on && !r.installed && (r.kind === 'plugin' ? 'Falta instalar.' : 'Falta baixar a biblioteca.'),
  ]
    .filter(Boolean)
    .join('\n')
}

/** One item of the project's skills panel. */
export function SkillRowView({ row, busy, onToggle }: { row: SkillRow; busy: boolean; onToggle: (on: boolean) => void }) {
  return (
    <div className="up-row" title={tip(row)}>
      <span className="up-text">
        <span className="up-name">
          {row.name}
          {row.hooks && <span className="up-tag warn" title={HOOKS_TIP}>hooks</span>}
        </span>
        <span className="up-sub">
          {countLine(row)}
          {row.on && !row.installed && <span className="up-missing-mark"> · falta instalar</span>}
        </span>
      </span>
      <Toggle on={row.on} disabled={busy} label={`Usar ${row.name} neste projeto`} onChange={onToggle} />
    </div>
  )
}
