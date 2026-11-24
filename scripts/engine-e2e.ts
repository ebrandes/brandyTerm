import { Engine } from '../src/main/engine.ts'
import { JsonStore } from '../src/main/store.ts'
import { rmSync } from 'node:fs'

const [dir, stateFile] = process.argv.slice(2)
rmSync(stateFile, { force: true })
const e = new Engine(new JsonStore(stateFile))
await e.init()
console.log('agents', e.state.agents.map((a) => `${a.id}:${a.installed}`).join(' '))
const id = e.addProject(dir)
e.send(id, 'Descubra como rodar os testes deste projeto')
const p = e.state.projects.find((x) => x.id === id)!
const t0 = Date.now()
let last = ''
while (Date.now() - t0 < 280000) {
  const snap = `busy=${p.busy} ` + p.threads.map((t) => `${t.agent}/${t.state}`).join(',') + ` msgs=${p.messages.length}`
  if (snap !== last) { console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', snap); last = snap }
  if (!p.busy && p.threads.length && p.threads.every((t) => ['done', 'failed'].includes(t.state)) && p.messages.at(-1)?.author === 'coordinator' && p.messages.length >= 3) break
  if (!p.busy && p.threads.length === 0 && p.messages.length >= 2) break
  await new Promise((r) => setTimeout(r, 500))
}
for (const m of p.messages) console.log(`[${m.author}]`, m.text.slice(0, 300), m.summaries ? JSON.stringify(m.summaries) : '')
for (const t of p.threads) console.log('THREAD', t.title, t.agent, t.model, t.effort, t.state, '| summary:', t.summary, '| usage', JSON.stringify(t.usage))
// direct message
if (p.threads[0]?.state === 'done') {
  e.send(id, 'Qual o nome do arquivo de testes? responda em 1 linha', p.threads[0].id)
  while (p.threads[0].state === 'running') await new Promise((r) => setTimeout(r, 500))
  console.log('DIRECT ->', p.threads[0].state, p.threads[0].messages.at(-1)?.text.slice(0, 200))
  console.log('MAIN last ->', p.messages.at(-1)?.text, JSON.stringify(p.messages.at(-1)?.summaries))
}
e.shutdown()
