import fs from 'node:fs'
import { app, dialog, shell, type BrowserWindow } from 'electron'
import { diagLogDir } from './diag-log.ts'
import type { Engine } from './engine.ts'
import { discoverPlugins, installPlugin } from './plugins.ts'
import { validAttachments } from './attachments.ts'
import { setUserPlugin, userPluginsState } from './user-plugins.ts'
import { registerSkillsIpc } from './skills-ipc.ts'
import { refreshSkills } from './skills/wiring.ts'
import { updateSettings } from './settings.ts'
import { registry } from './rpc/registry.ts'
import { ruleOf } from './rpc/channels.ts'
import { ownedProcess } from './owns-process.ts'
import type { AppSettings } from '../shared/types.ts'

export interface AppIpcDeps {
  engine: Engine
  getWin: () => BrowserWindow | null
  pushState: () => void
}

/** the app-level handlers: state, projects, chat, processes, plugins, settings, threads */
export function registerAppIpc({ engine, getWin, pushState }: AppIpcDeps): void {
  registry.add('state:get', () => engine.state, ruleOf('state:get'))
  registry.add('project:open-folder', async () => {
    const opts = { title: 'Abrir pasta como projeto', properties: ['openDirectory' as const] }
    const win = getWin()
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return engine.addProject(res.filePaths[0])
  }, ruleOf('project:open-folder'))
  registry.add('project:set-remote-hidden', (a: { projectId: string; hidden: boolean }) => {
    const p = engine.state.projects.find((x) => x.id === String(a.projectId))
    if (!p || p.demo) return
    p.remoteHidden = a.hidden ? true : undefined
    engine.touch()
  }, ruleOf('project:set-remote-hidden'))
  registry.add('chat:send', (a: { projectId: string; text: string; threadId?: string; attachments?: unknown }, ctx) =>
    engine.send(String(a.projectId), String(a.text ?? ''), a.threadId ? String(a.threadId) : undefined,
      validAttachments(a.attachments, ctx.remote ? String(a.projectId) : undefined)),
    ruleOf('chat:send'))
  registry.add('commands:list', (projectId: string) => engine.commands(String(projectId)), ruleOf('commands:list'))
  registry.add('process:start', (a: { projectId: string; name: string; command: string }) =>
    engine.startProcess(String(a.projectId), String(a.name ?? ''), String(a.command ?? '')),
    ruleOf('process:start'))
  // a project stops or removes only the processes it started (a remote caller names both ids)
  registry.add('process:stop', (a: unknown) => {
    const own = ownedProcess(engine.state.projects, a)
    if (own) engine.stopProcess(own.projectId, own.processId)
  }, ruleOf('process:stop'))
  registry.add('process:remove', (a: unknown) => {
    const own = ownedProcess(engine.state.projects, a)
    if (own) engine.removeProcess(own.projectId, own.processId)
  }, ruleOf('process:remove'))
  registry.add('process:open-port', (port: number) => {
    const n = Number(port)
    if (Number.isInteger(n) && n > 0 && n < 65536) void shell.openExternal(`http://localhost:${n}`)
  }, ruleOf('process:open-port'))
  registry.add('plugin:install', async (a: { id: string; force?: boolean }) => {
    const p = engine.state.plugins.find((x) => x.id === String(a.id))
    if (!p || p.dir || p.installing) return
    p.installing = true
    p.error = undefined
    p.review = undefined
    p.note = a.force ? 'instalando…' : 'Claude Security revisando o plugin…'
    engine.emit('change')
    const r = await installPlugin(p.id, !!a.force)
    const fresh = discoverPlugins()
    fresh.forEach((x) => {
      if (x.id !== p.id) return
      x.review = r.review
      if (!r.ok && !r.review?.blocked) x.error = r.error
    })
    engine.state.plugins = fresh
    engine.emit('change')
  }, ruleOf('plugin:install'))
  registry.add('plugin:open-report', (id: string) => {
    const report = engine.state.plugins.find((x) => x.id === String(id))?.review?.report
    if (report) void shell.openPath(report)
  }, ruleOf('plugin:open-report'))
  registry.add('logs:open', async () => {
    const dir = diagLogDir() ?? app.getPath('logs')
    fs.mkdirSync(dir, { recursive: true })
    // openPath answers with an error text instead of throwing (Windows Explorer, Finder, xdg-open)
    const err = await shell.openPath(dir)
    if (err) throw new Error(`Não foi possível abrir a pasta de logs: ${err}`)
  }, ruleOf('logs:open'))
  registry.add('thread:approve', (a: { projectId: string; threadId: string; id: string; decision: string }) => {
    const d = a.decision === 'allow' || a.decision === 'always' || a.decision === 'all' || a.decision === 'forever' ? a.decision : 'deny'
    engine.respondApproval(String(a.projectId), String(a.threadId), String(a.id), d)
  }, ruleOf('thread:approve'))
  registry.add('thread:allowAll', (a: { projectId: string; threadId: string; on: boolean }) => engine.setAllowAll(String(a.projectId), String(a.threadId), !!a.on), ruleOf('thread:allowAll'))
  registry.add('settings:set', (patch: Partial<AppSettings>) => {
    engine.state.settings = updateSettings(patch ?? {})
    engine.touch()
  }, ruleOf('settings:set'))
  registry.add('thread:resolve', (a: { projectId: string; threadId: string }) => engine.resolveThread(String(a.projectId), String(a.threadId)), ruleOf('thread:resolve'))
  registry.add('thread:retire', (a: { projectId: string; threadId: string }) => engine.retireThread(String(a.projectId), String(a.threadId)), ruleOf('thread:retire'))
  registry.add('thread:cancel', (a: { projectId: string; threadId: string }) =>
    engine.cancelThread(String(a.projectId), String(a.threadId)),
    ruleOf('thread:cancel'))
  registry.add('userPlugins:set', (a: { id: string; on: boolean }) => {
    setUserPlugin(String(a.id), !!a.on)
    engine.state.userPlugins = userPluginsState()
    // projects without a list follow thread-plugins.json
    refreshSkills(engine)
    pushState()
  }, ruleOf('userPlugins:set'))
  registerSkillsIpc(engine, pushState)
}
