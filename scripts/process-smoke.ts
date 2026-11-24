import { ProcessManager } from '../src/main/processes.ts'
import { createConnection } from 'node:net'

const pm = new ProcessManager()
const mk = (port: number) => `node -e "require('http').createServer((q,r)=>r.end('ok')).listen(${port},()=>console.log('\x1b[32mServer on http://localhost:${port}\x1b[0m'))"`
const a = pm.start(process.cwd(), 'frontend', mk(47891), () => {})
const b = pm.start(process.cwd(), 'backend', mk(47892), () => {})
await new Promise((r) => setTimeout(r, 2500))
const open = (port: number) => new Promise<boolean>((res) => { const s = createConnection(port, '127.0.0.1').on('connect', () => { s.destroy(); res(true) }).on('error', () => res(false)) })
console.log('ports detected:', a.ports, b.ports, '| listening:', await open(47891), await open(47892))
console.log('log (ansi stripped):', JSON.stringify(a.log))
pm.stop(a.id)
await new Promise((r) => setTimeout(r, 1500))
console.log('after stop frontend:', a.state, '| port open:', await open(47891), '| backend still:', b.state, await open(47892))
pm.stopAll()
await new Promise((r) => setTimeout(r, 1500))
console.log('after stopAll backend:', b.state, '| port open:', await open(47892))
