import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FOLDED_LINES, countLines, newFileSummary, parseUnifiedDiff, viewerFiles, visibleLines } from './diff-summary.ts'

const PATCH = [
  'diff --git a/src/a.ts b/src/a.ts',
  'index 1111111..2222222 100644',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,4 +1,4 @@',
  ' import x',
  '-const a = 1',
  '+const a = 2',
  ' ',
  '@@ -10,2 +10,4 @@ function f() {',
  ' keep',
  '+one',
  '+two',
  ' end',
  '\\ No newline at end of file',
  ''
].join('\n')

test('parseUnifiedDiff counts +/- and keeps each hunk with its lines', () => {
  const s = parseUnifiedDiff(PATCH)
  assert.equal(s.added, 3)
  assert.equal(s.removed, 1)
  assert.equal(s.isNew, false)
  assert.equal(s.deleted, false)
  assert.equal(s.hunks.length, 2)
  assert.equal(s.hunks[1].header, '@@ -10,2 +10,4 @@ function f() {')
  assert.deepEqual(s.hunks[0].lines.map((l) => l.t).join(''), ' -+ ')
  assert.deepEqual(s.hunks[0].lines[1], { t: '-', text: 'const a = 1' })
  // header lines (--- a/…, +++ b/…) are not counted as changes
  assert.equal(s.hunks[1].lines.length, 4)
  assert.equal(s.truncated, false)
})

test('parseUnifiedDiff flags new, deleted and binary files', () => {
  const added = parseUnifiedDiff('diff --git a/n b/n\nnew file mode 100644\n--- /dev/null\n+++ b/n\n@@ -0,0 +1,2 @@\n+a\n+b\n')
  assert.equal(added.isNew, true)
  assert.equal(added.added, 2)
  const gone = parseUnifiedDiff('diff --git a/d b/d\ndeleted file mode 100644\n--- a/d\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n')
  assert.equal(gone.deleted, true)
  assert.equal(gone.removed, 1)
  assert.equal(parseUnifiedDiff('diff --git a/i.png b/i.png\nBinary files a/i.png and b/i.png differ\n').binary, true)
  assert.deepEqual(parseUnifiedDiff('').hunks, [])
})

test('parseUnifiedDiff keeps counting past the line cap but drops the extra lines', () => {
  const body = Array.from({ length: 30 }, (_, i) => `+l${i}`).join('\n')
  const s = parseUnifiedDiff(`@@ -0,0 +1,30 @@\n${body}\n@@ -50 +80 @@\n-z\n`, 10)
  assert.equal(s.added, 30)
  assert.equal(s.removed, 1)
  assert.equal(s.hunks.length, 1)
  assert.equal(s.hunks[0].lines.length, 10)
  assert.equal(s.truncated, true)
})

test('parseUnifiedDiff copes with CRLF patches', () => {
  const s = parseUnifiedDiff('@@ -1 +1 @@\r\n-a\r\n+b\r\n')
  assert.deepEqual(s.hunks[0].lines, [{ t: '-', text: 'a' }, { t: '+', text: 'b' }])
})

test('newFileSummary and countLines', () => {
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a'), 1)
  assert.equal(countLines('a\n'), 1)
  assert.equal(countLines('a\nb'), 2)
  assert.deepEqual(newFileSummary('x\ny\nz\n'), { added: 3, removed: 0, isNew: true, deleted: false, binary: false, hunks: [], truncated: false })
  assert.equal(newFileSummary('a\0b').binary, true)
})

test('visibleLines folds long hunks only', () => {
  const short = { header: '@@', lines: Array.from({ length: 5 }, () => ({ t: '+' as const, text: '' })) }
  assert.deepEqual(visibleLines(short, false), { lines: short.lines, hidden: 0 })
  const long = { header: '@@', lines: Array.from({ length: 40 }, () => ({ t: ' ' as const, text: '' })) }
  const folded = visibleLines(long, false)
  assert.equal(folded.lines.length, FOLDED_LINES)
  assert.equal(folded.hidden, 40 - FOLDED_LINES)
  assert.equal(visibleLines(long, true).hidden, 0)
})

test('viewerFiles drops build output, keeps the newest entry per path, newest first', () => {
  const files = [
    { path: 'src/a.ts', op: 'write', at: '2026-01-01T00:00:01Z' },
    { path: 'out/renderer/x.png', op: 'write', at: '2026-01-01T00:00:02Z' },
    { path: 'dist/b.js', op: 'write', at: '2026-01-01T00:00:03Z' },
    { path: 'pkg/node_modules/c/index.js', op: 'edit', at: '2026-01-01T00:00:04Z' },
    { path: 'src/b.ts', op: 'edit', at: '2026-01-01T00:00:05Z' },
    { path: 'src/a.ts', op: 'edit', at: '2026-01-01T00:00:06Z' },
    { path: 'outline/ok.md', op: 'write', at: '2026-01-01T00:00:00Z' }
  ]
  const list = viewerFiles(files)
  assert.deepEqual(list.map((f) => f.path), ['src/a.ts', 'src/b.ts', 'outline/ok.md'])
  assert.equal(list[0].op, 'edit')
})
