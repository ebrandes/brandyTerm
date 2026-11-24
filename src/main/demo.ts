import type { Project, Usage } from '../shared/types.ts'

const usage = (input: number, output: number): Usage => ({ input, output, cached: 0, measured: true })
const iso = (h: number, m: number): string => {
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.toISOString()
}

/** Demo projects: never spawn anything, only show what the app looks like. */
export function demoProjects(): Project[] {
  const empty = (id: string, name: string): Project => ({
    id,
    name,
    path: null,
    demo: true,
    messages: [],
    threads: [],
    coordinator: { usage: usage(0, 0) },
    busy: false,
    synthesized: [],
    processes: []
  })
  const ink = empty('demo-inktrait', 'InkTrait')
  ink.messages = [
    { id: 'd1', author: 'user', time: iso(10, 24), text: 'Revise o agendamento e cubra os conflitos de horário.' },
    {
      id: 'd2',
      author: 'coordinator',
      time: iso(10, 25),
      text: 'Dividi o trabalho em três threads.',
      summaries: [
        { agent: 'claude', title: 'Regras de agenda', text: 'O intervalo entre sessões já é respeitado.' },
        { agent: 'codex', title: 'Testes de conflito', text: 'Os testes cobrem reservas simultâneas.' }
      ]
    },
    {
      id: 'd3',
      author: 'coordinator',
      time: iso(10, 29),
      text: 'As regras e os testes estão revisados. O Gemini ainda verifica a experiência de remarcação.'
    }
  ]
  const mk = (id: string, title: string, agent: 'claude' | 'codex' | 'gemini', effort: 'low' | 'medium', state: 'running' | 'done', note?: string) => ({
    id,
    requestId: 'demo',
    title,
    objective: title,
    agent,
    effort,
    state,
    note,
    todos: [],
    steps: [],
    messages: [],
    usage: usage(1600, 0),
    createdAt: iso(10, 25),
    updatedAt: iso(10, 29)
  })
  ink.threads = [
    // newest last: the overview lists newest first
    mk('dt3', 'Testes de conflito', 'codex', 'medium', 'done'),
    mk('dt2', 'Regras de agenda', 'claude', 'medium', 'done'),
    mk('dt1', 'Remarcação', 'gemini', 'low', 'running', 'Verificando os avisos ao cliente.')
  ]
  return [ink, empty('demo-trainerclub', 'TrainerClub'), empty('demo-atlasfiscal', 'AtlasFiscal')]
}
