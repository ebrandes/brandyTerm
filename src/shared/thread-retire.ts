import type { Thread } from './types.ts'

export type RetireReason = NonNullable<Thread['retired']>['reason']

/** Only a thread that stopped without succeeding can be set aside. */
export function canRetire(t: Pick<Thread, 'state' | 'retired'>): boolean {
  return (t.state === 'interrupted' || t.state === 'failed') && !t.retired
}

/** Sets the thread aside, keeping its state: it stops counting as pending and points to its replacement. */
export function retire(t: Thread, reason: RetireReason, by?: { id: string; title: string }): void {
  t.retired = { reason, by: by?.id, byTitle: by?.title, at: new Date().toISOString() }
  t.note = reason === 'superseded' && by ? `Substituída por “${by.title}”` : reason === 'superseded' ? 'Substituída' : 'Descartada'
}

export function retiredLabel(t: Pick<Thread, 'retired'>): string {
  return !t.retired ? '' : t.retired.reason === 'superseded' ? 'substituída' : 'descartada'
}
