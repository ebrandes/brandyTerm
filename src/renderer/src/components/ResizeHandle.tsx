import type { ResizeHandleProps } from '../useResizablePanel'
import './resize.css'

interface Props {
  handle: ResizeHandleProps
  dragging: boolean
  label: string
  controls?: string
}

/** Vertical splitter between two columns: drag, double-click to reset, arrows when focused. */
export function ResizeHandle({ handle, dragging, label, controls }: Props) {
  return (
    <div
      {...handle}
      className={`resize-handle${dragging ? ' dragging' : ''}`}
      aria-label={label}
      aria-controls={controls}
      title={`${label} · duplo clique volta ao padrão`}
    />
  )
}
