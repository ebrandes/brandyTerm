/** Environment of a Claude run: this process's, plus the chosen account's own variables. */
export function claudeEnv(account: Record<string, string | undefined>, base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, ...account }
  if (account.CLAUDE_CODE_OAUTH_TOKEN === undefined) delete env.CLAUDE_CODE_OAUTH_TOKEN
  // TokenEconomizer's tool pruning writes deny rules into the repo's .claude/settings.local.json,
  // which these runs do not load (--setting-sources project): propose only, never edit the repo.
  env.TE_TOOLPRUNE ??= 'propose'
  return env
}
