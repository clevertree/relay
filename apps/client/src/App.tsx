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

type Rules = {
  indexFile?: string
  allowedPaths?: string[]
  insertTemplate?: string
}

function useServerStatus(baseUrl?: string) {
  const [branches, setBranches] = useState<string[]>([])
  const [ok, setOk] = useState<boolean | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [rules, setRules] = useState<Rules | undefined>()
  async function refresh() {
    if (!baseUrl) return
    setError(undefined)
    try {
      const res = await fetch(`${baseUrl}/status`, { method: 'POST' })
      const data = await res.json()
      setOk(!!data.ok)
      setBranches(data.branches || [])
      setRules(data.rules || undefined)
    } catch (e: any) {
      setError(e?.message || String(e))
    }
  }
  useEffect(() => { refresh() }, [baseUrl])
  return { ok, branches, rules, error, refresh }
}

function RepositoryBrowser({ socket }: { socket: string }) {
  const baseUrl = useMemo(() => `http://${socket}`, [socket])
  const { ok, branches, rules, error, refresh } = useServerStatus(baseUrl)
  const [branch, setBranch] = useState('main')
  const [path, setPath] = useState('/index.md')
  const [content, setContent] = useState<string>('')
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<any[]>([])
  const [qPage, setQPage] = useState(0)
  const [qPageSize, setQPageSize] = useState(25)
  const [qTotal, setQTotal] = useState<number | undefined>()
  const [qLoading, setQLoading] = useState(false)
  const [qError, setQError] = useState<string | undefined>()
  const [showNew, setShowNew] = useState(false)
  const [newMeta, setNewMeta] = useState<string>(`{\n  "title": "",\n  "release_date": "",\n  "genre": []\n}`)
  const [suggestedPath, setSuggestedPath] = useState<string>('')

  useEffect(() => { if (branches.length && !branches.includes(branch)) setBranch(branches[0]) }, [branches])
  useEffect(() => {
    // When rules arrive, update default path from indexFile
    if (rules?.indexFile) {
      setPath(p => p === '/index.md' ? `/${rules.indexFile}`.replace(/\/+/g, '/') : p)
    }
  }, [rules])

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

  async function doQuery(page = qPage, pageSize = qPageSize) {
    if (!ok) return
    setQLoading(true)
    setQError(undefined)
    try {
      const res = await fetch(`${baseUrl}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Relay-Branch': branch },
        body: JSON.stringify({ page, pageSize, params: search ? { q: search } : {} })
      })
      if (!res.ok) throw new Error(`Query failed: ${res.status}`)
      const data = await res.json()
      setResults(Array.isArray(data.items) ? data.items : [])
      setQTotal(typeof data.total === 'number' ? data.total : undefined)
      setQPage(data.page ?? page)
      setQPageSize(data.pageSize ?? pageSize)
    } catch (e: any) {
      setQError(e?.message || String(e))
    } finally { setQLoading(false) }
  }

  function evaluateInsertTemplate(metaObj: any): string {
    const tpl = rules?.insertTemplate
    if (!tpl) return ''
    try {
      // Unsafe eval within app context; trusted usage only in this sample client
      // Expose fields as variables for simple template like `${title}` etc.
      const fn = new Function(...Object.keys(metaObj), `return \
        (function(){ return ${JSON.stringify(tpl)}; })();`)
      const val = fn(...Object.values(metaObj))
      if (typeof val === 'string') return val
    } catch {}
    return ''
  }

  function openNewEntry() {
    setShowNew(true)
    // try compute suggestion
    try {
      const meta = JSON.parse(newMeta)
      const s = evaluateInsertTemplate(meta)
      if (s) setSuggestedPath(s.endsWith('/') ? s + 'meta.json' : s)
    } catch {}
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
          <option value="all">all</option>
        </select>
        <input className="px-2 py-1 border rounded" placeholder="Search (QUERY)" value={search} onChange={e => setSearch(e.target.value)} />
        <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => doQuery(0, qPageSize)}>Search</button>
        <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={openNewEntry} disabled={!rules?.insertTemplate}>New Entry</button>
        <button className="px-3 py-1 rounded bg-gray-200" onClick={refresh}>Status</button>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
        <div className="mt-6">
          <div className="flex items-center gap-2 mb-2">
            <div className="font-semibold">Query Results</div>
            {qLoading && <div className="text-xs text-gray-500">Loading…</div>}
            {qError && <div className="text-xs text-red-600">{qError}</div>}
            {typeof qTotal === 'number' && <div className="text-xs text-gray-500">Total: {qTotal}</div>}
            <div className="flex-1" />
            <button className="px-2 py-1 border rounded" onClick={() => doQuery(Math.max(0, qPage - 1), qPageSize)} disabled={qPage === 0 || qLoading}>Prev</button>
            <button className="px-2 py-1 border rounded" onClick={() => doQuery(qPage + 1, qPageSize)} disabled={qLoading}>Next</button>
            <input className="w-20 px-2 py-1 border rounded" type="number" min={1} value={qPageSize} onChange={e => { const n = Math.max(1, Number(e.target.value)||25); setQPageSize(n); }} />
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border">
              <thead>
                <tr className="bg-gray-100">
                  {results[0] && Object.keys(results[0]).map((k) => (
                    <th key={k} className="px-2 py-1 border text-left">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {results.map((row, i) => (
                  <tr key={i} className="odd:bg-white even:bg-gray-50">
                    {Object.keys(results[0] || {}).map((k) => (
                      <td key={k} className="px-2 py-1 border font-mono">{String(row[k])}</td>
                    ))}
                  </tr>
                ))}
                {!results.length && <tr><td className="px-2 py-3 text-gray-500">No results</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {showNew && (
          <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
            <div className="bg-white w-[700px] max-w-[95%] rounded shadow border">
              <div className="p-2 border-b flex items-center justify-between">
                <div className="font-semibold">New Entry</div>
                <button className="text-red-600" onClick={() => setShowNew(false)}>x</button>
              </div>
              <div className="p-3 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-gray-600 mb-1">meta.json</div>
                  <textarea className="w-full h-64 border rounded p-2 font-mono text-xs" value={newMeta} onChange={e => {
                    setNewMeta(e.target.value)
                    try {
                      const meta = JSON.parse(e.target.value)
                      const s = evaluateInsertTemplate(meta)
                      if (s) setSuggestedPath(s.endsWith('/') ? s + 'meta.json' : s)
                    } catch {}
                  }} />
                </div>
                <div>
                  <div className="text-xs text-gray-600 mb-1">Suggested PUT path</div>
                  <input className="w-full border rounded p-2 font-mono" value={suggestedPath} onChange={e => setSuggestedPath(e.target.value)} />
                  <div className="text-xs text-gray-500 mt-2">Template from rules.insertTemplate. You can edit the path before uploading.</div>
                </div>
              </div>
              <div className="p-2 border-t flex items-center gap-2 justify-end">
                <button className="px-3 py-1 rounded bg-gray-200" onClick={() => setShowNew(false)}>Close</button>
                <button className="px-3 py-1 rounded bg-blue-600 text-white" onClick={() => {/* future: PUT meta file */}}>Continue</button>
              </div>
            </div>
          </div>
        )}
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
