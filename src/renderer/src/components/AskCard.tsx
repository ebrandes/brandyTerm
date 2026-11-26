import { useId, useRef, useState, type KeyboardEvent } from 'react'
import { CircleCheck, MessageCircleQuestion, Send } from 'lucide-react'
import type { Message, Project } from '../types'
import { api } from '../api'
import { canAnswer } from '../../../shared/ask-question.ts'
import './ask-card.css'

type Ask = NonNullable<Message['ask']>

/**
 * A thread is waiting for a decision. Options are a vertical list; when the agent marked
 * one as recommended it is options[0] (the parser already moved it) and gets the badge.
 * Keyboard: ↑/↓/Home/End move between options, 1–9 pick one, Enter sends the typed answer.
 */
export function AskCard({ project, ask, stale }: { project: Project; ask: Ask; stale?: boolean }) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(false)
  const sending = useRef(false)
  const listRef = useRef<HTMLDivElement>(null)
  const qid = useId()
  const t = project.threads.find((x) => x.id === ask.threadId)
  const open = !stale && canAnswer(t, ask.question)
  const options = ask.options ?? []

  // one send at a time; main drops a second answer to the same question (answerTo)
  const answer = async (value: string) => {
    if (!value.trim() || sending.current) return
    sending.current = true
    setSent(true)
    setError(false)
    try {
      await api.send({ projectId: project.id, text: value.trim(), threadId: ask.threadId, answerTo: ask.question })
      setText('')
    } catch {
      setError(true)
    } finally {
      // released even on success: if the thread still waits, the card must stay usable
      sending.current = false
      setSent(false)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.ask-opt') ?? [])]
    const n = Number(e.key)
    if (n >= 1 && n <= buttons.length) {
      e.preventDefault()
      void answer(options[n - 1])
      return
    }
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      e.key === 'ArrowDown' ? (at + 1) % buttons.length
      : e.key === 'ArrowUp' ? (at <= 0 ? buttons.length - 1 : at - 1)
      : e.key === 'Home' ? 0
      : e.key === 'End' ? buttons.length - 1
      : -1
    if (next < 0 || !buttons.length) return
    e.preventDefault()
    buttons[next].focus()
  }

  if (!open)
    return (
      <div className="ask answered">
        <div className="ask-q">
          <MessageCircleQuestion size={16} aria-hidden />
          <span>{ask.question}</span>
        </div>
        <div className="ask-done">
          <CircleCheck size={13} aria-hidden /> Respondida · a thread continuou
        </div>
      </div>
    )

  return (
    <section className="ask" aria-labelledby={qid} onKeyDown={onKey}>
      <div className="ask-eyebrow">Decisão pendente</div>
      <div className="ask-q" id={qid}>
        <MessageCircleQuestion size={16} aria-hidden />
        <span>{ask.question}</span>
      </div>
      {options.length > 0 && (
        <div className="ask-opts" role="list" ref={listRef} aria-label="Opções">
          {options.map((o, i) => {
            const rec = i === 0 && !!ask.recommended
            return (
              <div role="listitem" key={`${i}:${o}`}>
                <button
                  type="button"
                  className={`ask-opt${rec ? ' rec' : ''}`}
                  onClick={() => void answer(o)}
                  disabled={sent}
                  aria-keyshortcuts={i < 9 ? String(i + 1) : undefined}
                >
                  <span className="ask-num" aria-hidden>{i + 1}</span>
                  <span className="ask-label">{o}</span>
                  {rec && <span className="ask-badge">Recomendado</span>}
                </button>
              </div>
            )
          })}
        </div>
      )}
      <form
        className="ask-form"
        onSubmit={(e) => {
          e.preventDefault()
          void answer(text)
        }}
      >
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={options.length ? 'Ou escreva outra resposta…' : 'Sua resposta…'}
          aria-label="Resposta para a thread"
          readOnly={sent}
        />
        <button type="submit" disabled={sent || !text.trim()}>
          <Send size={13} aria-hidden /> Responder
        </button>
      </form>
      {error && <p className="ask-error" role="alert">Não consegui enviar a resposta. Tente de novo.</p>}
    </section>
  )
}
