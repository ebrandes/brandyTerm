import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, MessageCircleQuestion, Send } from 'lucide-react'
import type { AskQuestion } from '../../../shared/ask-types.ts'
import { back, complete, composeAnswers, next, pick, start, write } from '../../../shared/ask-answer.ts'
import { AskOptions, onOptionKeys } from './AskOptions'
import './ask-stepper.css'

interface Props {
  questions: AskQuestion[]
  /** id of the visible question, so the card can be labelled by it */
  labelId: string
  sending: boolean
  /** receives every answer in one message */
  onSend: (text: string) => void
}

/**
 * Several decisions of one turn, one at a time: choosing an option moves on, the answers are
 * kept while going back and forth, and they are all sent together at the end.
 */
export function AskStepper({ questions, labelId, sending, onSend }: Props) {
  const [s, setS] = useState(() => start(questions.length))
  const root = useRef<HTMLDivElement>(null)
  const shown = useRef(0)
  const q = questions[s.at]
  const options = q.options ?? []
  const last = s.at === questions.length - 1
  const ready = !!s.answers[s.at].trim()
  const choose = (option: string) => setS((v) => next(pick(v, option)))

  // after a step change the focus follows the new question; opening the card does not steal it
  useEffect(() => {
    if (shown.current === s.at) return
    shown.current = s.at
    const el = root.current
    const target =
      el?.querySelector<HTMLElement>('.ask-opt[aria-pressed="true"]') ??
      el?.querySelector<HTMLElement>('.ask-opt') ??
      el?.querySelector<HTMLElement>('input')
    target?.focus()
  }, [s.at])

  return (
    <div ref={root} onKeyDown={(e) => !sending && onOptionKeys(e, options, choose)}>
      <div className="ask-step" aria-live="polite">
        <span className="ask-count">{s.at + 1} de {questions.length}</span>
        <div className="ask-q" id={labelId}>
          <MessageCircleQuestion size={16} aria-hidden />
          <span>{q.text}</span>
        </div>
      </div>
      <AskOptions
        key={s.at}
        options={options}
        recommended={q.recommended}
        selected={s.typed[s.at] ? '' : s.answers[s.at]}
        disabled={sending}
        onPick={choose}
      />
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!last) setS(next)
          else if (complete(s)) onSend(composeAnswers(questions, s.answers))
        }}
      >
        <div className="ask-form">
          <input
            value={s.typed[s.at] ? s.answers[s.at] : ''}
            onChange={(e) => {
              const text = e.target.value
              setS((v) => write(v, text))
            }}
            placeholder={options.length ? 'Ou escreva outra resposta…' : 'Sua resposta…'}
            aria-label={`Resposta para a pergunta ${s.at + 1} de ${questions.length}`}
            readOnly={sending}
          />
        </div>
        <div className="ask-nav">
          <button type="button" className="ask-back" onClick={() => setS(back)} disabled={sending || s.at === 0}>
            <ChevronLeft size={14} aria-hidden /> Voltar
          </button>
          {/* distinct keys: Enter on "Próxima" must not turn that same button into a submit */}
          {last ? (
            <button key="send" type="submit" className="ask-go" disabled={sending || !complete(s)}>
              <Send size={13} aria-hidden /> Enviar respostas
            </button>
          ) : (
            <button key="next" type="submit" className="ask-go" disabled={sending || !ready}>
              Próxima <ChevronRight size={14} aria-hidden />
            </button>
          )}
        </div>
      </form>
    </div>
  )
}
