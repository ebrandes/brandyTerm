import { useState } from 'react'
import { ChevronDown, ShieldCheck } from 'lucide-react'
import type { Project } from '../types'
import { ProcessPanel } from './ProcessPanel'
import { OverviewFooter, type FooterProps } from './OverviewFooter'
import { dockSummary } from '../dock-summary'
import { useDetectedProcs } from '../useDetectedProcs'
import { readOpen, writeOpen } from '../side-state'
import { coordinatorLimit, coordinatorWarn } from '../../../shared/context-limit.ts'
import './overview-dock.css'

const store = () => (typeof localStorage === 'undefined' ? undefined : localStorage)
/** remembered as `brandy.side.overview-dock`, for the whole app */
const STORE_ID = 'overview-dock'

type Props = Omit<FooterProps, 'context' | 'hidden'> & { project: Project }

/** PROCESSOS plus the footer, minimizable to a single summary line. Open by default. */
export function OverviewDock({ project, ...footer }: Props) {
  const [open, setOpen] = useState(() => readOpen(store(), STORE_ID, true))
  const toggle = () => {
    setOpen(!open)
    writeOpen(store(), STORE_ID, !open)
  }
  const saved = project.coordinator.context
  // old saves carry the model's 1M window: the coordinator is held to its own ceiling
  const context = saved && saved.used > 0 ? { used: saved.used, limit: coordinatorLimit(saved.limit) } : undefined
  const { list: detected, refresh } = useDetectedProcs(project.id)
  const summary = dockSummary(project.processes, context, footer.allowAllThreads, detected)

  // one button for both states, so keyboard focus stays on it after toggling
  const button = (
    <button
      className="dock-toggle"
      onClick={toggle}
      aria-expanded={open}
      aria-controls="dock-procs dock-footer"
      title={open ? 'Minimizar processos e ajustes' : 'Expandir processos e ajustes'}
    >
      <span className="dock-title">Processos</span>
      {!open && (
        <span className="dock-summary">
          <span>{summary.count}</span>
          {summary.exited > 0 && <span>({summary.exited} {summary.exited === 1 ? 'parado' : 'parados'})</span>}
          {summary.ports.length > 0 && <span className="dock-ports">{summary.ports.map((p) => `:${p}`).join(' ')}</span>}
          {context && summary.context && (
            <span className={coordinatorWarn(context.used, context.limit) ? 'dock-ctx warn' : 'dock-ctx'}>ctx {summary.context}</span>
          )}
          {summary.allowAll && (
            <span className="dock-allow">
              <ShieldCheck size={11} aria-hidden /> permitindo tudo
            </span>
          )}
        </span>
      )}
      <ChevronDown size={14} className={`dock-chev${open ? '' : ' closed'}`} aria-hidden />
    </button>
  )

  return (
    <>
      <ProcessPanel project={project} detected={detected} refresh={refresh} open={open} toggle={button} />
      <OverviewFooter project={project} context={context} hidden={!open} {...footer} />
    </>
  )
}
