import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loginUrlProblem } from './login-url.ts'

test('https is opened', () => {
  assert.equal(loginUrlProblem('https://auth.example.com/authorize?x=1'), null)
  assert.equal(loginUrlProblem('HTTPS://auth.example.com/'), null)
})

test('http is opened only on this machine', () => {
  for (const u of ['http://localhost:3000/auth', 'http://127.0.0.1:8080/auth', 'http://[::1]:9000/auth']) assert.equal(loginUrlProblem(u), null, u)
})

test('http to another host is refused', () => {
  assert.equal(loginUrlProblem('http://auth.example.com/authorize'), 'Endereço de login inválido: http')
  assert.equal(loginUrlProblem('http://localhost.evil.com/auth'), 'Endereço de login inválido: http')
  assert.equal(loginUrlProblem('http://127.0.0.1.nip.io/auth'), 'Endereço de login inválido: http')
})

test('file and UNC-like file URLs are refused', () => {
  assert.equal(loginUrlProblem('file:///etc/passwd'), 'Endereço de login inválido: file')
  assert.equal(loginUrlProblem('file://host/share/run.exe'), 'Endereço de login inválido: file')
})

test('a custom app scheme is refused', () => {
  assert.equal(loginUrlProblem('vscode://some.extension/run'), 'Endereço de login inválido: vscode')
  assert.equal(loginUrlProblem('ms-msdt:/id PCWDiagnostic'), 'Endereço de login inválido: ms-msdt')
})

test('something that is not a URL is refused', () => {
  assert.match(loginUrlProblem('not a url') ?? '', /^Endereço de login inválido/)
})
