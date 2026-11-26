import type { KeyboardEvent } from 'react'

interface Props {
  options: string[]
  /** options[0] is the one the agent recommends */
  recommended?: boolean
  /** the chosen option, where choosing does not send right away */
  selected?: string
  disabled?: boolean
  onPick: (option: string) => void
}

/** The options of a question as a vertical list; the recommended one comes first, with a badge. */
export function AskOptions({ options, recommended, selected, disabled, onPick }: Props) {
  if (!options.length) return null
  return (
    <div className="ask-opts" role="list" aria-label="Opções">
      {options.map((o, i) => {
        const rec = i === 0 && !!recommended
        return (
          <div role="listitem" key={`${i}:${o}`}>
            <button
              type="button"
              className={`ask-opt${rec ? ' rec' : ''}`}
              onClick={() => onPick(o)}
              disabled={disabled}
              aria-pressed={selected === undefined ? undefined : selected === o}
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
  )
}

/** Keyboard of a question card: ↑/↓/Home/End move between options, 1–9 choose one. */
export function onOptionKeys(e: KeyboardEvent<HTMLElement>, options: string[], onPick: (option: string) => void) {
  if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return
  const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.ask-opt')]
  const n = Number(e.key)
  if (n >= 1 && n <= buttons.length) {
    e.preventDefault()
    if (!buttons[n - 1].disabled) onPick(options[n - 1])
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
