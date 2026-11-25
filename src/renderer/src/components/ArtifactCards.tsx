import { useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import type { ThreadFile } from '../types'
import { showArtifact } from '../artifacts'
import { api } from '../api'
import { fileName, fitCount, summaryFiles } from '../file-chips'
import { iconOf } from './file-icon'
import { FileChipsMenu, type FileState } from './FileChipsMenu'
import './file-chips.css'

const GAP = 4
const stop = (e: SyntheticEvent) => e.stopPropagation()

function ChipBody({ f, state }: { f: ThreadFile; state: FileState }) {
  const Icon = iconOf(f.path)
  return (
    <>
      <Icon size={13} />
      <span className="fchip-name">{fileName(f.path)}</span>
      <span className={`fstate ${state}`} aria-hidden />
    </>
  )
}

/**
 * One row of small chips for the files a thread created or edited (build output left out): as many as fit,
 * then '+N…' with the full list. A click on a chip or a list item opens the artifact viewer.
 */
export function ArtifactCards({ projectId, files }: { projectId: string; files: ThreadFile[] }) {
  const [gone, setGone] = useState<Set<string>>(() => new Set())
  const list = useMemo(() => summaryFiles(files), [files])
  const [fit, setFit] = useState(() => Math.min(list.length, 4))
  const rowRef = useRef<HTMLDivElement>(null)
  const measureRef = useRef<HTMLDivElement>(null)
  const signature = list.map((f) => f.path).join('\n')

  // measures hidden copies of every chip, so the visible row never has to render what does not fit
  useLayoutEffect(() => {
    const row = rowRef.current
    const measure = measureRef.current
    if (!row || !measure) return
    const kids = [...measure.children] as HTMLElement[]
    const update = () => {
      const widths = kids.slice(0, -1).map((k) => k.offsetWidth)
      setFit(fitCount(widths, row.clientWidth, kids[kids.length - 1]?.offsetWidth ?? 0, GAP))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(row)
    kids.forEach((k) => ro.observe(k))
    return () => ro.disconnect()
  }, [signature])

  if (!list.length) return null
  // keyed by path + write time: a file written again after being deleted opens again
  const key = (f: ThreadFile) => `${f.path}@${f.at}`
  const stateOf = (f: ThreadFile): FileState => (gone.has(key(f)) ? 'apagado' : f.op === 'write' ? 'criado' : 'editado')
  const open = async (f: ThreadFile) => {
    const path = f.path
    const c = await api.readArtifact({ projectId, path }).catch(() => ({ kind: 'missing' }) as const)
    if (c.kind === 'missing') setGone((g) => new Set(g).add(key(f)))
    else showArtifact({ projectId, path })
  }
  const shown = list.slice(0, Math.max(1, fit))
  const hidden = list.length - shown.length

  return (
    <div className="fchips" onClick={stop} onKeyDown={stop}>
      <div className="fchips-row" ref={rowRef}>
        {shown.map((f) => {
          const state = stateOf(f)
          return (
            <button
              key={f.path}
              type="button"
              className="fchip"
              disabled={state === 'apagado'}
              aria-label={`${fileName(f.path)}, ${state}`}
              title={state === 'apagado' ? 'O arquivo não existe mais.' : `${f.path} · ${state} — abrir`}
              onClick={() => void open(f)}
            >
              <ChipBody f={f} state={state} />
            </button>
          )
        })}
        {hidden > 0 && <FileChipsMenu files={list} hidden={hidden} stateOf={stateOf} onOpen={(f) => void open(f)} />}
      </div>
      <div className="fchips-measure" ref={measureRef} aria-hidden>
        {list.map((f) => (
          <span key={f.path} className="fchip">
            <ChipBody f={f} state={stateOf(f)} />
          </span>
        ))}
        <span className="fchips-more">+{list.length}…</span>
      </div>
    </div>
  )
}
