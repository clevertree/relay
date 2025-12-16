/**
 * Native Repo Browser Component
 * Reuses the shared HookRenderer so wiring matches DebugTab preview.
 */
import React, { useEffect } from 'react'
import HookRenderer from './HookRenderer'
import { TSDiv } from './TSDiv'

interface RepoBrowserProps {
  host: string
}

const RepoBrowser: React.FC<RepoBrowserProps> = ({ host }) => {
  useEffect(() => {
    console.debug('[RepoBrowser] mounted', { host })
    return () => console.debug('[RepoBrowser] unmounted', { host })
  }, [host])

  return (
    <TSDiv className="flex-1 bg-white min-h-0">
      <HookRenderer host={host} />
    </ThemedElement>
  )
}

export default RepoBrowser
