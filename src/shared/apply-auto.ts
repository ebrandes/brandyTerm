// Which files of a change to BrandyTerm itself only take effect by restarting the app. Only those
// make the apply queue wait for the user (main/apply-queue.ts).

/** bundled into the main process or the preload (src/shared goes into both) */
const FOLDERS = /^src\/(main|preload|shared)\//
/** at the root of the repository: dependencies and the build setup */
const ROOT_FILES = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|(electron\.vite\.config|electron-builder)\.[^/]+|tsconfig[^/]*\.json)$/

/** `files` as git lists them: relative to the repository root, with `/` */
export const restartFiles = (files: string[]): string[] =>
  files.filter((f) => {
    const path = f.toLowerCase()
    return FOLDERS.test(path) || ROOT_FILES.test(path)
  })
