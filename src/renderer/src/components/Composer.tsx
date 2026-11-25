import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, FileText, ImagePlus, Loader2, Paperclip, PenLine, X } from 'lucide-react'
import type { SlashCommand } from '../types'
import { filesOf, formatSize, type PendingFile } from '../attach'
import { ImageMarkup } from './ImageMarkup'
import { SlashMenu, matchCommands } from './SlashMenu'
import { MentionMenu } from './MentionMenu'
import { useMention } from '../mention'
import { api } from '../api'
import './attach.css'

interface Props {
  projectId: string
  target: string
  draft: string
  onDraft: (text: string) => void
  files: PendingFile[]
  onAddFiles: (files: File[]) => void
  onRemoveFile: (key: string) => void
  onMarked: (key: string, blob: Blob, marks: NonNullable<PendingFile['marks']>, original: Blob) => void
  sending: boolean
  error?: string
  onSend: () => void
}

/** Message box: Enter sends, Shift+Enter breaks the line, paste/drop files, "/" opens the command menu, "@" the file menu. */
export function Composer({ projectId, target, draft, onDraft, files, onAddFiles, onRemoveFile, onMarked, sending, error, onSend }: Props) {
  const box = useRef<HTMLTextAreaElement>(null)
  const anyFile = useRef<HTMLInputElement>(null)
  const imageFile = useRef<HTMLInputElement>(null)
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [pick, setPick] = useState(0)
  const [menuOff, setMenuOff] = useState(false)
  const [marking, setMarking] = useState<string | null>(null)
  const mention = useMention(projectId, draft, onDraft, box)

  // the menu is open while the first word is a "/command" being typed
  const query = /^\/([\w:.-]*)$/.exec(draft)?.[1]
  const typing = query !== undefined
  // re-read on every menu open: plugins can be turned on/off for threads meanwhile
  useEffect(() => {
    let alive = true
    void api.listCommands(projectId).then((c) => alive && setCommands(c))
    return () => {
      alive = false
    }
  }, [projectId, typing])

  const matches = useMemo(() => (query === undefined ? [] : matchCommands(commands, query)), [commands, query])
  const menuOpen = query !== undefined && !menuOff && matches.length > 0
  const mentionOpen = mention.open && !menuOpen // one menu at a time
  useEffect(() => {
    setPick(0)
    setMenuOff(false)
  }, [query])

  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [draft])

  const complete = (c: SlashCommand) => {
    onDraft(`/${c.name} `)
    box.current?.focus()
  }
  const canSend = !sending && (!!draft.trim() || files.length > 0)

  const key = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mention.onKey(e)) return
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = matches.length
        setPick((i) => (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && matches[pick] && `/${matches[pick].name}` !== draft.trim())) {
        e.preventDefault()
        return complete(matches[pick])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        return setMenuOff(true)
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      if (canSend) onSend()
    }
  }

  const marked = files.find((f) => f.key === marking)
  const picked = (e: React.ChangeEvent<HTMLInputElement>) => {
    onAddFiles([...(e.target.files ?? [])])
    e.target.value = ''
  }

  return (
    <div className="composer-wrap">
      {menuOpen && <SlashMenu items={matches} active={pick} onHover={setPick} onPick={complete} />}
      {mentionOpen && <MentionMenu items={mention.items} active={mention.pick} onHover={mention.setPick} onPick={mention.insert} />}
      {files.length > 0 && (
        <div className="tray" aria-label="Anexos">
          {files.map((f) =>
            f.image ? (
              <div key={f.key} className="tray-img">
                <button className="tray-thumb" onClick={() => setMarking(f.key)} title="Marcar a imagem">
                  <img src={f.url} alt={f.name} />
                  <span className="tray-mark">
                    <PenLine size={12} /> {f.marks?.length ? `${f.marks.length} marca${f.marks.length > 1 ? 's' : ''}` : 'Marcar'}
                  </span>
                </button>
                <button className="tray-x" onClick={() => onRemoveFile(f.key)} aria-label={`Remover ${f.name}`}>
                  <X size={11} />
                </button>
              </div>
            ) : (
              <div key={f.key} className="tray-file" title={f.name}>
                <FileText size={15} />
                <span className="tray-name">{f.name}</span>
                <span className="tray-size">{formatSize(f.blob.size)}</span>
                <button className="tray-x inline" onClick={() => onRemoveFile(f.key)} aria-label={`Remover ${f.name}`}>
                  <X size={11} />
                </button>
              </div>
            )
          )}
        </div>
      )}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSend) onSend()
        }}
      >
        <textarea
          ref={box}
          rows={1}
          value={draft}
          onChange={(e) => {
            onDraft(e.target.value)
            mention.sync(e)
          }}
          onSelect={mention.sync}
          onKeyDown={key}
          onPaste={(e) => {
            const f = filesOf(e.clipboardData)
            if (!f.length) return
            e.preventDefault()
            onAddFiles(f)
          }}
          placeholder={`Fale com ${target}… (/ comandos, @ arquivos)`}
          aria-label={`Mensagem para ${target}`}
        />
        <input ref={anyFile} type="file" multiple hidden onChange={picked} />
        <input ref={imageFile} type="file" accept="image/*" multiple hidden onChange={picked} />
        <button type="button" className="icon-btn" aria-label="Anexar arquivo" title="Anexar arquivo" onClick={() => anyFile.current?.click()}>
          <Paperclip size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Anexar imagem" title="Anexar imagem (ou cole com ⌘V)" onClick={() => imageFile.current?.click()}>
          <ImagePlus size={16} />
        </button>
        <button type="submit" className="send-btn" aria-label="Enviar" disabled={!canSend}>
          {sending ? <Loader2 size={16} className="spin" /> : <ArrowUp size={17} />}
        </button>
      </form>
      {error && <div className="composer-error">{error}</div>}
      {marked && (
        <ImageMarkup
          item={marked}
          onCancel={() => setMarking(null)}
          onDone={(blob, marks, original) => {
            onMarked(marked.key, blob, marks, original)
            setMarking(null)
          }}
        />
      )}
    </div>
  )
}
