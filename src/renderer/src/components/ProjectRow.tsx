import { useCallback, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { Archive, Copy, Eraser, Folder, FolderOpen, Pencil, Trash2, X } from 'lucide-react'
import type { Project } from '../types'
import { ProjectStatusDot } from './ProjectStatusDot'
import { ProjectContextMenu, type MenuItem } from './ProjectContextMenu'
import { busyReason } from '../../../shared/project-busy.ts'
import { copyablePath, folderOs, revealLabel } from '../../../shared/project-menu-labels.ts'
import { errorText, report, showNotice } from '../notice'
import { api } from '../api'

export type ProjectAsk = 'remove' | 'clear'

interface Props {
  project: Project
  active: boolean
  lastSeen?: string
  onSelect: (id: string) => void
  /** opens a confirmation (App owns the dialogs) */
  onAsk: (kind: ProjectAsk, id: string) => void
}

const failed = (r: { ok: boolean; error?: string } | undefined) => {
  if (r && !r.ok) showNotice(r.error ?? 'Não deu para concluir a ação.')
}

/** a project in the sidebar: click opens it; right-click, Shift+F10 or the menu key opens its actions; F2 renames */
export function ProjectRow({ project: p, active, lastSeen, onSelect, onAsk }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [invalid, setInvalid] = useState(false)
  const main = useRef<HTMLButtonElement>(null)

  const openAt = (x: number, y: number) => setMenu({ x, y })
  const openBelow = () => {
    const r = main.current?.getBoundingClientRect()
    if (r) openAt(r.left + 24, r.bottom + 2)
  }
  const closeMenu = useCallback((refocus: boolean) => {
    setMenu(null)
    if (refocus) main.current?.focus()
  }, [])

  const startRename = () => {
    setDraft(p.name)
    setInvalid(false)
    setEditing(true)
  }
  const stopRename = () => {
    setEditing(false)
    requestAnimationFrame(() => main.current?.focus())
  }
  const saveRename = () => {
    const name = draft.trim()
    if (!name) return setInvalid(true)
    stopRename()
    if (name !== p.name) void api.renameProject({ projectId: p.id, name }).then(failed, report)
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    // the menu key arrives as a contextmenu event at 0,0: open under the row instead
    if (e.clientX === 0 && e.clientY === 0) openBelow()
    else openAt(e.clientX, e.clientY)
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
      e.preventDefault()
      openBelow()
    } else if (e.key === 'F2') {
      e.preventDefault()
      startRename()
    }
  }

  const busy = busyReason(p)
  const remote = !!p.machine?.remote
  const noPath = !p.path ? 'Este projeto não tem pasta.' : null
  const items: MenuItem[] = [
    { id: 'rename', label: 'Renomear', icon: <Pencil size={14} />, run: startRename },
    {
      id: 'archive', label: 'Arquivar', icon: <Archive size={14} />,
      run: () => void api.setProjectArchived({ projectId: p.id, archived: true }).then(failed, report)
    },
    {
      id: 'clear', label: 'Limpar contexto do coordenador', icon: <Eraser size={14} />, separated: true,
      disabled: p.demo ? 'Projeto de demonstração.' : busy, run: () => onAsk('clear', p.id)
    },
    {
      id: 'reveal', label: revealLabel(api.platform), icon: <FolderOpen size={14} />,
      disabled: noPath ?? (remote ? `A pasta está em ${p.machine?.name ?? 'outra máquina'}.` : null),
      run: () => void api.revealProject({ projectId: p.id }).then(failed, report)
    },
    {
      id: 'copy', label: 'Copiar caminho', icon: <Copy size={14} />, disabled: noPath,
      run: () => void api.term.writeClipboard(copyablePath(p.path ?? '', folderOs(p.machine, api.platform)))
        .then(() => showNotice('Caminho copiado.', 'ok'), (e) => showNotice(errorText(e)))
    },
    {
      id: 'remove', label: 'Remover do BrandyTerm', icon: <Trash2 size={14} />, danger: true, separated: true,
      disabled: busy, run: () => onAsk('remove', p.id)
    }
  ]

  return (
    <div className={`project-item${active ? ' active' : ''}${menu ? ' menu-open' : ''}`} onContextMenu={editing ? undefined : onContextMenu}>
      {editing ? (
        <div className="project-main project-rename">
          <Folder size={15} />
          <input
            className={invalid ? 'invalid' : undefined}
            value={draft}
            autoFocus
            maxLength={80}
            aria-label={`Novo nome de ${p.name}`}
            aria-invalid={invalid || undefined}
            title={invalid ? 'O nome não pode ficar vazio.' : 'Enter salva, Esc cancela'}
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => {
              setDraft(e.target.value)
              setInvalid(false)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') saveRename()
              else if (e.key === 'Escape') stopRename()
            }}
            onBlur={() => setEditing(false)}
          />
        </div>
      ) : (
        <button
          ref={main}
          className="project-main"
          onClick={() => onSelect(p.id)}
          onKeyDown={onKeyDown}
          aria-haspopup="menu"
          aria-expanded={!!menu}
          title={p.path ?? 'Projeto de demonstração'}
        >
          <Folder size={15} />
          <span className="project-name">{p.name}</span>
          {p.demo && <span className="tag">demo</span>}
          <ProjectStatusDot project={p} lastSeen={lastSeen} selected={active} />
        </button>
      )}
      {!editing && (
        <button
          className="project-x"
          aria-label={`Remover ${p.name}`}
          title={busy ?? 'Remover do BrandyTerm'}
          disabled={!!busy}
          onClick={() => onAsk('remove', p.id)}
        >
          <X size={13} />
        </button>
      )}
      {menu && (
        <ProjectContextMenu x={menu.x} y={menu.y} label={`Ações de ${p.name}`} items={items} note={busy} onClose={closeMenu} />
      )}
    </div>
  )
}
