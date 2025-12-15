/**
 * Native Repo Browser Component
 * Reuses the shared HookRenderer so wiring matches DebugTab preview.
 */
import React from 'react'
import { View } from 'react-native'
import HookRenderer from './HookRenderer'
import { styled } from '../tailwindRuntime'

interface RepoBrowserProps {
  host: string
}

const TWView = styled(View)

const RepoBrowser: React.FC<RepoBrowserProps> = ({ host }) => {
  return (
    <TWView className="flex-1 bg-white min-h-0">
      <HookRenderer host={host} />
    </TWView>
  )
}

export default RepoBrowser
