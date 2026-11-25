import { useState } from 'react'
import { visibleLines, type DiffHunk } from '../../../shared/diff-summary.ts'
import type { DiffState } from '../useFileDiffs'

/** `+X −Y` in the theme's green and red. */
export function DiffStat({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="art-stat">
      <span className="art-add">+{added}</span>
      <span className="art-del">−{removed}</span>
    </span>
  )
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

function Hunk({ hunk }: { hunk: DiffHunk }) {
  const [open, setOpen] = useState(false)
  const { lines, hidden } = visibleLines(hunk, open)
  return (
    <section className="art-hunk">
      <div className="art-hunk-head">{hunk.header}</div>
      <pre className="art-hunk-body">
        {lines.map((l, i) => (
          <div key={i} className={l.t === '+' ? 'art-dl add' : l.t === '-' ? 'art-dl del' : 'art-dl'}>
            <span className="art-dm">{l.t}</span>
            {l.text || ' '}
          </div>
        ))}
      </pre>
      {hidden > 0 && (
        <button className="art-more" onClick={() => setOpen(true)}>
          mostrar mais ({plural(hidden, 'linha', 'linhas')})
        </button>
      )}
    </section>
  )
}

/** The Diff tab: a short summary of the file's changes since the last commit. */
export function DiffView({ diff }: { diff: DiffState | undefined }) {
  if (!diff || diff.kind === 'loading') return <p className="art-note">Calculando o diff…</p>
  if (diff.kind === 'not-git') return <p className="art-note">Este projeto não é um repositório git, então não há diff para mostrar.</p>
  if (diff.kind === 'invalid') return <p className="art-note">Não deu para calcular o diff deste arquivo.</p>
  if (diff.kind === 'error') return <p className="art-note">Não deu para calcular o diff: {diff.error}</p>
  const s = diff.summary
  if (s.binary) return <p className="art-note">{s.isNew ? 'Arquivo novo, binário.' : 'Arquivo binário: sem diff de texto.'}</p>
  if (s.isNew)
    return (
      <p className="art-note art-diff-note">
        <DiffStat added={s.added} removed={0} /> Arquivo novo, {plural(s.added, 'linha', 'linhas')}.
      </p>
    )
  if (s.deleted)
    return (
      <p className="art-note art-diff-note">
        <DiffStat added={0} removed={s.removed} /> Arquivo apagado.
      </p>
    )
  if (!s.hunks.length) return <p className="art-note">Sem mudanças desde o último commit.</p>
  return (
    <div className="art-diff">
      <p className="art-note art-diff-note">
        <DiffStat added={s.added} removed={s.removed} /> {plural(s.hunks.length, 'trecho alterado', 'trechos alterados')} desde o último commit
      </p>
      {s.hunks.map((h, i) => (
        <Hunk key={`${i}:${h.header}`} hunk={h} />
      ))}
      {s.truncated && <p className="art-note">Diff longo: só o começo aparece aqui. Abra no editor para ver tudo.</p>}
    </div>
  )
}
