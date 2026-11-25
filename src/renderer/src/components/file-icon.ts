import { Clapperboard, FileCode, FileText, Globe, Image, Workflow, type LucideIcon } from 'lucide-react'

const ICONS: [RegExp, LucideIcon][] = [
  [/\.(md|markdown)$/i, FileText],
  [/\.(mmd|mermaid)$/i, Workflow],
  [/\.html?$/i, Globe],
  [/\.(svg|png|jpe?g|gif|webp|avif)$/i, Image],
  [/\.(mp4|m4v|mov|webm)$/i, Clapperboard]
]

/** The icon for a file, by extension; code is the fallback. */
export const iconOf = (path: string): LucideIcon => ICONS.find(([re]) => re.test(path))?.[1] ?? FileCode
