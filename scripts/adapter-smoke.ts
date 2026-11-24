import { claudeAdapter } from '../src/main/adapters/claude.ts'
import { codexAdapter } from '../src/main/adapters/codex.ts'
import type { AgentAdapter } from '../src/main/adapters/types.ts'

const cwd = process.argv[2]
async function go(a: AgentAdapter) {
  console.log('detect', JSON.stringify(await a.detect()))
  let session = ''
  const log = (e: unknown) => console.log(' ', a.id, JSON.stringify(e).slice(0, 200))
  const h = a.run({ cwd, prompt: 'List the files in this folder, then say the codeword is KIWI.', tools: 'readonly', effort: 'low' }, (e) => {
    if (e.kind === 'session') session = e.sessionId
    log(e)
  })
  await h.done
  const h2 = a.run({ cwd, prompt: 'What was the codeword?', sessionId: session, tools: 'readonly' }, log)
  await h2.done
}
await go(claudeAdapter)
await go(codexAdapter)
