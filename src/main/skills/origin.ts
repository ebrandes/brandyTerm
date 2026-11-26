export interface GithubOrigin {
  kind: 'github'
  owner: string
  repo: string
  /** branch or tag from a `/tree/<ref>/…` URL */
  ref?: string
  /** folder inside the repo */
  sub?: string
}
export type Origin = GithubOrigin | { kind: 'catalog'; id: string }

const NAME = /^[A-Za-z0-9_.-]+$/
const ID = /^[A-Za-z0-9_.-]+(@[A-Za-z0-9_.-]+)?$/
const BAD = { erro: 'Origem inválida: use https://github.com/dono/repo, dono/repo[/pasta] ou um id do catálogo.' }

const safe = (seg: string) => NAME.test(seg) && seg !== '.' && seg !== '..'

function github(parts: string[], fromUrl: boolean): Origin | { erro: string } {
  const [owner, rawRepo, ...rest] = parts
  if (!owner || !rawRepo) return BAD
  const repo = rawRepo.replace(/\.git$/, '')
  if (!safe(owner) || !safe(repo)) return BAD
  const o: GithubOrigin = { kind: 'github', owner, repo }
  let tail = rest
  if (fromUrl && tail[0] === 'tree') {
    if (!tail[1] || !safe(tail[1])) return BAD
    o.ref = tail[1]
    tail = tail.slice(2)
  }
  if (tail.length) {
    if (!tail.every(safe)) return BAD
    o.sub = tail.join('/')
  }
  return o
}

/** Parses what the user gave `/skill-install`. Only GitHub over https, short `dono/repo` forms and catalog ids. */
export function parseOrigin(input: string): Origin | { erro: string } {
  const s = input.trim()
  if (!s) return BAD
  const url = /^https:\/\/(?:www\.)?github\.com\/(.+)$/.exec(s)
  if (url) return github(url[1].replace(/\/+$/, '').split('/'), true)
  if (/^[a-z]+:/i.test(s)) return BAD
  if (!s.includes('/')) return ID.test(s) ? { kind: 'catalog', id: s } : BAD
  return github(s.replace(/\/+$/, '').split('/'), false)
}
