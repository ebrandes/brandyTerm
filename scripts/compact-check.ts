// Checks the coordinator context rule: node scripts/compact-check.ts
import assert from 'node:assert/strict'
import {
  COMPACT_RATIO,
  coordinatorAutocompact,
  coordinatorContext,
  coordinatorContextLimit,
  coordinatorLimit,
  coordinatorWarn,
  rotateAt,
  shouldCompact
} from '../src/shared/context-limit.ts'

assert.equal(coordinatorContextLimit, 300_000)

// the reported 1M window is clamped; a smaller window is kept; no report falls back to the ceiling
assert.equal(coordinatorLimit(1_000_000), 300_000)
assert.equal(coordinatorLimit(200_000), 200_000)
assert.equal(coordinatorLimit(undefined), 300_000)
assert.deepEqual(coordinatorContext({ used: 50_000, limit: 1_000_000 }), { used: 50_000, limit: 300_000 })
assert.deepEqual(coordinatorContext({ used: 50_000 }, { used: 1, limit: 1_000_000 }), { used: 50_000, limit: 300_000 })

// below the threshold it does not compact, at or above it does
const at = rotateAt()
assert.ok(at <= coordinatorContextLimit * COMPACT_RATIO)
assert.equal(shouldCompact(0), false)
assert.equal(shouldCompact(undefined), false)
assert.equal(shouldCompact(at - 1), false)
assert.equal(shouldCompact(at), true)
assert.equal(shouldCompact(coordinatorContextLimit), true)

// the 85% rule holds on its own when the limit is below the soft rotation
assert.equal(rotateAt(60_000), 51_000)
assert.equal(shouldCompact(50_999, 60_000), false)
assert.equal(shouldCompact(51_000, 60_000), true)

// the in-turn autocompact window stays below the limit
assert.ok(coordinatorAutocompact() < coordinatorContextLimit * COMPACT_RATIO)

// the footer warns at 3/4 of the way to the session swap
assert.equal(coordinatorWarn(at * 0.75 - 1), false)
assert.equal(coordinatorWarn(at * 0.75), true)

console.log(`ok: limite ${coordinatorContextLimit}, troca de sessão em ${at}, autocompact ${coordinatorAutocompact()}`)
