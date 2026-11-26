#!/usr/bin/env node
// Downloads the Claude plugins BrandyTerm ships with into resources/plugins/<id>.
// Runs on `npm install` (postinstall). Each plugin is pinned to a commit so every
// install gets the same code. Already-fetched plugins at the right commit are skipped.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyPlugin, missingFiles } from './copy-plugin.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'plugins')
const manifest = JSON.parse(readFileSync(join(root, 'resources', 'plugins.json'), 'utf8'))

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()

let failed = 0
for (const p of manifest.plugins) {
  const target = join(dest, p.id)
  const stamp = join(target, '.brandyterm-commit')
  if (existsSync(stamp) && readFileSync(stamp, 'utf8').trim() === p.commit && !missingFiles(target, p.requires).length) {
    console.log(`[plugins] ${p.id} ok (${p.commit.slice(0, 7)})`)
    continue
  }
  const tmp = mkdtempSync(join(tmpdir(), `brandyterm-${p.id}-`))
  try {
    git(['init', '-q'], tmp)
    git(['remote', 'add', 'origin', p.repo], tmp)
    git(['fetch', '-q', '--depth', '1', 'origin', p.commit], tmp)
    git(['checkout', '-q', 'FETCH_HEAD'], tmp)
    const src = join(tmp, p.subdir ?? '.')
    if (!existsSync(join(src, '.claude-plugin', 'plugin.json'))) throw new Error('plugin.json não encontrado')
    rmSync(target, { recursive: true, force: true })
    const skipped = copyPlugin(tmp, src, target)
    if (skipped.length) console.warn(`[plugins] ${p.id}: links ignorados: ${skipped.join(', ')}`)
    const missing = missingFiles(target, p.requires)
    if (missing.length) throw new Error(`arquivos obrigatórios ausentes: ${missing.join(', ')}`)
    writeFileSync(stamp, p.commit + '\n')
    console.log(`[plugins] ${p.id} instalado (${p.commit.slice(0, 7)})`)
  } catch (err) {
    failed++
    console.warn(`[plugins] falha ao baixar ${p.id}: ${err.message}`)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
// never break `npm install`; the app falls back to Claude's plugin cache
if (failed) console.warn(`[plugins] ${failed} plugin(s) não baixado(s); rode \`npm run plugins\` de novo`)
