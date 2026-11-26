import { createPortal } from 'react-dom'
import { FileText, PlugZap, Settings2, Trash2 } from 'lucide-react'
import { ProjectContextMenu, type MenuItem } from '../components/ProjectContextMenu'

interface MenuProps {
  name: string
  at: { x: number; y: number }
  testing: boolean
  /** the connector's error, shown under the items */
  error?: string | null
  onConfigure: () => void
  onTest: () => void
  onLogs: () => void
  onRemove: () => void
  onClose: (refocus: boolean) => void
}

/** A connector's actions (right-click, "⋯", Shift+F10 or the menu key): the project menu's look and keys. */
export function ConnectorMenu({ name, at, testing, error, onConfigure, onTest, onLogs, onRemove, onClose }: MenuProps) {
  const items: MenuItem[] = [
    { id: 'configure', label: 'Configurar', icon: <Settings2 size={14} />, run: onConfigure },
    {
      id: 'test', label: testing ? 'Testando…' : 'Testar', icon: <PlugZap size={14} />,
      disabled: testing ? 'Um teste já está em andamento.' : null, run: onTest
    },
    { id: 'logs', label: 'Ver logs', icon: <FileText size={14} />, run: onLogs },
    { id: 'remove', label: 'Remover…', icon: <Trash2 size={14} />, danger: true, separated: true, run: onRemove }
  ]
  return <ProjectContextMenu x={at.x} y={at.y} label={`Ações de ${name}`} items={items} note={error} onClose={onClose} />
}

export function ConfirmRemove({ name, onCancel, onConfirm }: { name: string; onCancel: () => void; onConfirm: () => void }) {
  // portal: the sidebar's section styles must not leak into the dialog
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Remover conector"
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}>
      <div className="modal">
        <h3>Remover “{name}”?</h3>
        <p>As chaves e o login guardados deste conector serão apagados. Para usar de novo, será preciso adicioná-lo outra vez.</p>
        <div className="modal-actions">
          <button onClick={onCancel} autoFocus>Cancelar</button>
          <button className="danger" onClick={onConfirm}>Remover</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
