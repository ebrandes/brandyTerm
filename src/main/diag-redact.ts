// Turns anything handed to diagLog into JSON-safe data with the secrets removed.
const HIDDEN = '[oculto]'
const MAX_STRING = 4000
const MAX_SCAN = 100_000
const MAX_ITEMS = 100
const MAX_DEPTH = 6

const SECRET_NAME = /token|key|secret|passw(or)?d|passphrase|authorization|cookie|credential/i
// Containers whose names are worth knowing but whose values never are.
const OPAQUE_NAME = /^(env|environment|headers)$|[a-z](Env|Headers)$/i
const WORD = '(?:token|secret|passw(?:or)?d|passphrase|authorization|credential|api[-_]?key|key)'

const PATTERNS: [RegExp, string][] = [
  [/\b(Bearer)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${HIDDEN}`],
  [/\b(Basic)\s+[A-Za-z0-9+/=_-]{8,}/g, `$1 ${HIDDEN}`],
  [/\bsk-[A-Za-z0-9_-]{8,}/g, HIDDEN],
  [/\b(gh[pousr]_[A-Za-z0-9]{10,}|github_pat_\w{10,}|glpat-[\w-]{10,}|xox[abposr]-[\w-]{10,})/g, HIDDEN],
  [/\b(AKIA[0-9A-Z]{16}|AIza[\w-]{30,})/g, HIDDEN],
  [/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]{6,}/g, HIDDEN],
  [/([a-z][a-z0-9+.-]{1,20}:\/\/)[^/\s"']{1,300}@/gi, `$1${HIDDEN}@`],
  [/\b((?:set-)?cookie["']?\s*:\s*)[^\r\n"']+/gi, `$1${HIDDEN}`],
  // --token abc, --api-key=abc
  [new RegExp(`(--[\\w-]{0,40}${WORD}[\\w-]{0,40}[ =]+)("[^"]*"|'[^']*'|[^\\s"']+)`, 'gi'), `$1${HIDDEN}`],
  // API_KEY=abc, "client_secret":"abc", ?access_token=abc, password: abc
  [new RegExp(`(${WORD}["']?\\s{0,4}[:=]\\s{0,4})("[^"]*"|'[^']*'|[^\\s"'&,;}\\[]+)`, 'gi'), `$1${HIDDEN}`]
]

// Values this process was given as secrets, hidden even when they appear with no label around them.
function envSecrets(): string[] {
  return Object.entries(process.env)
    .filter(([name, value]) => SECRET_NAME.test(name) && !!value && value.length >= 8)
    .map(([, value]) => value as string)
}

function redactText(text: string, secrets: string[]): string {
  let out = text.slice(0, MAX_SCAN)
  for (const value of secrets) out = out.replaceAll(value, HIDDEN)
  for (const [pattern, replacement] of PATTERNS) out = out.replace(pattern, replacement)
  // Cut only now: cutting first could leave half a secret that no pattern recognizes.
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[cortado]` : out
}

const hide = (value: unknown): unknown => {
  if (!value || typeof value !== 'object') return HIDDEN
  return Object.fromEntries(Object.keys(value).slice(0, MAX_ITEMS).map(k => [k, HIDDEN]))
}

/** `extra`: values known to be secret (a connector's env and headers), hidden wherever they appear */
export function createRedactor(extra: string[] = []): { text(s: string): string; value(v: unknown): unknown } {
  const secrets = [...envSecrets(), ...extra.filter(v => typeof v === 'string' && v.length >= 4)]
    .sort((a, b) => b.length - a.length)
  const seen = new Set<object>()

  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === 'string') return redactText(v, secrets)
    if (typeof v === 'bigint') return String(v)
    if (typeof v === 'function' || typeof v === 'symbol') return `[${typeof v}]`
    if (!v || typeof v !== 'object') return v
    if (ArrayBuffer.isView(v)) return `[${v.byteLength} bytes]`
    if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
    if (seen.has(v)) return '[circular]'
    if (depth >= MAX_DEPTH) return '[fundo demais]'
    seen.add(v)
    try {
      if (Array.isArray(v)) return v.slice(0, MAX_ITEMS).map(item => walk(item, depth + 1))
      if (v instanceof Map) return fields([...v].map(([k, x]) => [String(k), x]), depth)
      if (v instanceof Set) return walk([...v], depth + 1)
      if (v instanceof Error) {
        const own = Object.entries(v)
        const base: [string, unknown][] = [['name', v.name], ['message', v.message], ['stack', v.stack]]
        if (v.cause !== undefined) base.push(['cause', v.cause])
        return fields([...base, ...own], depth)
      }
      return fields(Object.entries(v), depth)
    } finally {
      seen.delete(v)
    }
  }

  const fields = (entries: [string, unknown][], depth: number): Record<string, unknown> =>
    Object.fromEntries(entries.slice(0, MAX_ITEMS).map(([k, x]) => {
      if (x === undefined || x === null) return [k, x]
      if (OPAQUE_NAME.test(k)) return [k, hide(x)]
      return [k, SECRET_NAME.test(k) ? HIDDEN : walk(x, depth + 1)]
    }))

  return {
    text: s => redactText(String(s), secrets),
    value: v => walk(v, 0)
  }
}
