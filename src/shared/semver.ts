/** The part of semver the update notice needs: parsing and precedence (build metadata is ignored). */

export interface Version {
  core: number[]
  pre: string[]
}

const PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

export function parseVersion(text: string): Version | null {
  const m = PATTERN.exec(text.trim())
  if (!m) return null
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

function compareIdentifier(a: string, b: string): number {
  const numA = /^\d+$/.test(a)
  const numB = /^\d+$/.test(b)
  if (numA && numB) return Math.sign(Number(a) - Number(b))
  // numeric identifiers come before alphanumeric ones
  if (numA !== numB) return numA ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

function comparePre(a: string[], b: string[]): number {
  // a final version comes after any of its pre-releases
  if (!a.length || !b.length) return Math.sign(b.length - a.length)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = compareIdentifier(a[i], b[i])
    if (c) return c
  }
  return Math.sign(a.length - b.length)
}

/** -1, 0 or 1; unreadable versions count as equal */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a)
  const y = parseVersion(b)
  if (!x || !y) return 0
  for (let i = 0; i < 3; i++) {
    if (x.core[i] !== y.core[i]) return Math.sign(x.core[i] - y.core[i])
  }
  return comparePre(x.pre, y.pre)
}

export const isNewer = (candidate: string, current: string): boolean => compareVersions(candidate, current) > 0
