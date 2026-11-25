import { useState } from 'react'
import { Clapperboard, FileCode, FileText, Globe, Image, Workflow, type LucideIcon } from 'lucide-react'
import type { ThreadFile } from '../types'
import { showArtifact } from '../artifacts'
import { api } from '../api'

const ICONS: [RegExp, LucideIcon][] = [
  [/\.(md|markdown)$/i, FileText],
  [/\.(mmd|mermaid)$/i, Workflow],
  [/\.html?$/i, Globe],
  [/\.(svg|png|jpe?g|gif|webp|avif)$/i, Image],
  [/\.(mp4|m4v|mov|webm)$/i, Clapperboard]
]

const iconOf = (path: string) => ICONS.find(([re]) => re.test(path))?.[1] ?? FileCode

/** Cards for the files a thread created or edited; a click opens the artifact viewer. */
export function ArtifactCards({ projectId, files }: { projectId: string; files: ThreadFile[] }) {
  const [gone, setGone] = useState<Set<string>>(() => new Set())
  if (!files.length) return null
  // keyed by path + write time: a file written again after being deleted opens again
  const key = (f: ThreadFile) => `${f.path}@${f.at}`
  const open = async (f: ThreadFile) => {
    const path = f.path
    const c = await api.readArtifact({ projectId, path }).catch(() => ({ kind: 'missing' }) as const)
    if (c.kind === 'missing') setGone((g) => new Set(g).add(key(f)))
    else showArtifact({ projectId, path })
  }
  return (
    <div className="art-cards" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      {[...files].reverse().map((f) => {
        const Icon = iconOf(f.path)
        const missing = gone.has(key(f))
        const name = f.path.split('/').pop()
        return (
          <button key={f.path} className="art-card" disabled={missing} onClick={() => void open(f)} title={missing ? 'O arquivo não existe mais.' : `${f.path} — abrir`}>
            <Icon size={16} />
            <span className="art-card-text">
              <span className="art-card-name">{name}</span>
              {name !== f.path && <span className="art-card-path">{f.path}</span>}
            </span>
            <span className="art-card-tag">{missing ? 'apagado' : f.op === 'write' ? 'criado' : 'editado'}</span>
          </button>
        )
      })}
    </div>
  )
}
