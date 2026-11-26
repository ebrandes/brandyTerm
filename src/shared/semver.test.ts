import test from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, isNewer, parseVersion } from './semver.ts'

test('accepts a leading v and build metadata; rejects what is not a version', () => {
  assert.deepEqual(parseVersion('v1.2.3+build.5'), { core: [1, 2, 3], pre: [] })
  assert.deepEqual(parseVersion('1.2.3-beta.2'), { core: [1, 2, 3], pre: ['beta', '2'] })
  for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v1.x.0']) assert.equal(parseVersion(bad), null, bad)
})

test('compares the numbers as numbers', () => {
  assert.equal(isNewer('v0.10.0', '0.9.9'), true)
  assert.equal(isNewer('1.0.0', '0.99.0'), true)
  assert.equal(isNewer('0.1.1', '0.1.0'), true)
})

test('equal and locally newer versions are not an update', () => {
  assert.equal(isNewer('v0.1.0', '0.1.0'), false)
  assert.equal(isNewer('0.1.0+abc', '0.1.0'), false)
  assert.equal(isNewer('0.1.0', '0.2.0'), false)
})

test('pre-releases come before their final version and order by identifier', () => {
  assert.equal(isNewer('1.0.0', '1.0.0-rc.1'), true)
  assert.equal(isNewer('1.0.0-rc.1', '1.0.0'), false)
  const ordered = ['1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0']
  for (let i = 1; i < ordered.length; i++) assert.equal(compareVersions(ordered[i], ordered[i - 1]), 1, ordered[i])
})

test('an unreadable tag is never an update', () => {
  assert.equal(isNewer('nightly', '0.1.0'), false)
})
