/** What a command line is, in words a person reads (pure). */

const INTERPRETERS = /^(node|nodejs|python[\d.]*|ruby|bun)(\.exe)?$/i
const MAX_LABEL = 60

export const baseName = (s: string): string => s.split(/[\\/]/).pop() || s

/** the words of a command line, quotes removed */
export function commandWords(command: string): string[] {
  // ps does not quote paths, and this macOS folder has a space
  const whole = command.replace(/\/Application Support\//g, '/ApplicationSupport/')
  return (whole.match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, ''))
}

/** "/x/bin/vite.js" → "vite" */
export const programName = (word: string): string => baseName(word).replace(/\.(m|c)?js$|\.(exe|cmd)$/i, '')

/** "…/bin/node …/astro/bin/astro.mjs preview" → "astro preview" */
export function procLabel(command: string): string {
  const words = commandWords(command)
  if (words.length > 1 && INTERPRETERS.test(baseName(words[0])) && !words[1].startsWith('-')) words.shift()
  if (words.length) {
    const isPath = /[\\/]/.test(words[0])
    words[0] = isPath ? programName(words[0]) : baseName(words[0])
  }
  const label = words.join(' ')
  return label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label
}

const RUNNERS = /^(npx|bunx)$/
const MANAGERS = /^(npm|pnpm|yarn|bun)$/

/** what really runs: past the interpreter (with its flags) and past npx / "npm exec" */
export function effectiveCommand(command: string): { program: string; args: string[] } {
  let words = commandWords(command)
  const first = () => programName(words[0] ?? '').toLowerCase()
  const dropFlags = () => {
    while (words[0]?.startsWith('-') && words[0] !== '-m') words = words.slice(1)
  }
  if (/^(node|nodejs|python[\d.]*|ruby|bun)$/.test(first()) && words.length > 1) {
    const interpreter = first()
    const rest = words.slice(1)
    words = rest
    dropFlags()
    if (words[0] === '-m') words = words.slice(1)
    // "bun run dev" is a script, and "node -e …" runs no program
    else if (interpreter === 'bun' && words[0] === 'run') words = ['bun', ...words]
    if (!words.length) words = [interpreter, ...rest]
  }
  // npm shows itself as "node …/npm-cli.js exec x"
  if (first() === 'npm-cli') words = ['npm', ...words.slice(1)]
  if (RUNNERS.test(first()) || (MANAGERS.test(first()) && /^(exec|dlx|x)$/.test(words[1] ?? ''))) {
    words = words.slice(RUNNERS.test(first()) ? 1 : 2)
    dropFlags()
  }
  const [head = '', ...args] = words
  return { program: programName(head).replace(/(?<=.)@[\w.-]+$/, '').toLowerCase(), args }
}

const sub = (args: string[], known: string[], fallback: string): string => args.find((a) => known.includes(a)) ?? fallback

const KINDS: Record<string, (args: string[]) => string | undefined> = {
  astro: (a) => `Astro ${sub(a, ['preview', 'dev', 'build'], 'dev')}`,
  vite: (a) => `Vite ${sub(a, ['preview', 'dev', 'build'], 'dev')}`,
  next: (a) => `Next ${sub(a, ['dev', 'start', 'build'], 'dev')}`,
  'next-server': () => 'Next server',
  nuxt: (a) => `Nuxt ${sub(a, ['preview', 'dev', 'build'], 'dev')}`,
  nuxi: (a) => `Nuxt ${sub(a, ['preview', 'dev', 'build'], 'dev')}`,
  'http-server': () => 'http-server',
  serve: () => 'serve',
  webpack: (a) => (a.includes('serve') ? 'Webpack serve' : 'Webpack'),
  'webpack-dev-server': () => 'Webpack serve',
  nodemon: () => 'nodemon',
  tsc: (a) => (a.includes('--watch') || a.includes('-w') ? 'tsc watch' : undefined),
  storybook: () => 'Storybook',
  wrangler: (a) => (a.includes('dev') ? 'Wrangler dev' : undefined),
  'http.server': () => 'Python http.server',
  uvicorn: () => 'Uvicorn',
  php: (a) => (a.includes('-S') ? 'Servidor PHP' : undefined),
  rails: (a) => (a[0] === 'server' || a[0] === 's' ? 'Rails server' : undefined)
}

/** the name of a known dev tool or package script; undefined for anything else */
export function knownKind(command: string): string | undefined {
  const { program, args } = effectiveCommand(command)
  if (MANAGERS.test(program)) {
    if (args[0] === 'run' && args[1]) return `${program} run ${args[1]}`
    return ['start', 'dev', 'test'].includes(args[0] ?? '') ? `${program} ${args[0]}` : undefined
  }
  return Object.hasOwn(KINDS, program) ? KINDS[program](args) : undefined
}

export const procKind = (command: string): string => knownKind(command) ?? procLabel(command)

/** how long it has been running; '' when the system did not tell */
export function uptimeLabel(startedAt: number | undefined, now: number): string {
  if (startedAt === undefined || !Number.isFinite(startedAt)) return ''
  const minutes = Math.floor(Math.max(0, now - startedAt) / 60_000)
  if (minutes < 1) return 'há menos de 1 min'
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return minutes % 60 ? `há ${hours} h ${minutes % 60} min` : `há ${hours} h`
  return `há ${Math.floor(hours / 24)} d`
}
