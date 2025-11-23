import React, { useEffect, useMemo, useState } from 'react'
import './index.css'

type TorrentFile = {
  index: number
  path: string
  length: number
  downloaded: number
  priority: number
  is_media: boolean
}

type TorrentStatus = {
  exists: boolean
  state: string
  progress: number
  size: number
  downloaded: number
  upload: number
  download_rate: number
  upload_rate: number
  info_hash: string
  name?: string
  save_path?: string
  files_known: boolean
}

function useBridgeAvailable() {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    setReady(!!(window as any).__TAURI__?.invoke)
  }, [])
  return ready
}

export default function App() {
  const bridge = useBridgeAvailable()
  const [magnet, setMagnet] = useState('')
  const [infoHash, setInfoHash] = useState('')
  const [status, setStatus] = useState<TorrentStatus | null>(null)
  const [files, setFiles] = useState<TorrentFile[]>([])
  const [selectedFile, setSelectedFile] = useState<number | undefined>(undefined)
  const [downloadDir, setDownloadDir] = useState<string>('')
  const [log, setLog] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<'stream' | 'settings'>('stream')
  const [cfg, setCfg] = useState<any | null>(null)
  const [activeBackend, setActiveBackend] = useState<string>('')

  function pushLog(line: string) {
    setLog(l => [`${new Date().toLocaleTimeString()} ${line}`, ...l].slice(0, 200))
  }

  async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
    try {
      setBusy(true)
      return await fn()
    } catch (e: any) {
      pushLog(`Error: ${e?.message || String(e)}`)
    } finally { setBusy(false) }
    return undefined
  }

  // Settings helpers
  async function loadConfig() {
    if (!bridge) return
    try {
      const c = await (window as any).Streaming.getConfig()
      setCfg(c)
      // show active backend (best-effort via refresh call that returns current name even on error)
      try {
        const r = await (window as any).Streaming.refreshBackend()
        if (r && r.active) setActiveBackend(r.active)
      } catch {}
    } catch (e: any) {
      pushLog(`Failed to load config: ${e?.message || String(e)}`)
    }
  }

  useEffect(() => {
    if (tab === 'settings') {
      loadConfig()
    }
  }, [tab, bridge])

  async function saveCfg(patch: any) {
    if (!bridge) return
    try {
      const updated = await (window as any).Streaming.setConfig(patch)
      setCfg(updated)
      pushLog('Settings saved')
    } catch (e: any) {
      pushLog(`Save failed: ${e?.message || String(e)}`)
    }
  }

  async function onRefreshBackend() {
    if (!bridge) return
    await withBusy(async () => {
      const res = await (window as any).Streaming.refreshBackend()
      setActiveBackend(res?.active || '')
      if (res?.error) pushLog(`Backend probe error: ${res.error}`)
      else pushLog(`Active backend: ${res?.active || '-'}`)
    })
  }

  async function onPickFolder() {
    if (!bridge) return pushLog('Desktop-only feature: pick folder')
    await withBusy(async () => {
      const d = await (window as any).__TAURI__.invoke('streaming_pick_download_dir')
      if (d) { setDownloadDir(String(d)); pushLog(`Download dir set to: ${d}`) }
      // reflect into settings view if open
      if (cfg) setCfg({ ...cfg, download_dir: d })
    })
  }

  async function onAddMagnet() {
    if (!bridge) return pushLog('Desktop-only feature: add magnet')
    const m = magnet.trim()
    if (!m.startsWith('magnet:')) return pushLog('Enter a valid magnet URI')
    await withBusy(async () => {
      const res = await (window as any).__TAURI__.invoke('streaming_add_magnet', { magnet: m })
      pushLog(`Added magnet. Result: ${JSON.stringify(res)}`)
    })
  }

  async function onStatus() {
    if (!bridge) return pushLog('Desktop-only feature: status')
    const key = infoHash.trim() || magnet.trim()
    if (!key) return pushLog('Provide info-hash or magnet')
    await withBusy(async () => {
      const st = await (window as any).__TAURI__.invoke('streaming_status', { infoHashOrMagnet: key })
      setStatus(st)
      pushLog(`Status: ${st.exists ? st.state : 'not found'}`)
    })
  }

  async function onListFiles() {
    if (!bridge) return pushLog('Desktop-only feature: list files')
    const ih = infoHash.trim()
    if (!ih) return pushLog('Enter info-hash to list files')
    await withBusy(async () => {
      const fs = await (window as any).__TAURI__.invoke('streaming_list_files', { infoHash: ih })
      setFiles(fs)
      if (fs?.length) setSelectedFile(0)
      pushLog(`Files: ${fs.length}`)
    })
  }

  async function onRequestPlay() {
    if (!bridge) return pushLog('Desktop-only feature: request play')
    const ih = infoHash.trim()
    if (!ih) return pushLog('Enter info-hash to play')
    await withBusy(async () => {
      const decision = await (window as any).__TAURI__.invoke('streaming_request_play', { infoHash: ih, fileIndex: selectedFile })
      pushLog(`Play decision: ${JSON.stringify(decision)}`)
    })
  }

  async function onOpenWithSystem() {
    if (!bridge) return pushLog('Desktop-only feature: open with system player')
    const ih = infoHash.trim()
    if (!ih) return pushLog('Enter info-hash to play')
    await withBusy(async () => {
      const decision = await (window as any).__TAURI__.invoke('streaming_request_play', { infoHash: ih, fileIndex: selectedFile })
      if (decision?.allow && decision?.path) {
        try {
          await (window as any).Streaming.openWithSystem(decision.path)
          pushLog('Opened with system player')
        } catch (e: any) {
          pushLog(`System open failed: ${e?.message || String(e)}`)
        }
      } else {
        pushLog(`Not yet playable: ${decision?.reason || 'unknown reason'}`)
      }
    })
  }

  async function onToggleSeeding(on: boolean) {
    if (!bridge) return pushLog('Desktop-only feature: set seeding')
    const ih = infoHash.trim()
    if (!ih) return pushLog('Enter info-hash')
    await withBusy(async () => {
      await (window as any).__TAURI__.invoke('streaming_set_seeding', { infoHash: ih, on })
      pushLog(`Seeding set: ${on}`)
    })
  }

  return (
    <div className="p-4 max-w-[1100px] mx-auto">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Relay Desktop — Streaming</h1>
          {!bridge && (
            <div className="mt-2 text-sm text-red-600">Running without Tauri bridge — features are desktop-only.</div>
          )}
        </div>
        <nav className="flex gap-2">
          <button className={`px-3 py-2 rounded ${tab==='stream'?'bg-gray-900 text-white':'bg-gray-200'}`} onClick={() => setTab('stream')}>Streaming</button>
          <button className={`px-3 py-2 rounded ${tab==='settings'?'bg-gray-900 text-white':'bg-gray-200'}`} onClick={() => setTab('settings')}>Settings</button>
        </nav>
      </header>

      {tab === 'stream' ? (
      <section className="grid gap-3">
        <div className="grid md:grid-cols-2 gap-3">
          <div className="grid gap-2">
            <label className="text-sm text-gray-600">Magnet URI</label>
            <input className="border rounded p-2" value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:..." />
            <div className="flex gap-2">
              <button className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-60" disabled={busy} onClick={onAddMagnet}>Add Magnet</button>
              <button className="px-3 py-2 rounded bg-gray-200" onClick={onPickFolder}>Pick Download Folder</button>
            </div>
          </div>
          <div className="grid gap-2">
            <label className="text-sm text-gray-600">Info Hash (hex)</label>
            <input className="border rounded p-2" value={infoHash} onChange={e => setInfoHash(e.target.value)} placeholder="40-hex info hash" />
            <div className="flex gap-2 flex-wrap">
              <button className="px-3 py-2 rounded bg-green-600 text-white disabled:opacity-60" disabled={busy} onClick={onStatus}>Status</button>
              <button className="px-3 py-2 rounded bg-indigo-600 text-white disabled:opacity-60" disabled={busy} onClick={onListFiles}>List Files</button>
              <button className="px-3 py-2 rounded bg-purple-600 text-white disabled:opacity-60" disabled={busy} onClick={onRequestPlay}>Request Play</button>
              <button className="px-3 py-2 rounded bg-rose-600 text-white disabled:opacity-60" disabled={busy} onClick={onOpenWithSystem}>Open with System Player</button>
              <button className="px-3 py-2 rounded bg-amber-600 text-white disabled:opacity-60" disabled={busy} onClick={() => onToggleSeeding(true)}>Start/Seed</button>
              <button className="px-3 py-2 rounded bg-amber-700 text-white disabled:opacity-60" disabled={busy} onClick={() => onToggleSeeding(false)}>Pause</button>
            </div>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-3 items-start">
          <div className="border rounded p-3 bg-white">
            <div className="font-semibold mb-2">Status</div>
            {status ? (
              <pre className="text-xs overflow-auto max-h-64">{JSON.stringify(status, null, 2)}</pre>
            ) : (
              <div className="text-sm text-gray-500">No status yet.</div>
            )}
          </div>
          <div className="border rounded p-3 bg-white">
            <div className="font-semibold mb-2">Files</div>
            {!files?.length ? (
              <div className="text-sm text-gray-500">No files loaded.</div>
            ) : (
              <div className="grid gap-2 max-h-64 overflow-auto">
                {files.map(f => (
                  <label key={f.index} className="flex items-start gap-2">
                    <input type="radio" name="sel-file" checked={selectedFile === f.index} onChange={() => setSelectedFile(f.index)} />
                    <div className="text-xs">
                      <div className="font-mono break-all">{f.path}</div>
                      <div className="text-gray-600">{f.downloaded} / {f.length} bytes {f.is_media ? '• media' : ''}</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Logs</div>
          <div className="text-xs grid gap-1 max-h-64 overflow-auto">
            {log.map((l, i) => <div key={i}>{l}</div>)}
          </div>
        </div>
      </section>
      ) : (
      <section className="grid gap-3">
        <div className="border rounded p-3 bg-white">
          <div className="flex items-center justify-between">
            <div className="font-semibold">General</div>
            <div className="text-sm text-gray-600">Active backend: {activeBackend || (bridge? 'unknown':'—')}</div>
          </div>
          {!bridge ? (
            <div className="text-sm text-red-600 mt-2">Desktop-only: not running under Tauri.</div>
          ) : !cfg ? (
            <div className="text-sm text-gray-600 mt-2">Loading settings…</div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4 mt-2">
              <div className="grid gap-2">
                <label className="text-sm text-gray-600">Download directory</label>
                <div className="flex gap-2 items-center">
                  <input className="border rounded p-2 flex-1" value={cfg.download_dir || ''} readOnly />
                  <button className="px-3 py-2 rounded bg-gray-200" onClick={onPickFolder}>Pick…</button>
                </div>
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-gray-600">Autoplay (skip confirm)</label>
                <input type="checkbox" checked={!!cfg.auto_play_confirmed} onChange={e => saveCfg({ auto_play_confirmed: e.target.checked })} />
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-gray-600">Auto-open player when allowed</label>
                <input type="checkbox" checked={!!cfg.auto_open_player_on_allow} onChange={e => saveCfg({ auto_open_player_on_allow: e.target.checked })} />
                {!('TAURI_PLUGIN_VIDEOPLAYER' in (window as any)) && (
                  <div className="text-xs text-gray-500">Note: videoplayer plugin may not be compiled; auto-open will no-op.</div>
                )}
              </div>
              <div className="grid gap-2">
                <label className="text-sm text-gray-600">Default playback target</label>
                <select className="border rounded p-2" value={cfg.playback_target || 'auto'} onChange={e => saveCfg({ playback_target: e.target.value })}>
                  <option value="auto">Auto</option>
                  <option value="tauri">Tauri Player</option>
                  <option value="system">System Player</option>
                </select>
                <div className="text-xs text-gray-500">System Player uses OS file associations (e.g., VLC).</div>
              </div>
            </div>
          )}
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Playback thresholds</div>
          {cfg && (
            <div className="grid md:grid-cols-3 gap-3">
              <label className="grid gap-1 text-sm">First bytes (MB)
                <input className="border rounded p-2" type="number" min={0} max={16384} value={cfg.play_min_first_bytes_mb}
                  onChange={e => saveCfg({ play_min_first_bytes_mb: Math.max(0, Math.min(16384, Number(e.target.value)||0)) })} />
              </label>
              <label className="grid gap-1 text-sm">Min total (MB)
                <input className="border rounded p-2" type="number" min={0} max={65536} value={cfg.play_min_total_mb}
                  onChange={e => saveCfg({ play_min_total_mb: Math.max(0, Math.min(65536, Number(e.target.value)||0)) })} />
              </label>
              <label className="grid gap-1 text-sm">Min total (%)
                <input className="border rounded p-2" type="number" min={0} max={100} value={cfg.play_min_total_percent}
                  onChange={e => saveCfg({ play_min_total_percent: Math.max(0, Math.min(100, Number(e.target.value)||0)) })} />
              </label>
            </div>
          )}
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Resume when available</div>
          {cfg && (
            <div className="grid md:grid-cols-2 gap-3">
              <label className="grid gap-1 text-sm">Poll interval (seconds)
                <input className="border rounded p-2" type="number" min={1} max={3600} value={cfg.resume_poll_interval_sec}
                  onChange={e => saveCfg({ resume_poll_interval_sec: Math.max(1, Math.min(3600, Number(e.target.value)||1)) })} />
              </label>
              <label className="grid gap-1 text-sm">Timeout (minutes)
                <input className="border rounded p-2" type="number" min={1} max={10080} value={cfg.resume_timeout_min}
                  onChange={e => saveCfg({ resume_timeout_min: Math.max(1, Math.min(10080, Number(e.target.value)||1)) })} />
              </label>
            </div>
          )}
        </div>

        <div className="border rounded p-3 bg-white">
          <div className="font-semibold mb-2">Backends</div>
          {cfg && (
            <div className="grid gap-3">
              <div className="flex items-center gap-2">
                <label className="text-sm">Preferred backend:</label>
                <select className="border rounded p-2" value={cfg.preferred_backend}
                  onChange={e => saveCfg({ preferred_backend: e.target.value })}>
                  <option value="auto">Auto</option>
                  <option value="qbt">qBittorrent</option>
                  <option value="transmission">Transmission</option>
                </select>
                <button className="px-3 py-2 rounded bg-gray-200 disabled:opacity-60" disabled={busy} onClick={onRefreshBackend}>Re-probe backends</button>
              </div>
              <div className="text-sm text-gray-600">Active: {activeBackend || 'unknown'}</div>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="grid gap-1 text-sm">qBittorrent Host
                  <input className="border rounded p-2" type="text" value={cfg.qbt_host || ''}
                    onChange={e => saveCfg({ qbt_host: e.target.value })} placeholder="127.0.0.1 or http://host:port/" />
                </label>
                <label className="grid gap-1 text-sm">qBittorrent Port
                  <input className="border rounded p-2" type="number" min={1} max={65535} value={cfg.qbt_port ?? ''}
                    onChange={e => saveCfg({ qbt_port: Math.max(1, Math.min(65535, Number(e.target.value)||0)) })} />
                </label>
                <label className="grid gap-1 text-sm">qBittorrent Base Path
                  <input className="border rounded p-2" type="text" value={cfg.qbt_base || ''}
                    onChange={e => saveCfg({ qbt_base: e.target.value })} placeholder="/" />
                </label>
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <label className="grid gap-1 text-sm">Transmission Host
                  <input className="border rounded p-2" type="text" value={cfg.tr_host || ''}
                    onChange={e => saveCfg({ tr_host: e.target.value })} placeholder="127.0.0.1" />
                </label>
                <label className="grid gap-1 text-sm">Transmission Port
                  <input className="border rounded p-2" type="number" min={1} max={65535} value={cfg.tr_port ?? ''}
                    onChange={e => saveCfg({ tr_port: Math.max(1, Math.min(65535, Number(e.target.value)||0)) })} />
                </label>
                <label className="grid gap-1 text-sm">Transmission RPC Path
                  <input className="border rounded p-2" type="text" value={cfg.tr_path || ''}
                    onChange={e => saveCfg({ tr_path: e.target.value })} placeholder="/transmission/rpc" />
                </label>
              </div>
              <div className="text-xs text-gray-500">Tip: If qBittorrent host is a full URL (http://host:port/), base path is ignored.</div>
            </div>
          )}
        </div>

      </section>
      )}
    </div>
  )
}
