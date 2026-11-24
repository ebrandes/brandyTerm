import { Engine } from '../src/main/engine.ts'
import { JsonStore } from '../src/main/store.ts'
const [file, dir] = process.argv.slice(2)
const e = new Engine(new JsonStore(file))
await e.init(); e.addProject(dir); e.shutdown()
