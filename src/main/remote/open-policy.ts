// What the client does with bytes a remote machine sent. Pure: a file from another machine is never executed.
import { createHash } from 'node:crypto'
import { extname, join, resolve } from 'node:path'
import { inside } from '../paths.ts'

/** Passive formats the system opens without running anything (html/svg can script, so they are only revealed). */
export const OPENABLE = new Set('png jpg jpeg gif webp pdf txt md json csv mp4 mov webm mp3 wav m4a'.split(' '))

const NAME_CAP = 120
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

/** A file name that cannot leave its folder or mean something to the OS: no separators, `..`, control/bidi chars, Windows-reserved. */
export function safeName(name: unknown): string {
  const last = String(name ?? '').split(/[\\/]/).pop() ?? ''
  let clean = last
    .replace(/[\x00-\x1f\x7f‎‏‪-‮⁦-⁩]/g, '')
    .replace(/[<>:"|?*]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/[. ]+$/, '')
    .trim()
  if (!clean) clean = 'arquivo'
  if (RESERVED.test(clean.split('.')[0].trim())) clean = `_${clean}`
  return clean.slice(-NAME_CAP)
}

/** 'open' only for the allowlist; anything else (apps, scripts, html, no extension) is just shown in its folder. */
export function openDecision(name: string): 'open' | 'reveal' {
  return OPENABLE.has(extname(name).slice(1).toLowerCase()) ? 'open' : 'reveal'
}

/** The machine id is chosen by the peer: it never becomes a path segment, only its hash does. */
export const machineDir = (machineId: string): string => createHash('sha256').update(machineId).digest('hex').slice(0, 16)

/** <base>/<hash of machineId>/<safe name>; throws if the result is not strictly inside `base`. */
export function targetPath(base: string, machineId: string, name: unknown): string {
  const root = resolve(base)
  const file = resolve(join(root, machineDir(machineId), safeName(name)))
  if (!inside(root, file)) throw new Error('Caminho inválido')
  return file
}
