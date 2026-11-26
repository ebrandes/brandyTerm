import { useState } from 'react'
import type { ConnectorDraft, ConnectorSecrets, ConnectorView } from '../../../shared/connectors.ts'
import { validateCustom } from '../../../shared/custom-form.ts'
import { fixPastedCommand, installHint } from '../../../shared/install-command.ts'

type Pairs = { key: string; value: string }[]

function PairRows({ label, rows, onChange }: { label: string; rows: Pairs; onChange: (r: Pairs) => void }) {
  return (
    <div className="conn-pairs">
      <span>{label}</span>
      {rows.map((r, i) => (
        <div key={i} className="conn-pair">
          <input placeholder="Nome" value={r.key} aria-label={`${label}: nome`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
          <input type="password" placeholder="Valor" value={r.value} autoComplete="off" aria-label={`${label}: valor`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, { key: '', value: '' }])}>+ Adicionar</button>
    </div>
  )
}

const toPairs = (r: Record<string, string>): Pairs => Object.entries(r).map(([key, value]) => ({ key, value }))
const toRecord = (p: Pairs): Record<string, string> => Object.fromEntries(p.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))

interface Props {
  busy: boolean
  /** Corrigir: starts from the saved connector (secret values are never sent back, so they start empty) */
  initial?: ConnectorView
  onSave: (draft: ConnectorDraft, secrets: ConnectorSecrets) => void
  onCancel: () => void
}

/** The "Personalizado" connector: a local command (stdio) or a remote URL (http), with secret values kept apart. */
export function CustomConnectorForm({ busy, initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [transport, setTransport] = useState<'stdio' | 'http'>(initial?.transport === 'http' ? 'http' : 'stdio')
  const [command, setCommand] = useState(initial?.command ?? '')
  const [args, setArgs] = useState((initial?.args ?? []).join('\n'))
  const [url, setUrl] = useState(initial?.url ?? '')
  const [oauth, setOauth] = useState(initial?.authKind === 'oauth')
  const [env, setEnv] = useState<Pairs>([])
  const [headers, setHeaders] = useState<Pairs>([])
  const [trusted, setTrusted] = useState(false)
  const problem = validateCustom({ name, transport, command, url })
  const argList = args.split('\n').map((a) => a.trim()).filter(Boolean)
  const envNames = toRecord(env)
  const canSave = !problem && !busy && (transport === 'http' || trusted)
  // `claude mcp add … <url>` pasted as the command: it installs a server, it is not one
  const pasted = transport === 'stdio' ? fixPastedCommand(command, argList) : null
  const install = pasted?.kind === 'install' ? pasted : null

  const applyFix = () => {
    if (!install) return
    const f = install.fixed
    if (!name.trim() && install.name) setName(install.name)
    if (f.transport === 'http') {
      setTransport('http')
      setUrl(f.url ?? '')
      setHeaders([...headers.filter((h) => h.key.trim()), ...toPairs(f.headers)])
    } else {
      setCommand(f.command ?? '')
      setArgs((f.args ?? []).join('\n'))
      setEnv([...env.filter((e) => e.key.trim()), ...toPairs(f.env)])
    }
  }

  const save = () => {
    const base = { name: name.trim(), description: description.trim(), transport, enabled: true }
    if (transport === 'stdio') {
      onSave({ ...base, command: command.trim(), args: argList, auth: { kind: 'none' }, trusted }, { env: envNames })
    } else {
      onSave({ ...base, url: url.trim(), auth: oauth ? { kind: 'oauth' } : { kind: 'none' } }, { headers: toRecord(headers) })
    }
  }

  return (
    <div className="conn-form">
      <label className="conn-field">Nome<input value={name} onChange={(e) => setName(e.target.value)} autoFocus /></label>
      <label className="conn-field">Descrição<input value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <div className="conn-tabs" role="tablist">
        <button role="tab" aria-selected={transport === 'stdio'} className={transport === 'stdio' ? 'on' : ''} onClick={() => setTransport('stdio')}>Comando (stdio)</button>
        <button role="tab" aria-selected={transport === 'http'} className={transport === 'http' ? 'on' : ''} onClick={() => setTransport('http')}>URL (http)</button>
      </div>
      {transport === 'stdio' ? (
        <>
          <label className="conn-field">Comando<input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npx" /></label>
          <label className="conn-field">Argumentos (um por linha)<textarea rows={3} value={args} onChange={(e) => setArgs(e.target.value)} /></label>
          <PairRows label="Variáveis de ambiente" rows={env} onChange={setEnv} />
          {command.trim() && (
            <div className="conn-exact">
              <span>Será executado exatamente:</span>
              <code>{[command.trim(), ...argList].join(' ')}</code>
              {Object.keys(envNames).length > 0 && <span>Com as variáveis: {Object.keys(envNames).join(', ')}</span>}
            </div>
          )}
          {install && (
            <div className="conn-error" role="alert">
              {installHint(install)} <button type="button" onClick={applyFix}>Corrigir</button>
            </div>
          )}
          <label className="conn-trust">
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
            Confio neste comando
          </label>
        </>
      ) : (
        <>
          <label className="conn-field">URL<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></label>
          <PairRows label="Cabeçalhos" rows={headers} onChange={setHeaders} />
          <label className="conn-trust">
            <input type="checkbox" checked={oauth} onChange={(e) => setOauth(e.target.checked)} />
            Exige login pelo navegador (OAuth)
          </label>
        </>
      )}
      {problem && (name || command || url) && <div className="conn-error">{problem}</div>}
      <div className="conn-actions">
        <button onClick={onCancel}>Cancelar</button>
        <button className="primary-sm" disabled={!canSave} onClick={save}>Salvar</button>
      </div>
    </div>
  )
}
