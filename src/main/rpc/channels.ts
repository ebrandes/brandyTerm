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
  'thread:report': 'pass',
  'thread:retire': 'pass',
  'thread:allowAll': 'pass',
  'archive:list': 'pass',
  'archive:reopen': 'pass',
  'artifact:read': 'pass',
  'artifact:diff': 'pass',
  'process:start': 'pass',
  'process:stop': 'pass',
  'process:remove': 'pass',
  'attach:save': 'pass',
  'userPlugins:set': 'pass',
  'project:remove': 'pass',
  'project:rename': 'pass',
  'project:archive': 'pass',
  'project:clear-context': 'pass',
  // local disk only on the host: a remote client reaches these through their remote variants (remote-calls.ts)
  'fs:browse': 'pass',
  'project:add-path': 'pass',
  'attach:read': 'pass',
  'artifact:bytes': 'pass',
  // local-only: the remote variant arrives with the remote file/open work
  'project:open-folder': 'local-only',
  'project:reveal': 'local-only',
  'attach:open': 'local-only',
  'artifact:open': 'local-only',
  'process:open-port': 'local-only',
  'process:detected': 'local-only',
  'term:open': 'terminal',
  'term:write': 'terminal',
  'term:resize': 'terminal',
  'term:kill': 'terminal',
  'settings:set': 'deny',
  // approving changes this machine's project folders: only its own user does it
  'apply:approve': 'deny',
  'apply:cancel': 'deny',
  'apply:retry': 'deny',
  // the switch can install a plugin, and the library is this machine's
  'skills:toggle': 'deny',
  'skills:installMissing': 'deny',
  'skills:setLibrary': 'deny',
  // only the owner decides which projects other machines may see
  'project:set-remote-hidden': 'deny',
  'plugin:install': 'deny',
  'plugin:open-report': 'deny',
  // the diagnostic logs folder of this machine
  'logs:open': 'deny',
  // spend of every project of this machine, hidden ones included
  'usage:report': 'deny',
  'accounts:activate': 'deny',
  'accounts:auto': 'deny',
  'accounts:rename': 'deny',
  'accounts:remove': 'deny',
  'accounts:probe': 'deny',
  'accounts:add-token': 'deny',
  'accounts:login-start': 'deny',
  'accounts:login-cancel': 'deny',
  // connectors are installed, configured and logged in only on the machine they belong to
  'connectors:presets': 'deny',
  'connectors:add': 'deny',
  'connectors:update': 'deny',
  'connectors:remove': 'deny',
  'connectors:enable': 'deny',
  'connectors:test': 'deny',
  'connectors:login': 'deny',
  'connectors:login-cancel': 'deny',
  'connectors:revoke-always': 'deny',
  'connectors:import-list': 'deny',
  'connectors:import': 'deny',
  'clipboard:read': 'deny',
  'clipboard:write': 'deny',
  // pairing and device management never run on behalf of a remote
  'remote:hosts': 'deny',
  'remote:states': 'deny',
  'remote:call': 'deny',
  'remote:open-pairing': 'deny',
  'remote:close-pairing': 'deny',
  'remote:devices': 'deny',
  'remote:revoke': 'deny',
  'remote:set-terminal': 'deny',
  'remote:discovered': 'deny',
  'remote:discover': 'deny',
  'remote:pair': 'deny',
  'remote:rename': 'deny',
  'remote:open-bytes': 'deny',
  'remote:status': 'deny',
  // notifications are about this machine's window
  'notify:view': 'deny',
  'notify:take-target': 'deny'
} as const satisfies Record<string, RemoteRule>

export type Channel = keyof typeof RULES

/** registered on the host but reached only through remote:call, so the preload never invokes them */
export const REMOTE_ONLY: string[] = ['fs:browse', 'project:add-path', 'attach:read', 'artifact:bytes']

export const EXPECTED_CHANNELS: string[] = Object.keys(RULES)

export const ruleOf = (c: Channel): RemoteRule => RULES[c]
