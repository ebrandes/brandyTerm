import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileName, fitCount, isBuildOutput, summaryFiles } from './file-chips.ts'

const f = (path: string, op: 'write' | 'edit' = 'write') => ({ path, op, at: '2026-11-25T10:00:00Z' })

test('isBuildOutput catches out/, dist/ and node_modules/ at any depth', () => {
  assert.equal(isBuildOutput('out/renderer/assets/logo-CJSu7RmP.png'), true)
  assert.equal(isBuildOutput('./dist/index.js'), true)
  assert.equal(isBuildOutput('packages/app/dist/main.js'), true)
  assert.equal(isBuildOutput('node_modules/react/index.js'), true)
  assert.equal(isBuildOutput('src\\out\\x.js'), true)
  assert.equal(isBuildOutput('src/main/project-actions.ts'), false)
  assert.equal(isBuildOutput('docs/output/notes.md'), false)
  assert.equal(isBuildOutput('distribution.md'), false)
})

test('summaryFiles drops build output and lists the newest first', () => {
  const files = [f('src/a.ts'), f('out/renderer/assets/mark.png'), f('src/b.ts', 'edit')]
  assert.deepEqual(summaryFiles(files).map((x) => x.path), ['src/b.ts', 'src/a.ts'])
  assert.equal(files.length, 3, 'does not mutate the input')
})

test('fileName keeps only the last segment', () => {
  assert.equal(fileName('src/renderer/src/components/ProjectRow.tsx'), 'ProjectRow.tsx')
  assert.equal(fileName('README.md'), 'README.md')
})

test('fitCount shows everything when it all fits', () => {
  assert.equal(fitCount([50, 50, 50], 158, 40, 4), 3)
  assert.equal(fitCount([], 100, 40, 4), 0)
})

test('fitCount leaves room for the +N button when it does not', () => {
  // 40 (more) + 4+50 + 4+50 = 148 <= 150; a third chip would need 202
  assert.equal(fitCount([50, 50, 50, 50], 150, 40, 4), 2)
  // never fewer than one chip, even in a very narrow row
  assert.equal(fitCount([300, 50], 100, 40, 4), 1)
  assert.equal(fitCount([50, 50], 0, 40, 4), 1)
})
