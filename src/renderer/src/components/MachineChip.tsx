import { Apple, Monitor, Terminal } from 'lucide-react'
import type { MachineOs } from '../../../shared/remote/machine.ts'
import type { Project } from '../types'
import './machine.css'

export function OsIcon({ os, size = 12 }: { os: MachineOs; size?: number }) {
  if (os === 'mac') return <Apple size={size} />
  if (os === 'windows') return <Monitor size={size} />
  return <Terminal size={size} />
}

/** Which machine a conversation runs on: OS icon + name; accent-colored when it is another machine. */
export function MachineChip({ machine }: { machine?: Project['machine'] }) {
  if (!machine) return null
  return (
    <span className={`machine-chip${machine.remote ? ' remote' : ''}`} title={`Esta conversa roda em ${machine.name}`}>
      <OsIcon os={machine.os} />
      {machine.name}
    </span>
  )
}
