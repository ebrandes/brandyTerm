export type ArtifactKind = 'md' | 'mermaid' | 'html' | 'svg' | 'code'
export type MediaKind = 'video' | 'image'

/** an artifact read for the viewer; a file outside the project or gone reads as missing */
export type ArtifactContent =
  | { kind: 'missing' }
  | { kind: 'too-big'; size: number }
  | { kind: MediaKind; size: number }
  | { kind: ArtifactKind; text: string; lang?: string }
