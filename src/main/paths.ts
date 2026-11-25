import { isAbsolute, relative, sep } from 'node:path'

/** true when `p` is strictly inside `root` (pass both resolved, or realpath'd when symlinks matter) */
export function inside(root: string, p: string): boolean {
  const rel = relative(root, p)
  return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}
