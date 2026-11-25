import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import { join } from 'node:path'
import { sweepStaleSockets } from './socket-sweep.ts'

const posix = process.platform !== 'win32'
const touch = (dir: string, name: string) => fs.writeFileSync(join(dir, name), '')

test('removes sockets of other, dead pids and leaves everything else', { skip: !posix }, () => {
  const data = fs.mkdtempSync(join(os.tmpdir(), 'sw-data-'))
  const tmp = fs.mkdtempSync(join(os.tmpdir(), 'sw-tmp-'))
  for (const n of ['gw-111.sock', 'gw-222.sock', 'gw-333.sock', 'gw-abc.sock', 'gw-111.sock.bak', 'notes.txt']) touch(data, n)
  for (const n of ['bt-gw-111.sock', 'bt-gw-333.sock', 'other-gw-111.sock', 'x.sock']) touch(tmp, n)
  sweepStaleSockets(data, 333, tmp, pid => pid === 222)
  assert.deepEqual(fs.readdirSync(data).sort(), ['gw-222.sock', 'gw-333.sock', 'gw-abc.sock', 'gw-111.sock.bak', 'notes.txt'].sort())
  assert.deepEqual(fs.readdirSync(tmp).sort(), ['bt-gw-333.sock', 'other-gw-111.sock', 'x.sock'])
})

test('a missing folder is ignored', { skip: !posix }, () => {
  sweepStaleSockets('/nonexistent-dir-x', 1, '/nonexistent-dir-y', () => false)
})
