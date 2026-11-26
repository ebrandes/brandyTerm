import { api } from '../api'
import { stopHint, stopQuestion } from '../../../shared/proc-stop-labels.ts'

interface Props {
  name: string
  pid: number | undefined
  ports: number[]
  /** the process runs on another computer: this platform's wording would be wrong */
  remote?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Takes the card's place while the user decides. */
export function StopConfirm({ name, pid, ports, remote, onCancel, onConfirm }: Props) {
  return (
    <div className="proc stop-confirm" role="group" aria-label={`Parar ${name}`} onKeyDown={(e) => e.key === 'Escape' && onCancel()}>
      <p>{stopQuestion(name, pid, ports)}</p>
      <p className="stop-hint">{stopHint(remote ? undefined : api.platform)}</p>
      <div className="stop-actions">
        <button onClick={onCancel} autoFocus>Cancelar</button>
        <button className="stop-go" onClick={onConfirm}>Parar</button>
      </div>
    </div>
  )
}
