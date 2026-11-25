// What the client does with bytes a remote machine sent. Pure: a file from another machine is never executed.
import { extname, join } from 'node:path'

/** Passive formats the system opens without running anything. */
export const OPENABLE = new Set(
  'png jpg jpeg gif webp svg pdf txt md json csv html htm mp4 mov webm mp3 wav m4a'.split(' ')
)

const NAME_CAP = 120

/** A file name that cannot leave its folder: no separators, no `..`, no control chars. */
export function safeName(name: unknown): string {
  const last = String(name ?? '').split(/[\\/]/).pop() ?? ''
  const clean = last.replace(/[\x00-\x1f\x7f]/g, '').replace(/\.{2,}/g, '.').trim()
  const capped = clean.slice(-NAME_CAP)
  return capped === '' || capped === '.' ? 'arquivo' : capped
}

/** 'open' only for the allowlist; anything else (apps, scripts, no extension) is just shown in its folder. */
export function openDecision(name: string): 'open' | 'reveal' {
  return OPENABLE.has(extname(name).slice(1).toLowerCase()) ? 'open' : 'reveal'
}

/** <tmp>/brandyterm-remote/<machineId>/<name>; machineId must be the trusted id from the hosts list. */
export function targetPath(tmp: string, machineId: string, name: unknown): string {
  return join(tmp, 'brandyterm-remote', machineId, safeName(name))
}
