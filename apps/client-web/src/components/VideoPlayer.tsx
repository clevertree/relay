import React, { useEffect, useMemo, useRef, useState } from 'react'

type Subtitle = {
  src: string
  label?: string
  lang?: string
  default?: boolean
}

interface VideoPlayerProps {
  src: string
  subtitles?: Subtitle[]
  poster?: string
  autoPlay?: boolean
  controls?: boolean
  className?: string
  style?: React.CSSProperties
}

/**
 * VideoPlayer - minimal cross-platform friendly video player wrapper.
 * - Accepts torrent:// and ipfs:// URIs; will lazy-load client libs on demand.
 * - Shows a simple status UI: locating peers → downloading → ready.
 * - Autoplays when enough data is buffered.
 *
 * NOTE: This implementation stubs torrent/ipfs fetching with a basic fallback.
 * Replace `loadTorrentLib`/`loadIpfsLib` with real dynamic imports when integrating.
 */
export function VideoPlayer({ src, subtitles, poster, autoPlay = true, controls = true, className, style }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [status, setStatus] = useState<'idle' | 'locating' | 'downloading' | 'ready' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null)

  const scheme = useMemo(() => {
    try {
      const u = new URL(src)
      return u.protocol.replace(':', '')
    } catch {
      // allow plain http/https
      if (src.startsWith('torrent://')) return 'torrent'
      if (src.startsWith('ipfs://')) return 'ipfs'
      if (src.startsWith('magnet:')) return 'magnet'
      return 'http'
    }
  }, [src])

  useEffect(() => {
    let cancelled = false
    async function run() {
      setError(null)
      if (scheme === 'http' || scheme === 'https') {
        setResolvedSrc(src)
        setStatus('ready')
        return
      }
      try {
        setStatus('locating')
        if (scheme === 'torrent' || scheme === 'magnet') {
          const url = await loadTorrentMediaUrl(src)
          if (cancelled) return
          setResolvedSrc(url)
          setStatus('ready')
        } else if (scheme === 'ipfs') {
          const url = await loadIpfsGatewayUrl(src)
          if (cancelled) return
          setResolvedSrc(url)
          setStatus('ready')
        } else {
          setResolvedSrc(src)
          setStatus('ready')
        }
      } catch (e) {
        if (cancelled) return
        setStatus('error')
        setError(e instanceof Error ? e.message : String(e))
      }
    }
    run()
    return () => { cancelled = true }
  }, [scheme, src])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    if (status === 'ready' && autoPlay) {
      const play = async () => {
        try { await v.play() } catch {}
      }
      // slight delay to allow src to attach
      const t = setTimeout(play, 50)
      return () => clearTimeout(t)
    }
  }, [status, autoPlay])

  return (
    <div className={"w-full max-w-4xl " + (className || '')} style={style}>
      <div className="mb-2 text-sm text-gray-300">
        {status === 'idle' && 'Waiting...'}
        {status === 'locating' && 'Locating peers...'}
        {status === 'downloading' && 'Downloading data...'}
        {status === 'ready' && 'Ready'}
        {status === 'error' && (
          <span className="text-red-400">Error: {error || 'Unable to play this source'}</span>
        )}
      </div>
      <video ref={videoRef} src={resolvedSrc || undefined} poster={poster} controls={controls} style={{ width: '100%', maxHeight: 480 }}>
        {(subtitles || []).map((t, i) => (
          // eslint-disable-next-line react/jsx-key
          <track key={i} src={t.src} label={t.label} srcLang={t.lang} kind="subtitles" default={t.default} />
        ))}
      </video>
    </div>
  )
}

async function loadTorrentMediaUrl(src: string): Promise<string> {
  // Placeholder logic. Integrate WebTorrent/hybrid client here.
  // For now, route through a hypothetical gateway that can stream by infohash.
  // Example: /gateway/torrent/{infoHash}
  const infoHash = extractInfoHash(src)
  if (!infoHash) throw new Error('Invalid torrent URI')
  return `/gateway/torrent/${infoHash}`
}

async function loadIpfsGatewayUrl(src: string): Promise<string> {
  // Replace with actual IPFS client/gateway resolution. For now, use public gateway.
  const cid = src.replace(/^ipfs:\/\//, '')
  return `https://ipfs.io/ipfs/${cid}`
}

function extractInfoHash(uri: string): string | null {
  try {
    if (uri.startsWith('torrent://')) return uri.replace('torrent://', '').trim()
    if (uri.startsWith('magnet:')) {
      const u = new URL(uri)
      const xt = u.searchParams.get('xt') || ''
      const m = xt.match(/urn:btih:([^&]+)/i)
      return m ? m[1] : null
    }
    return null
  } catch {
    return null
  }
}

export default VideoPlayer
