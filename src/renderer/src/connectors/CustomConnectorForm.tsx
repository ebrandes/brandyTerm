import { useState } from 'react'
import type { ConnectorDraft, ConnectorSecrets } from '../../../shared/connectors.ts'
import { validateCustom } from '../../../shared/custom-form.ts'

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

const toRecord = (p: Pairs): Record<string, string> => Object.fromEntries(p.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value]))

interface Props {
  busy: boolean
  onSave: (draft: ConnectorDraft, secrets: ConnectorSecrets) => void
  onCancel: () => void
}

/** The "Personalizado" connector: a local command (stdio) or a remote URL (http), with secret values kept apart. */
export function CustomConnectorForm({ busy, onSave, onCancel }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')
  const [oauth, setOauth] = useState(false)
  const [env, setEnv] = useState<Pairs>([])
  const [headers, setHeaders] = useState<Pairs>([])
  const [trusted, setTrusted] = useState(false)
  const problem = validateCustom({ name, transport, command, url })
  const argList = args.split('\n').map((a) => a.trim()).filter(Boolean)
  const envNames = toRecord(env)
  const canSave = !problem && !busy && (transport === 'http' || trusted)

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
