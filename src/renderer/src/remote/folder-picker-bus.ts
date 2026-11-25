// Lets the routed api ask the UI for a folder on another machine. No DOM/Electron.

interface Request { machineId: string; resolve: (projectId: string | null) => void }

let handler: ((r: Request) => void) | null = null

/** The id (namespaced) of the project the user opened on that machine, or null when cancelled. */
export function requestRemoteFolder(machineId: string): Promise<string | null> {
  return new Promise(resolve => {
    if (handler) handler({ machineId, resolve })
    else resolve(null)
  })
}

/** The one component that shows the picker (App) registers here; returns its cleanup. */
export function onRemoteFolderRequest(cb: (r: Request) => void): () => void {
  handler = cb
  return () => { if (handler === cb) handler = null }
}
