/** How a saved permission reads in the chips: `Conector:<id>:<tool>` becomes `<Nome> · <tool>`. */
export function ruleLabel(rule: string, names: Record<string, string> = {}): string {
  const m = /^Conector:([^:]+):(.+)$/.exec(rule)
  if (m) return `${names[m[1]] ?? m[1]} · ${m[2]}`
  return rule.replace(/^Bash:/, '')
}
