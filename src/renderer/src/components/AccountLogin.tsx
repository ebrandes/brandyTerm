import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { LogIn, X } from 'lucide-react'
import type { AccountsState } from '../types'
import { attach, dispose } from '../terminals'
import { api } from '../api'

const TERM = 'account-login'

interface Props {
  login?: AccountsState['login']
  /** accounts before the modal opened: a new one means the login worked */
  count: number
  onClose: () => void
}

/** Adds a Claude account: `claude setup-token` with the browser login, or a pasted token. */
export function AccountLogin({ login, count, onClose }: Props) {
  const [label, setLabel] = useState(login?.label ?? '')
  const [token, setToken] = useState('')
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(!!login)
  const start = useRef(count)
  const box = useRef<HTMLDivElement>(null)

  const close = () => {
    void api.accounts.loginCancel()
    dispose(TERM)
    onClose()
  }

  // a new account appeared: done
  useEffect(() => {
    if (count > start.current) {
      dispose(TERM)
      onClose()
    }
  }, [count, onClose])

  useEffect(() => {
    const el = box.current
    if (!running || !el) return
    const e = attach(TERM)
    el.appendChild(e.host)
    try {
      e.fit.fit()
    } catch {
      // not laid out yet
    }
    e.term.focus()
    return () => e.host.remove()
  }, [running])

  const begin = async () => {
    setError(undefined)
    setRunning(true)
    try {
      await api.accounts.loginStart({ label: label || 'Outra conta', rows: 18 })
    } catch (err) {
      setError(String((err as Error).message))
      setRunning(false)
    }
  }

  const saveToken = async () => {
    setError(undefined)
    try {
      await api.accounts.addToken({ label: label || 'Outra conta', token })
    } catch (err) {
      setError(String((err as Error).message).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
  }

  // portal: the sidebar's section styles must not leak into the dialog
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Adicionar conta Claude">
      <div className="modal acct-modal">
        <header className="acct-modal-head">
          <h3>Adicionar conta Claude</h3>
          <button className="icon-btn sm" onClick={close} aria-label="Fechar">
            <X size={14} />
          </button>
        </header>
        <label className="acct-field">
          Nome da conta
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ex.: Esposa (Max)" autoFocus={!running} disabled={running} />
        </label>
        {!running ? (
          <>
            <p className="acct-help">
              Abre o navegador para entrar no claude.ai. Entre com a conta que quer adicionar: se o navegador já estiver logado em outra, saia dela antes ou
              copie o link para uma janela anônima. O token gerado fica guardado no chaveiro do sistema e só é usado pelo BrandyTerm.
            </p>
            <button className="acct-primary" onClick={() => void begin()}>
              <LogIn size={14} /> Entrar pelo navegador
            </button>
            <details className="acct-paste">
              <summary>Já tenho um token (claude setup-token)</summary>
              <div className="acct-paste-row">
                <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="sk-ant-oat01-…" type="password" aria-label="Token" />
                <button onClick={() => void saveToken()} disabled={!token.trim()}>
                  Salvar
                </button>
              </div>
            </details>
          </>
        ) : (
          <>
            <p className="acct-help">Termine o login no navegador. Se ele pedir um código, cole aqui no terminal. A conta entra sozinha quando o token aparecer.</p>
            <div className="acct-term" ref={box} />
          </>
        )}
        {(error || login?.error) && <p className="acct-error">{error ?? login?.error}</p>}
      </div>
    </div>,
    document.querySelector('.app') ?? document.body
  )
}
