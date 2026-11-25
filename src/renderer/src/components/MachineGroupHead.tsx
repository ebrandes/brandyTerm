import { FolderPlus } from 'lucide-react'
import { groupTitle, offlineLabel, type MachineGroup } from '../machine-groups'

interface Props {
  group: MachineGroup
  onOpen: (machineId?: string) => void
}

/** Sidebar group title: machine name, "offline desde HH:MM", and "Abrir pasta" on an online remote machine. */
export function MachineGroupHead({ group: g, onOpen }: Props) {
  return (
    <div className={`machine-head${g.online ? '' : ' offline'}`}>
      <span className="machine-head-name" title={groupTitle(g)}>{groupTitle(g)}</span>
      {!g.online && <span className="machine-state">{offlineLabel(g.since)}</span>}
      {!g.local && g.online && (
        <button className="icon-btn" onClick={() => onOpen(g.id)} aria-label={`Abrir pasta em ${g.name}`} title={`Abrir pasta em ${g.name}`}>
          <FolderPlus size={14} />
        </button>
      )}
    </div>
  )
}
