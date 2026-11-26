import { test } from 'node:test'
import assert from 'node:assert/strict'
import { restartFiles } from './apply-auto.ts'

test('renderer, docs, README and images do not need a restart', () => {
  const files = [
    'src/renderer/x.tsx', 'src/renderer/src/main.tsx', 'docs/guia.md', 'docs/package.json', 'README.md',
    'README.pt-BR.md', 'docs/img/tela.png', 'resources/icon.png', 'scripts/check.ts'
  ]
  assert.deepEqual(restartFiles(files), [])
})

test('main, preload, shared, package.json, dependencies and build config need a restart', () => {
  const files = [
    'src/main/x.ts', 'src/main/connectors/gateway.ts', 'src/preload/index.ts', 'src/shared/types.ts', 'package.json',
    'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'electron.vite.config.ts',
    'tsconfig.json', 'tsconfig.node.json', 'electron-builder.yml', 'SRC/Main/x.ts', 'Package.json'
  ]
  assert.deepEqual(restartFiles(['README.md', ...files]), files)
})
