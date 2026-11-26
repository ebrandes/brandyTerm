import { useState } from 'react'
import type { ConnectorDraft, ConnectorSecrets, ConnectorView } from '../../../shared/connectors.ts'
import { api } from '../api'
import { report } from '../notice'
import { CustomConnectorForm } from './CustomConnectorForm'

interface Props {
  c: ConnectorView
  onDone: () => void
}

/** Corrigir: the "Personalizado" form over a saved connector whose definition cannot run. Id, projects and allowed tools stay. */
export function FixConnector({ c, onDone }: Props) {
  const [busy, setBusy] = useState(false)
  const save = async (d: ConnectorDraft, secrets: ConnectorSecrets) => {
    setBusy(true)
    try {
      const { transport, command, args, url, auth, trusted } = d
      await api.connectors.update({ id: c.id, patch: { name: d.name, description: d.description, definition: { transport, command, args, url, auth, trusted } }, secrets })
      onDone()
    } catch (e) {
      report(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="conn-config">
      <CustomConnectorForm busy={busy} initial={c} onSave={(d, s) => void save(d, s)} onCancel={onDone} />
    </div>
  )
}
