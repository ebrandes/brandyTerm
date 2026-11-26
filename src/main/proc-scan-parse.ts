/** Parsers of what the system tools print (pure). */
import type { ProcEntry, ProcSnapshot } from '../shared/proc-attribution.ts'

/** `lsof -F` output: a `p<pid>` line, then the `n<name>` lines of its files */
function lsofNames(out: string, each: (pid: number, name: string) => void): void {
  let pid = 0
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid > 0) each(pid, line.slice(1))
  }
}

function addPort(ports: Map<number, number[]>, pid: number, port: number): void {
  if (!(pid > 0 && port > 0 && port < 65536)) return
  const list = ports.get(pid) ?? []
  if (!list.includes(port)) ports.set(pid, [...list, port].sort((a, b) => a - b))
}

export function parseLsofPorts(out: string): Map<number, number[]> {
  const ports = new Map<number, number[]>()
  // "*:80", "127.0.0.1:80", "[::1]:80": the port follows the last colon
  lsofNames(out, (pid, name) => addPort(ports, pid, Number(name.slice(name.lastIndexOf(':') + 1))))
  return ports
}

export function parseLsofCwds(out: string): Map<number, string> {
  const cwds = new Map<number, string>()
  lsofNames(out, (pid, name) => cwds.set(pid, name))
  return cwds
}

/** `ps -axww -o pid=,ppid=,pgid=,tpgid=,command=` */
export function parsePs(out: string): ProcEntry[] {
  return out.split('\n').flatMap((line) => {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(-?\d+)\s+(.*\S)/.exec(line)
    return m ? [{ pid: +m[1], ppid: +m[2], pgid: +m[3], tpgid: +m[4], command: m[5] }] : []
  })
}

interface WinPort { LocalPort: number; OwningProcess: number }
interface WinProc { ProcessId: number; ParentProcessId: number; Name?: string | null; CommandLine?: string | null }

/** ConvertTo-Json writes a lone item as an object, not as an array */
const listOf = <T>(v: T | T[] | null | undefined): T[] => (v == null ? [] : Array.isArray(v) ? v : [v])

export function parseWindows(out: string): ProcSnapshot {
  const raw = JSON.parse(out.replace(/^﻿/, '')) as { ports?: WinPort | WinPort[]; procs?: WinProc | WinProc[] }
  const ports = new Map<number, number[]>()
  for (const p of listOf(raw.ports)) addPort(ports, p.OwningProcess, p.LocalPort)
  const procs = listOf(raw.procs).map((p) => ({
    pid: p.ProcessId, ppid: p.ParentProcessId, command: p.CommandLine || p.Name || ''
  }))
  return { procs, ports }
}
