import type { AgentCoverage } from '../../../shared/plugin-health'

const NAMES: Record<AgentCoverage['agent'], string> = { claude: 'Claude', codex: 'Codex' }

export function PluginCoverage({ list }: { list: AgentCoverage[] }) {
  return (
    <div className="plugin-coverage">
      {list.map((c) => (
        <div key={c.agent} className={c.ok ? undefined : 'off'}>
          {c.ok ? '✓' : '✗'} {NAMES[c.agent]}: {c.detail}
        </div>
      ))}
    </div>
  )
}
