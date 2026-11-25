import { join, resolve } from 'node:path'
import { inside } from './paths.ts'

/** Folder name of a project's attachments under the attachments root. */
export const projectDirName = (projectId: string): string => projectId.replace(/[^\w-]/g, '_')

/** true when `p` is inside the attachments folder of `projectId` only (what a remote caller may reference). */
export function insideProjectFolder(root: string, projectId: string, p: string): boolean {
  return inside(join(root, projectDirName(projectId)), resolve(p))
}
