import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { ConnectorDraft, ConnectorSecrets, Preset } from '../../../shared/connectors.ts'
import { api } from '../api'
import { errorText, report } from '../notice'
import { CustomConnectorForm } from './CustomConnectorForm'
import { PresetIcon } from './PresetIcon'

interface Props {
  /** a preset id to start on (from "Instalar aqui") */
  initial?: string
  onClose: () => void
}

type Pick = { kind: 'preset'; preset: Preset } | { kind: 'custom' } | null

/** Presets in a grid, plus "Personalizado". Saving a connector that needs login opens its login card. */
export function AddConnectorDialog({ initial, onClose }: Props) {
  const [presets, setPresets] = useState<Preset[]>([])
  const [pick, setPick] = useState<Pick>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let alive = true
    void api.connectors.presets().then((p) => {
      if (!alive) return
      setPresets(p)
      const start = initial ? p.find((x) => x.id === initial) : undefined
      if (start) setPick({ kind: 'preset', preset: start })
    }).catch(report)
    return () => { alive = false }
  }, [initial])

  const save = async (preset: string | undefined, draft: ConnectorDraft, secrets: ConnectorSecrets | undefined, authKind: string) => {
    setBusy(true)
    setError(undefined)
    try {
      const { id } = await api.connectors.add({ preset, draft, secrets })
      if (authKind !== 'none') await api.connectors.login({ id }).catch(report)
      onClose()
    } catch (e) {
      setError(errorText(e))
      setBusy(false)
    }
  }

  // portal: the sidebar's section styles must not leak into the dialog
  return createPortal(
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="Adicionar conector">
      <div className="modal conn-modal">
        <header className="conn-modal-head">
          <h3>Adicionar conector</h3>
          <button className="icon-btn sm" onClick={onClose} aria-label="Fechar"><X size={14} /></button>
        </header>
        {!pick && (
          <div className="conn-grid">
            {presets.map((p) => (
              <button key={p.id} className="conn-preset" onClick={() => setPick({ kind: 'preset', preset: p })}>
                <strong><PresetIcon id={p.id} />{p.name}</strong>
                <span>{p.description}</span>
              </button>
            ))}
            <button className="conn-preset" onClick={() => setPick({ kind: 'custom' })}>
              <strong><PresetIcon />Personalizado</strong>
              <span>Um comando local ou uma URL com seus cabeçalhos</span>
            </button>
          </div>
        )}
        {pick?.kind === 'preset' && (
          <div className="conn-form">
            <h4 className="conn-preset-title"><PresetIcon id={pick.preset.id} size={20} />{pick.preset.name}</h4>
            <p className="conn-hint">{pick.preset.description}</p>
            <div className="conn-actions">
              <button onClick={() => (initial ? onClose() : setPick(null))}>{initial ? 'Cancelar' : 'Voltar'}</button>
              <button className="primary-sm" disabled={busy}
                onClick={() => void save(pick.preset.id, { name: pick.preset.name, enabled: true }, undefined, pick.preset.auth.kind)}>
                Salvar
              </button>
            </div>
          </div>
        )}
        {pick?.kind === 'custom' && (
          <CustomConnectorForm busy={busy} onCancel={() => setPick(null)}
            onSave={(d, s) => void save(undefined, d, s, d.auth?.kind ?? 'none')} />
        )}
        {error && <div className="conn-error">{error}</div>}
      </div>
    </div>,
    document.body
  )
}
