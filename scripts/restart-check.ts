import { Engine } from '../src/main/engine.ts'
import { JsonStore } from '../src/main/store.ts'
const e = new Engine(new JsonStore(process.argv[2]))
await e.init()
for (const p of e.state.projects) {
  const users = p.messages.filter((m) => m.author === 'user').length
  console.log(p.name, 'userRequests=', users, 'threads=', p.threads.length, p.threads.map((t) => t.state + ' sid=' + !!t.sessionId + ' msgs=' + t.messages.length), 'lastMain=', p.messages.at(-1)?.text.slice(0, 60))
}
e.shutdown()
