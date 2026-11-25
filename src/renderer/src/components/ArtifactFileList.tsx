import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import type { ThreadFile } from '../types'
import { diffStat, type DiffState } from '../useFileDiffs'
import { DiffStat } from './ArtifactDiff'

/** The thread's files beside the viewer; folds into a narrow strip. */
export function ArtifactFileList(props: {
  files: ThreadFile[]
  current: string
  diffs: Record<string, DiffState>
  open: boolean
  onToggle: () => void
  onPick: (path: string) => void
}) {
  const { files, current, diffs, open, onToggle, onPick } = props
  if (!open)
    return (
      <aside className="art-files folded">
        <button className="art-files-toggle" onClick={onToggle} title="Mostrar arquivos da thread" aria-label="Mostrar arquivos da thread">
          <PanelLeftOpen size={15} />
        </button>
      </aside>
    )
  return (
    <aside className="art-files" aria-label="Arquivos da thread">
      <div className="art-files-head">
        <span>Arquivos da thread · {files.length}</span>
        <button className="art-files-toggle" onClick={onToggle} title="Recolher lista" aria-label="Recolher lista">
          <PanelLeftClose size={15} />
        </button>
      </div>
      <ul>
        {files.map((f) => {
          const slash = f.path.lastIndexOf('/')
          const stat = diffStat(diffs[f.path])
          const on = f.path === current
          return (
            <li key={f.path}>
              <button className={on ? 'art-file on' : 'art-file'} onClick={() => !on && onPick(f.path)} title={f.path} aria-current={on || undefined}>
                <span className="art-file-row">
                  <span className="art-file-name">{f.path.slice(slash + 1)}</span>
                  {stat && <DiffStat {...stat} />}
                </span>
                {slash > 0 && <span className="art-file-dir">{f.path.slice(0, slash)}</span>}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
