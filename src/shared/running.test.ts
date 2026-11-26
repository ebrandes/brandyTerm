import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runningItems } from './running.ts'
import type { Project, Thread, ThreadState } from './types.ts'

function proj(id: string, over: Partial<Project> = {}, threads: Partial<Thread>[] = []): Project {
  return { id, name: id.toUpperCase(), path: `/${id}`, demo: false, busy: false, threads: threads as Thread[], ...over } as Project
}
const kinds = (p: Project[]) => runningItems(p).map((r) => `${r.projectId}:${r.kind}:${r.title}`)

test('busy coordinator, running and queued threads count', () => {
  const p = proj('a', { busy: true }, [{ title: 'um', state: 'running' }, { title: 'dois', state: 'queued' }])
  assert.deepEqual(kinds([p]), ['a:coordinator:Coordenador', 'a:thread:um', 'a:thread:dois'])
})

test('a finished thread still writing its report counts', () => {
  assert.deepEqual(kinds([proj('a', {}, [{ title: 'r', state: 'done', reporting: true }])]), ['a:report:r'])
})

test('waiting, interrupted and finished threads do not count', () => {
  const states: ThreadState[] = ['waiting', 'interrupted', 'done', 'failed', 'cancelled']
  assert.deepEqual(kinds([proj('a', {}, states.map((state) => ({ title: state, state })))]), [])
})

test('demo projects are ignored', () => {
  assert.deepEqual(kinds([proj('d', { demo: true, busy: true }, [{ title: 'x', state: 'running' }])]), [])
})

test('every project counts, with its name', () => {
  const list = runningItems([proj('a'), proj('b', {}, [{ title: 'x', state: 'running' }]), proj('c', { busy: true })])
  assert.deepEqual(list.map((r) => r.projectName), ['B', 'C'])
})
