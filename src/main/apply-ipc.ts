import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import type { ApplyQueue } from './apply-queue.ts'

/** the panel's buttons: only this machine's user approves what changes its folders */
export function registerApplyIpc(queue: ApplyQueue): void {
  registry.add('apply:approve', (id: string) => queue.approve(String(id)), ruleOf('apply:approve'))
  registry.add('apply:cancel', (id: string) => queue.cancel(String(id)), ruleOf('apply:cancel'))
  registry.add('apply:retry', (id: string) => queue.retry(String(id)), ruleOf('apply:retry'))
}
