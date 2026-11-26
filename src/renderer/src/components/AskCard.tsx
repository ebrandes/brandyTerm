import { useId, useRef, useState } from 'react'
import { ArrowUpRight, CircleCheck, MessageCircleQuestion, Send } from 'lucide-react'
import type { Message, Project } from '../types'
import { api } from '../api'
import { canAnswer } from '../../../shared/ask-question.ts'
import { AskOptions, onOptionKeys } from './AskOptions'
import { AskStepper } from './AskStepper'
import './ask-card.css'

type Ask = NonNullable<Message['ask']>

interface Props {
  project: Project
  ask: Ask
  stale?: boolean
  /** shortcut to the thread, for cards shown outside it */
  onOpenThread?: (id: string) => void
}

/**
 * A thread is waiting for a decision. A single question is answered by choosing an option
 * (the recommended one comes first) or typing; several go through the stepper.
 */
export function AskCard({ project, ask, stale, onOpenThread }: Props) {
  const [text, setText] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState(false)
  const sending = useRef(false)
  const qid = useId()
  const t = project.threads.find((x) => x.id === ask.threadId)
  const open = !stale && canAnswer(t, ask.question)
  const options = ask.options ?? []
  const questions = ask.more && [{ text: ask.question, options: ask.options, recommended: ask.recommended }, ...ask.more]

  // one send at a time; main drops a second answer to the same card (answerTo: its first question)
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

  if (!open)
    return (
      <div className="ask answered">
        <div className="ask-q">
          <MessageCircleQuestion size={16} aria-hidden />
          <span>{ask.question}{questions ? ` (+${questions.length - 1})` : ''}</span>
        </div>
        <div className="ask-done">
          <CircleCheck size={13} aria-hidden /> Respondida · a thread continuou
        </div>
      </div>
    )

  const head = (
    <div className="ask-head">
      <div className="ask-eyebrow">{questions ? `${questions.length} decisões pendentes` : 'Decisão pendente'}</div>
      {onOpenThread && (
        <button type="button" className="ask-open" onClick={() => onOpenThread(ask.threadId)}>
          Abrir a thread <ArrowUpRight size={13} aria-hidden />
        </button>
      )}
    </div>
  )
  const failed = error && <p className="ask-error" role="alert">Não consegui enviar a resposta. Tente de novo.</p>

  if (questions)
    return (
      <section className="ask" aria-labelledby={qid}>
        {head}
        <AskStepper key={ask.question} questions={questions} labelId={qid} sending={sent} onSend={(v) => void answer(v)} />
        {failed}
      </section>
    )

  return (
    <section className="ask" aria-labelledby={qid} onKeyDown={(e) => onOptionKeys(e, options, (o) => void answer(o))}>
      {head}
      <div className="ask-q" id={qid}>
        <MessageCircleQuestion size={16} aria-hidden />
        <span>{ask.question}</span>
      </div>
      <AskOptions options={options} recommended={ask.recommended} disabled={sent} onPick={(o) => void answer(o)} />
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
      {failed}
    </section>
  )
}
