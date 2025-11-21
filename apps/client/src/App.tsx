import React, { useEffect, useMemo, useState } from 'react'
import { marked } from 'marked'

type Peer = { id: string; socket: string; updatedAt: string }

const TRACKER_URL = import.meta.env.VITE_TRACKER_URL || 'https://relaynet.online'

function NavBar({ tabs, current, setCurrent, closeTab }: {
  tabs: { id: string, socket: string }[]
  current?: string
  setCurrent: (id?: string) => void
  closeTab: (id: string) => void
}) {
  return (
    <div className="flex items-center gap-2 p-2 bg-white border-b">
      <button className="px-3 py-1 rounded bg-gray-200" onClick={() => setCurrent(undefined)}>Home</button>
      <div className="text-sm text-gray-500">Settings</div>
      <div className="flex-1" />
      <div className="flex items-center gap-2 overflow-x-auto">
        {tabs.map(t => (
          <div key={t.id} className={`flex items-center gap-1 px-2 py-1 rounded border ${current === t.id ? 'bg-blue-50 border-blue-300' : 'bg-gray-50'}`}>
            <button onClick={() => setCurrent(t.id)} className="text-xs font-mono">{t.socket}</button>
            <button className="text-xs text-red-600" onClick={() => closeTab(t.id)}>x</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function ServerConnect({ onConnect }: { onConnect: (socket: string) => void }) {
  const [peers, setPeers] = useState<Peer[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | undefined>()

  async function load() {
    setLoading(true)
    setError(undefined)
    try {
      const res = await fetch(`${TRACKER_URL}/api/peers`, { cache: 'no-store' })
      const data = await res.json()
      setPeers(data)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [])

  return (
    <div className="p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="text-lg font-semibold">Master peers</div>
        <button onClick={load} className="px-3 py-1 rounded bg-blue-600 text-white disabled:bg-blue-300" disabled={loading}>Refresh</button>
        <div className="text-xs text-gray-500">Tracker: {TRACKER_URL}</div>
      </div>
      {error && <div className="text-red-600 mb-2">{error}</div>}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {peers.map(p => (
          <div key={p.id} className="p-3 border rounded bg-white flex items-center justify-between">
            <div>
              <div className="font-mono">{p.socket}</div>
              <div className="text-xs text-gray-500">{new Date(p.updatedAt).toLocaleString()}</div>
            </div>
            <button onClick={() => onConnect(p.socket)} className="px-3 py-1 rounded bg-green-600 text-white">Connect</button>
          </div>
        ))}
      </div>
    </div>
  )
}

function useServerStatus(baseUrl?: string) {
  const [branches, setBranches] = useState<string[]>([])
  const [ok, setOk] = useState<boolean | undefined>()
  const [error, setError] = useState<string | undefined>()
  async function refresh() {
    if (!baseUrl) return
    setError(undefined)
    try {
      const res = await fetch(`${baseUrl}/status`, { method: 'POST' })
      const data = await res.json()
      setOk(!!data.ok)
      setBranches(data.branches || [])
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }
  useEffect(() => { refresh() }, [baseUrl])
  return { ok, branches, error, refresh }
}

function RepositoryBrowser({ socket }: { socket: string }) {
  const baseUrl = useMemo(() => `http://${socket}`, [socket])
  const { ok, branches, error, refresh } = useServerStatus(baseUrl)
  const [branch, setBranch] = useState('main')
  const [path, setPath] = useState('/index.md')
  const [content, setContent] = useState<string>('')
  const [search, setSearch] = useState('')

  useEffect(() => { if (branches.length && !branches.includes(branch)) setBranch(branches[0]) }, [branches])

  async function fetchFile() {
    const url = `${baseUrl}${path.startsWith('/') ? path : ('/' + path)}`
    const res = await fetch(url, { headers: { 'X-Relay-Branch': branch } })
    if (!res.ok) { setContent(`# Error ${res.status}`); return }
    const ct = res.headers.get('content-type') || ''
    if (ct.includes('text') || path.endsWith('.md')) {
      const text = await res.text()
      setContent(text)
    } else {
      setContent('')
    }
  }
  useEffect(() => { if (ok) fetchFile() }, [ok, branch, path])

  async function doQuery() {
    await fetch(`${baseUrl}/query`, { method: 'POST', headers: { 'X-Relay-Branch': branch } })
    // Not implemented; no results to show.
  }

  const html = useMemo(() => {
    if (path.endsWith('.md')) return marked.parse(content)
    return `<pre>${content.replace(/[&<>]/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[s] as string))}</pre>`
  }, [content, path])

  return (
    <div className="flex flex-col h-full">
      <div className="p-2 border-b bg-white flex items-center gap-2">
        <div className="text-sm">{baseUrl}</div>
        <input className="flex-1 px-2 py-1 border rounded font-mono" value={path} onChange={e => setPath(e.target.value)} />
        <select className="px-2 py-1 border rounded" value={branch} onChange={e => setBranch(e.target.value)}>
          {branches.map(b => <option key={b} value={b}>{b}</option>)}
        </select>
        <input className="px-2 py-1 border rounded" placeholder="Search (QUERY)" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={doQuery}>Search</button>
        <button className="px-3 py-1 rounded bg-gray-200" onClick={refresh}>Status</button>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  )
}

export default function App() {
  const [tabs, setTabs] = useState<{ id: string, socket: string }[]>([])
  const [current, setCurrent] = useState<string | undefined>()

  function addTab(socket: string) {
    const id = `${socket}-${Date.now()}`
    const t = { id, socket }
    setTabs(prev => [...prev, t])
    setCurrent(id)
  }
  function closeTab(id: string) {
    setTabs(prev => prev.filter(t => t.id !== id))
    if (current === id) setCurrent(undefined)
  }
  const active = tabs.find(t => t.id === current)

  return (
    <div className="h-full flex flex-col">
      <NavBar tabs={tabs} current={current} setCurrent={setCurrent} closeTab={closeTab} />
      <div className="flex-1">
        {!active && <ServerConnect onConnect={addTab} />}
        {active && <RepositoryBrowser socket={active.socket} />}
      </div>
    </div>
  )
}
