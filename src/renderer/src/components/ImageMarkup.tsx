import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, Check, Hash, Pencil, Square, Trash2, Undo2, X } from 'lucide-react'
import type { Mark, PendingFile, Tool } from '../attach'
import './markup.css'

const COLORS = ['#ff4d4f', '#ffc53d', '#52c41a', '#40a9ff', '#ffffff']
const TOOLS: { id: Tool; label: string; icon: ReactNode }[] = [
  { id: 'pen', label: 'Caneta', icon: <Pencil size={14} /> },
  { id: 'rect', label: 'Caixa', icon: <Square size={14} /> },
  { id: 'arrow', label: 'Seta', icon: <ArrowUpRight size={14} /> },
  { id: 'pin', label: 'Número', icon: <Hash size={14} /> }
]

function draw(ctx: CanvasRenderingContext2D, img: ImageBitmap, marks: Mark[]): void {
  const w = Math.max(3, Math.round(Math.max(img.width, img.height) / 320))
  ctx.clearRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const m of marks) {
    ctx.strokeStyle = m.color
    ctx.fillStyle = m.color
    ctx.lineWidth = w
    if (m.tool === 'pen') {
      ctx.beginPath()
      m.points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)))
      ctx.stroke()
    } else if (m.tool === 'rect') {
      ctx.strokeRect(m.a[0], m.a[1], m.b[0] - m.a[0], m.b[1] - m.a[1])
    } else if (m.tool === 'arrow') {
      const [[x1, y1], [x2, y2]] = [m.a, m.b]
      const ang = Math.atan2(y2 - y1, x2 - x1)
      const head = w * 5
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x2, y2)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - head * Math.cos(ang - 0.45), y2 - head * Math.sin(ang - 0.45))
      ctx.lineTo(x2 - head * Math.cos(ang + 0.45), y2 - head * Math.sin(ang + 0.45))
      ctx.closePath()
      ctx.fill()
    } else if (m.tool === 'pin') {
      const r = w * 4.5
      ctx.beginPath()
      ctx.arc(m.at[0], m.at[1], r, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = m.color === '#ffffff' || m.color === '#ffc53d' ? '#111' : '#fff'
      ctx.font = `bold ${Math.round(r * 1.15)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(m.n), m.at[0], m.at[1] + 1)
    }
  }
}

interface Props {
  item: PendingFile
  onDone: (blob: Blob, marks: Mark[], original: Blob) => void
  onCancel: () => void
}

/** Draw on an image before sending it: pen, boxes, arrows and numbered pins, so the agent sees what you mean. */
export function ImageMarkup({ item, onDone, onCancel }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [img, setImg] = useState<ImageBitmap | null>(null)
  const [marks, setMarks] = useState<Mark[]>(item.marks ?? [])
  const [tool, setTool] = useState<Tool>('rect')
  const [color, setColor] = useState(COLORS[0])
  const live = useRef<Mark | null>(null)
  const original = item.original ?? item.blob

  useEffect(() => {
    let bmp: ImageBitmap | null = null
    void createImageBitmap(original).then((b) => {
      bmp = b
      setImg(b)
    })
    return () => bmp?.close()
  }, [original])

  const redraw = (extra?: Mark | null) => {
    const c = canvas.current
    if (c && img) draw(c.getContext('2d')!, img, extra ? [...marks, extra] : marks)
  }
  useEffect(() => redraw(), [img, marks])

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') setMarks((m) => m.slice(0, -1))
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [onCancel])

  const at = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * canvas.current!.width, ((e.clientY - r.top) / r.height) * canvas.current!.height]
  }

  const down = (e: React.PointerEvent) => {
    const p = at(e)
    if (tool === 'pin') return setMarks((m) => [...m, { tool: 'pin', color, at: p, n: m.filter((x) => x.tool === 'pin').length + 1 }])
    ;(e.target as Element).setPointerCapture(e.pointerId)
    live.current = tool === 'pen' ? { tool, color, points: [p] } : { tool, color, a: p, b: p }
  }
  const move = (e: React.PointerEvent) => {
    const m = live.current
    if (!m) return
    if (m.tool === 'pen') m.points.push(at(e))
    else if (m.tool === 'rect' || m.tool === 'arrow') m.b = at(e)
    redraw(m)
  }
  const up = () => {
    const m = live.current
    live.current = null
    if (m) setMarks((all) => [...all, m])
  }

  const done = () => {
    const c = canvas.current
    if (!c) return
    if (!marks.length) return onDone(original, [], original)
    c.toBlob((b) => b && onDone(b, marks, original), 'image/png')
  }

  return (
    <div className="markup-backdrop" role="dialog" aria-modal="true" aria-label="Marcar imagem">
      <div className="markup">
        <header className="markup-bar">
          <div className="markup-tools" role="toolbar" aria-label="Ferramentas">
            {TOOLS.map((t) => (
              <button key={t.id} className={tool === t.id ? 'on' : ''} onClick={() => setTool(t.id)} title={t.label} aria-pressed={tool === t.id}>
                {t.icon} {t.label}
              </button>
            ))}
          </div>
          <div className="markup-colors" role="radiogroup" aria-label="Cor">
            {COLORS.map((c) => (
              <button
                key={c}
                role="radio"
                aria-checked={color === c}
                aria-label={`Cor ${c}`}
                className={color === c ? 'on' : ''}
                style={{ background: c }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
          <div className="markup-actions">
            <button onClick={() => setMarks((m) => m.slice(0, -1))} disabled={!marks.length} title="Desfazer (⌘Z)">
              <Undo2 size={14} />
            </button>
            <button onClick={() => setMarks([])} disabled={!marks.length} title="Limpar marcações">
              <Trash2 size={14} />
            </button>
            <button onClick={onCancel} title="Cancelar (Esc)">
              <X size={14} /> Cancelar
            </button>
            <button className="primary" onClick={done}>
              <Check size={14} /> Concluir
            </button>
          </div>
        </header>
        <div className="markup-stage">
          {img && (
            <canvas
              ref={canvas}
              width={img.width}
              height={img.height}
              className={`tool-${tool}`}
              onPointerDown={down}
              onPointerMove={move}
              onPointerUp={up}
              onPointerCancel={up}
            />
          )}
        </div>
        <p className="markup-hint">Marque o que importa: o agente recebe a imagem com as marcações e o aviso de que foram feitas por você.</p>
      </div>
    </div>
  )
}
