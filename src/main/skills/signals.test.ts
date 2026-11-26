import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { projectSignals } from './signals.ts'

function tmp(t: { after(fn: () => void): void }): string {
  const p = mkdtempSync(join(tmpdir(), 'sig-'))
  t.after(() => rmSync(p, { recursive: true, force: true }))
  return p
}

function write(root: string, files: Record<string, string>): void {
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), body)
  }
}

test('reads package.json deps, file types, the README start and local skills', (t) => {
  const root = tmp(t)
  write(root, {
    'package.json': JSON.stringify({ dependencies: { three: '1', react: '18' }, devDependencies: { typescript: '5' } }),
    'src/a.ts': '',
    'src/b.ts': '',
    'c.ts': '',
    'estilo.css': '',
    'README.md': 'x'.repeat(5000),
    '.claude/skills/x/SKILL.md': '# x',
    'node_modules/lib/index.ts': '',
    'dist/out.ts': '',
    'out/o.ts': '',
    'build/b.ts': '',
    '.git/x.ts': '',
    '.brandyterm/tmp/skill-install/o-r/z.ts': '',
  })
  const s = projectSignals(root)
  for (const d of ['three', 'react', 'typescript']) assert.ok(s.deps.includes(d), d)
  assert.equal(s.arquivos['.ts'], 3)
  assert.equal(s.arquivos['.css'], 1)
  assert.equal(s.readme.length, 2000)
  assert.deepEqual(s.skillsLocais, ['x'])
})

test('reads Python, Rust and Go dependencies from their own sections only', (t) => {
  const root = tmp(t)
  write(root, {
    'requirements.txt': '# comentário\nnumpy>=1.2\npandas==2.0 ; python_version > "3"\n-r outros.txt\nrequests[socks]\n\n',
    'pyproject.toml': '[project]\nname = "x"\ndependencies = [\n  "fastapi>=0.1",\n  "pydantic",\n]\n\n[tool.x]\ndependencies = ["naoconta"]\n',
    'Cargo.toml': '[package]\nname = "y"\n\n[dependencies]\nserde = "1"\ntokio = { version = "1" }\n\n[dev-dependencies]\nnaoconta2 = "1"\n',
    'go.mod': 'module m\n\ngo 1.22\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.9.0\n\tgolang.org/x/net v0.1.0 // indirect\n)\n\nrequire github.com/spf13/cobra v1.8.0\n',
  })
  const s = projectSignals(root)
  for (const d of ['numpy', 'pandas', 'requests', 'fastapi', 'pydantic', 'serde', 'tokio', 'github.com/gin-gonic/gin', 'golang.org/x/net', 'github.com/spf13/cobra']) {
    assert.ok(s.deps.includes(d), d)
  }
  for (const d of ['naoconta', 'naoconta2', '-r', 'name', 'x', 'y', 'm']) assert.equal(s.deps.includes(d), false, d)
})

test('a project with nothing, or a folder that does not exist, gives empty fields', (t) => {
  const empty = { deps: [], arquivos: {}, readme: '', skillsLocais: [] }
  assert.deepEqual(projectSignals(tmp(t)), empty)
  assert.deepEqual(projectSignals(join(tmp(t), 'nao-existe')), empty)
})

test('a broken package.json is skipped without a throw', (t) => {
  const root = tmp(t)
  write(root, { 'package.json': '{ quebrado', 'requirements.txt': 'flask\n' })
  assert.deepEqual(projectSignals(root).deps, ['flask'])
})

test('arquivos keeps the 10 most common extensions and stops at the file cap', (t) => {
  const root = tmp(t)
  const files: Record<string, string> = {}
  // .e0 has 12 files, .e1 has 11 ... .e11 has 1
  for (let i = 0; i < 12; i++) for (let j = 0; j < 12 - i; j++) files[`d${i}/f${j}.e${i}`] = ''
  write(root, files)
  const s = projectSignals(root)
  assert.equal(Object.keys(s.arquivos).length, 10)
  assert.equal(s.arquivos['.e0'], 12)
  assert.equal(s.arquivos['.e10'], undefined)
  assert.equal(s.arquivos['.e11'], undefined)
  const capped = projectSignals(root, 5)
  assert.equal(Object.values(capped.arquivos).reduce((a, b) => a + b, 0), 5)
})
