import type { RemoteRule } from './registry.ts'

/** remote rule of every IPC channel; registrations take theirs from here */
export const RULES = {
  'state:get': 'pass',
  'chat:send': 'pass',
  'commands:list': 'pass',
  'fs:list': 'pass',
  'thread:cancel': 'pass',
  'thread:approve': 'pass',
  'thread:resolve': 'pass',
  'thread:allowAll': 'pass',
  'archive:list': 'pass',
  'archive:reopen': 'pass',
  'artifact:read': 'pass',
  'process:start': 'pass',
  'process:stop': 'pass',
  'process:remove': 'pass',
  'attach:save': 'pass',
  'userPlugins:set': 'pass',
  'project:remove': 'pass',
  // local-only: the remote variant arrives with the remote file/open work
  'project:open-folder': 'local-only',
  'attach:open': 'local-only',
  'artifact:open': 'local-only',
  'process:open-port': 'local-only',
  'term:open': 'terminal',
  'term:write': 'terminal',
  'term:resize': 'terminal',
  'term:kill': 'terminal',
  'settings:set': 'deny',
  'plugin:install': 'deny',
  'plugin:open-report': 'deny',
  'accounts:activate': 'deny',
  'accounts:auto': 'deny',
  'accounts:rename': 'deny',
  'accounts:remove': 'deny',
  'accounts:probe': 'deny',
  'accounts:add-token': 'deny',
  'accounts:login-start': 'deny',
  'accounts:login-cancel': 'deny',
  'clipboard:read': 'deny',
  'clipboard:write': 'deny',
  // pairing and device management never run on behalf of a remote
  'remote:hosts': 'deny',
  'remote:call': 'deny',
  'remote:open-pairing': 'deny',
  'remote:close-pairing': 'deny',
  'remote:devices': 'deny',
  'remote:revoke': 'deny',
  'remote:set-terminal': 'deny',
  'remote:discovered': 'deny',
  'remote:pair': 'deny',
  'remote:rename': 'deny'
} as const satisfies Record<string, RemoteRule>

export type Channel = keyof typeof RULES

export const EXPECTED_CHANNELS: string[] = Object.keys(RULES)

export const ruleOf = (c: Channel): RemoteRule => RULES[c]
