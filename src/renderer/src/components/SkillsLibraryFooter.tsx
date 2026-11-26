import { useState } from 'react'
import { api } from '../api'

/** "Biblioteca: dono/repo", edited in place (Enter saves, Esc cancels). */
export function SkillsLibraryFooter({ repo }: { repo: string }) {
  const [draft, setDraft] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string>()
  const save = async () => {
    if (draft === null || draft.trim() === repo) return setDraft(null)
    setBusy(true)
    try {
      const r = await api.setSkillsLibrary({ repo: draft.trim() })
      if (r.ok) setDraft(null)
      setErro(r.ok ? undefined : r.erro)
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="up-lib">
      {draft === null ? (
        <button className="up-lib-name" title="Trocar o repositório da biblioteca" onClick={() => setDraft(repo)}>
          Biblioteca: {repo}
        </button>
      ) : (
        <input
          className="up-search"
          autoFocus
          value={draft}
          readOnly={busy}
          aria-label="Repositório da biblioteca (dono/repo ou URL https)"
          placeholder="dono/repo"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') {
              setDraft(null)
              setErro(undefined)
            }
          }}
          onBlur={() => !busy && setDraft(null)}
        />
      )}
      {busy && <p className="up-hint">Baixando a biblioteca…</p>}
      {erro && <p className="up-hint warn">{erro}</p>}
    </div>
  )
}
