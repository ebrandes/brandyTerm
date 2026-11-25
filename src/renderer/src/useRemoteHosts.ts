import { useEffect, useState } from 'react'
import type { RemoteHostInfo } from '../../shared/remote/machine.ts'
import { api } from './api'

/** Paired machines with their online state, live. */
export function useRemoteHosts(): RemoteHostInfo[] {
  const [hosts, setHosts] = useState<RemoteHostInfo[]>([])
  useEffect(() => {
    let alive = true
    void api.remote.hosts().then((h) => alive && setHosts(h)).catch(() => {})
    const off = api.remote.onHosts((h) => setHosts(h))
    return () => {
      alive = false
      off()
    }
  }, [])
  return hosts
}
