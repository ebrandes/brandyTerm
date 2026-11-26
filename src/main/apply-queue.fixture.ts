// Fixture of the apply queue tests: a throwaway repository, its worktrees and a fake engine.
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ApplyQueue } from './apply-queue.ts'
import { IDLE_WINDOW_MS, SETTLE_MS, type ApplyQueueView } from '../shared/apply-queue.ts'
import type { Message, Project } from '../shared/types.ts'

export const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' })

class Host extends EventEmitter {
  state: { projects: Project[]; applyQueue?: ApplyQueueView }
  constructor(projects: Project[]) { super(); this.state = { projects } }
  msg(author: Message['author'], text: string, extra: Partial<Message> = {}): Message {
    return { id: String(Math.random()), author, text, createdAt: new Date(0).toISOString(), ...extra } as Message
  }
  touch(): void { this.emit('change') }
}

/** a project folder with uncommitted work, and worktrees that each add one file */
export function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apply-'))
  const repo = path.join(dir, 'repo')
  fs.mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.txt'), 'um\n')
  git(repo, 'add', '.')
  git(repo, 'commit', '-qm', 'inicial')
  fs.writeFileSync(path.join(repo, 'sujo.txt'), 'do usuário\n')
  const worktree = (name: string, file: string | string[] = `src/main/${name}.txt`, content = `${name}\n`) => {
    const wt = path.join(dir, name)
    git(repo, 'worktree', 'add', '-q', '-b', name, wt)
    for (const f of [file].flat()) {
      fs.mkdirSync(path.dirname(path.join(wt, f)), { recursive: true })
      fs.writeFileSync(path.join(wt, f), content)
    }
    git(wt, 'add', '.')
    git(wt, 'commit', '-qm', name)
    return wt
  }
  const project = { id: 'p', name: 'P', path: repo, busy: false, threads: [], messages: [] } as unknown as Project
  const host = new Host([project])
  const clock = { t: 1_000_000 }
  const data = path.join(dir, 'data')
  /** by default the project is the app's own repository, where a change to src/main waits for approval */
  const open = (appRoot: string | null = repo) => new ApplyQueue(host, data, () => clock.t, appRoot ?? undefined)
  /** ticks, then lets enough idle time pass and ticks again */
  const idle = async (q: ApplyQueue) => {
    await q.tick()
    clock.t += Math.max(IDLE_WINDOW_MS, SETTLE_MS) + 1
    await q.tick()
  }
  const has = (f: string) => fs.existsSync(path.join(repo, f))
  /** the file a worktree adds by default is there */
  const landed = (name: string) => has(`src/main/${name}.txt`)
  return { dir, repo, worktree, project, host, clock, data, open, idle, has, landed, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) }
}
