// Test fixture: a PATH dir like npm's global bin on Windows, where `railway` is a .cmd shim pointing at the real script.
import fs from 'node:fs'
import os from 'node:os'
import { dirname, join } from 'node:path'

export function fakeNpmBin(): { dir: string; js: string } {
  const dir = fs.mkdtempSync(join(os.tmpdir(), 'shim-'))
  const js = join(dir, 'node_modules', '@railway', 'cli', 'bin', 'railway.js')
  fs.mkdirSync(dirname(js), { recursive: true })
  fs.writeFileSync(js, '')
  fs.writeFileSync(join(dir, 'railway.cmd'), `@ECHO off\r\nSETLOCAL\r\nSET "_prog=node"\r\n"%_prog%"  "${js}" %*\r\n`)
  return { dir, js }
}
