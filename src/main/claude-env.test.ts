import { test } from 'node:test'
import assert from 'node:assert/strict'
import { claudeEnv } from './adapters/claude-env.ts'

test('tool pruning only proposes, unless the user chose otherwise', () => {
  assert.equal(claudeEnv({}, {}).TE_TOOLPRUNE, 'propose')
  assert.equal(claudeEnv({}, { TE_TOOLPRUNE: 'off' }).TE_TOOLPRUNE, 'off')
})

test('the subscription token comes only from the chosen account', () => {
  assert.equal(claudeEnv({}, { CLAUDE_CODE_OAUTH_TOKEN: 'herdado' }).CLAUDE_CODE_OAUTH_TOKEN, undefined)
  assert.equal(claudeEnv({ CLAUDE_CODE_OAUTH_TOKEN: 'da-conta' }, {}).CLAUDE_CODE_OAUTH_TOKEN, 'da-conta')
})
