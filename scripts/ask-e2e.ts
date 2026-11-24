// Real-CLI check of the question flow: thread asks -> waiting -> user answers via coordinator -> thread resumes.
import { Engine } from '../src/main/engine.ts'
import { JsonStore } from '../src/main/store.ts'
import { rmSync } from 'node:fs'

const [dir, stateFile] = process.argv.slice(2)
rmSync(stateFile, { force: true })
const e = new Engine(new JsonStore(stateFile))
await e.init()
const id = e.addProject(dir)
const p = e.state.projects.find((x) => x.id === id)!
const wait = async (cond: () => boolean, ms = 240000) => {
  const t0 = Date.now()
  while (!cond() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 400))
  return cond()
}
e.send(
  id,
  'Crie uma thread claude (haiku, effort low) com este objetivo exato: "Preciso saber qual banco de dados usar neste projeto, Postgres ou SQLite. Você NÃO pode escolher: pergunte ao usuário e pare." '
)
const asked = await wait(() => p.threads.some((t) => t.state === 'waiting'))
const t = p.threads[0]
console.log('waiting?', asked, '| question:', JSON.stringify(t?.question), '| ask card in main:', JSON.stringify(p.messages.find((m) => m.ask)?.ask))
if (asked) {
  await wait(() => !p.busy, 60000)
  e.send(id, 'SQLite')
  const resumed = await wait(() => t.state === 'running' || t.state === 'done')
  console.log('after answer ->', t.state, '| resumed:', resumed)
  await wait(() => ['done', 'failed', 'waiting'].includes(t.state), 200000)
  console.log('final ->', t.state, '| last:', t.messages.at(-1)?.text.slice(0, 200))
  console.log('coordinator:', p.messages.filter((m) => m.author === 'coordinator').map((m) => m.text.slice(0, 160)))
}
e.shutdown()
process.exit(0)
