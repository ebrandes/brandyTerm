// Shared by the stores that keep small JSON files under userData.
import fs from 'node:fs'

export function writeAtomic(file: string, data: string, mode?: number): void {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, data, mode === undefined ? undefined : { mode })
  fs.renameSync(tmp, file)
}

/** A file that exists but cannot be used is copied to `<file>.corrupt-<time>` (same mode) before it is replaced. */
export function keepCorrupt(file: string, tag = 'remote'): void {
  if (!fs.existsSync(file)) return
  const copy = `${file}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`
  try {
    fs.copyFileSync(file, copy)
    fs.chmodSync(copy, fs.statSync(file).mode & 0o777)
    console.error(`[${tag}] ${file} inválido; cópia guardada em ${copy}`)
  } catch (e) {
    console.error(`[${tag}] ${file} inválido e não foi copiado:`, e instanceof Error ? e.message : e)
  }
}
