/**
 * Native Repo Browser Component
 * Reuses the shared HookRenderer so wiring matches DebugTab preview.
 */
import React from 'react'
import { StyleSheet, View } from 'react-native'
import HookRenderer from './HookRenderer'

interface RepoBrowserProps {
  host: string
}

const RepoBrowser: React.FC<RepoBrowserProps> = ({ host }) => {
  return (
    <View style={styles.container}>
      <HookRenderer host={host} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
})

export default RepoBrowser
