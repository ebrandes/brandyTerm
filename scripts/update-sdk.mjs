#!/usr/bin/env node
// predev: refresh the Claude Agent SDK. Best effort and portable (no shell `|| true`,
// which cmd.exe on Windows does not understand); a failure never blocks `npm run dev`.
import { spawnSync } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
spawnSync(npm, ['update', '@anthropic-ai/claude-agent-sdk', '--no-audit', '--no-fund', '--silent'], {
  stdio: 'inherit',
  shell: process.platform === 'win32' // .cmd shims need a shell since Node's CVE-2024-27980 fix
})
