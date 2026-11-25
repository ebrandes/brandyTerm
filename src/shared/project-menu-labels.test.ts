import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyablePath, folderOs, revealLabel } from './project-menu-labels.ts'

test('revealLabel names the file manager of each platform', () => {
  assert.equal(revealLabel('darwin'), 'Abrir no Finder')
  assert.equal(revealLabel('win32'), 'Abrir no Explorador de Arquivos')
  assert.equal(revealLabel('linux'), 'Abrir pasta')
  assert.equal(revealLabel('freebsd'), 'Abrir pasta')
  assert.equal(revealLabel(undefined), 'Abrir pasta')
})

test('folderOs is the owning machine for a remote project and this one otherwise', () => {
  assert.equal(folderOs(undefined, 'win32'), 'windows')
  assert.equal(folderOs(undefined, 'darwin'), 'mac')
  assert.equal(folderOs({ os: 'mac', remote: true }, 'win32'), 'mac')
  assert.equal(folderOs({ os: 'windows', remote: true }, 'darwin'), 'windows')
  assert.equal(folderOs({ os: 'mac', remote: false }, 'win32'), 'windows')
})

test('copyablePath uses backslashes for a Windows folder and leaves other paths alone', () => {
  assert.equal(copyablePath('C:\\Users\\ana\\proj', 'windows'), 'C:\\Users\\ana\\proj')
  assert.equal(copyablePath('C:/Users/ana/proj', 'windows'), 'C:\\Users\\ana\\proj')
  assert.equal(copyablePath('\\\\srv\\share/proj', 'windows'), '\\\\srv\\share\\proj')
  assert.equal(copyablePath('/Users/ana/proj', 'mac'), '/Users/ana/proj')
  assert.equal(copyablePath('/home/ana/a\\b', 'linux'), '/home/ana/a\\b')
})
