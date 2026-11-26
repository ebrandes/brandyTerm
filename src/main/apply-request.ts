// Validates a thread's `queue_apply` and builds the queue item.
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { ApplyItem } from '../shared/apply-queue.ts'
import type { Project } from '../shared/types.ts'
import { changedFiles, commitOf, isClean, mergeBase, realDir, toplevel, worktrees } from './apply-git.ts'

export interface ApplyRequest {
  worktree: string
  title: string
  base?: string
}

export async function buildItem(p: Project, threadId: string | undefined, req: ApplyRequest, now: number): Promise<ApplyItem> {
  if (!p.path || p.demo) throw new Error('Este projeto não tem pasta onde aplicar.')
  const title = req.title.trim().slice(0, 120)
  if (!title || !req.worktree.trim()) throw new Error('Informe worktree e title.')
  const root = await toplevel(p.path)
  const dir = realDir(resolve(p.path, req.worktree.trim()))
  if (dir === root) throw new Error('A worktree é a própria pasta do projeto: não há o que aplicar.')
  const wt = (await worktrees(root)).find((w) => w.path === dir)
  if (!wt) throw new Error(`${dir} não é uma worktree deste projeto (veja git worktree list).`)
  if (!(await isClean(dir))) throw new Error('A worktree tem mudanças sem commit: faça commit antes de pedir a aplicação.')
  const head = await commitOf(dir, 'HEAD')
  const base = req.base?.trim() ? await commitOf(dir, req.base.trim()) : await mergeBase(root, await commitOf(root, 'HEAD'), head)
  const files = await changedFiles(root, base, head)
  if (!files.length) throw new Error('Não há mudanças entre a base e a worktree.')
  return {
    id: randomUUID(), projectId: p.id, threadId, title, worktree: dir, branch: wt.branch, base, head, files,
    status: 'approval', createdAt: new Date(now).toISOString()
  }
}
