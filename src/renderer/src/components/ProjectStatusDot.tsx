import type { Project } from '../types'
import { projectStatus } from '../../../shared/project-status.ts'
import './project-status.css'

interface Props {
  project: Project
  lastSeen?: string
  selected: boolean
}

/**
 * Sidebar indicators. Activity (spinner, not a dot) = something is running, all fine.
 * Dots are warnings only: amber = aguardando você, accent = novidades. Nothing = seen and idle.
 */
export function ProjectStatusDot({ project, lastSeen, selected }: Props) {
  const s = projectStatus(project, { lastSeen, selected })
  if (!s.running && !s.waiting && !s.news) return null
  return (
    <span className="pstatus-group" role="img" aria-label={s.label} title={s.label}>
      {s.running && (
        <span className="pstatus-spinner" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle className="pstatus-track" cx="8" cy="8" r="6" />
            <path className="pstatus-arc" d="M8 2a6 6 0 0 1 6 6" />
            <g className="pstatus-static"><path d="M8 4.5V8l2.4 1.6" /></g>
          </svg>
        </span>
      )}
      {s.waiting && <span className="pstatus pstatus-waiting" aria-hidden="true" />}
      {!s.waiting && s.news && <span className="pstatus pstatus-news" aria-hidden="true" />}
    </span>
  )
}
