import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { copyPlugin, missingFiles } from '../../scripts/copy-plugin.mjs'

/** a cloned repo laid out like TokenEconomizer: the plugin links to a library outside its folder */
function fakeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'brandy-copy-'))
  const repo = join(root, 'repo')
  mkdirSync(join(repo, 'src', 'lib', 'plugin'), { recursive: true })
  mkdirSync(join(repo, 'plugin', 'lib'), { recursive: true })
  mkdirSync(join(repo, '.git'), { recursive: true })
  writeFileSync(join(repo, '.git', 'config'), 'x')
  writeFileSync(join(repo, 'src', 'lib', 'plugin', 'hook.py'), 'print(1)\n')
  writeFileSync(join(root, 'secret.txt'), 'fora do repositório')
  symlinkSync('../../src/lib', join(repo, 'plugin', 'lib', 'tokeneconomizer'))
  return { root, repo, out: join(root, 'out') }
}

test('a link to another folder of the repo becomes a real copy that survives the clone', () => {
  const { root, repo, out } = fakeRepo()
  copyPlugin(repo, join(repo, 'plugin'), out)
  rmSync(repo, { recursive: true })
  const hook = join(out, 'lib', 'tokeneconomizer', 'plugin', 'hook.py')
  assert.equal(readFileSync(hook, 'utf8'), 'print(1)\n')
  assert.equal(lstatSync(join(out, 'lib', 'tokeneconomizer')).isSymbolicLink(), false)
  assert.deepEqual(missingFiles(out, ['lib/tokeneconomizer/plugin/hook.py']), [])
  rmSync(root, { recursive: true })
})

test('links that leave the repo, reach .git, loop or are broken are skipped', () => {
  const { root, repo, out } = fakeRepo()
  const plugin = join(repo, 'plugin')
  symlinkSync(join(root, 'secret.txt'), join(plugin, 'planted'))
  symlinkSync('../.git/config', join(plugin, 'gitconfig'))
  symlinkSync('.', join(plugin, 'loop'))
  symlinkSync('nowhere', join(plugin, 'broken'))
  const skipped = copyPlugin(repo, plugin, out)
  assert.deepEqual(skipped.sort(), ['broken', 'gitconfig', 'loop', 'planted'])
  for (const name of skipped) assert.equal(existsSync(join(out, name)), false)
  rmSync(root, { recursive: true })
})

test('a missing or dangling required file is reported', () => {
  const { root, out } = fakeRepo()
  mkdirSync(join(out, 'lib'), { recursive: true })
  symlinkSync('/nao/existe', join(out, 'lib', 'tokeneconomizer'))
  assert.deepEqual(missingFiles(out, ['lib/tokeneconomizer/plugin/hook.py']), ['lib/tokeneconomizer/plugin/hook.py'])
  rmSync(root, { recursive: true })
})
