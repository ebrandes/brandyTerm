import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { countSkills } from './count.ts'

function plugin(t: { after(fn: () => void): void }, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'count-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), body)
  }
  return dir
}

test('counts nested skills', (t) => {
  const dir = plugin(t, { 'skills/eng/tdd/SKILL.md': '', 'skills/prod/x/SKILL.md': '' })
  assert.equal(countSkills(dir), 2)
})

test('prefers plugin.json skills[]', (t) => {
  const dir = plugin(t, {
    '.claude-plugin/plugin.json': JSON.stringify({ skills: ['./skills/a', './skills/b/c', './skills/vazio'] }),
    'skills/a/SKILL.md': '',
    'skills/b/c/SKILL.md': '',
    'skills/vazio/README.md': '',
    'skills/fora/SKILL.md': '',
  })
  assert.equal(countSkills(dir), 2)
})

test('flat layout still works', (t) => {
  assert.equal(countSkills(plugin(t, { 'skills/a/SKILL.md': '' })), 1)
})

test('no skills dir', (t) => {
  assert.equal(countSkills(plugin(t, { 'README.md': '' })), 0)
})

test('ignores node_modules and .git', (t) => {
  const dir = plugin(t, {
    'skills/a/SKILL.md': '',
    'skills/node_modules/x/SKILL.md': '',
    'skills/.git/y/SKILL.md': '',
  })
  assert.equal(countSkills(dir), 1)
})
