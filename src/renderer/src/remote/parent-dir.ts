// Folder navigation for the remote picker. Pure.

/** Parent of "~/a/b/" is "~/a/"; of "~/a/" is "~/"; of "/a/" is "/"; "~/" and "/" stay. */
export const parentDir = (p: string): string => {
  const bare = p.replace(/\/+$/, '')
  const parts = bare.split('/')
  if (parts.length <= 1) return bare === '~' ? '~/' : '/'
  const up = parts.slice(0, -1).join('/')
  return up ? `${up}/` : '/'
}
