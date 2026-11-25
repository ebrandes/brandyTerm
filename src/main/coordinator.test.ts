import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildThreadPrompt } from './coordinator.ts'
import type { Project } from '../shared/types.ts'

test('thread prompt mentions connectors', () => {
  for (const agent of ['claude', 'codex'] as const) {
    const p = buildThreadPrompt({ name: 'Demo' } as Project, 'obj', agent)
    assert.ok(
      p.includes('Serviços externos (Railway, GitHub e outros) ficam disponíveis pelas ferramentas list_connectors, connector_tools e call_connector; use só quando a tarefa precisar.')
    )
  }
})
