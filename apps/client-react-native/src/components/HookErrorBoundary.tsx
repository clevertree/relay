import React from 'react'
import { StyleSheet, Text, View } from 'react-native'

type Props = {
  children: React.ReactNode
  scriptPath?: string | null
  onError?: (error: Error, info: React.ErrorInfo) => void
}

type State = {
  error: Error | null
}

export class HookErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.scriptPath !== this.props.scriptPath && this.state.error) {
      this.setState({ error: null })
    }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.props.onError?.(error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Hook rendering failed</Text>
          <Text style={styles.scriptLabel}>Script: {this.props.scriptPath ?? 'unknown'}</Text>
          <Text style={styles.message}>{this.state.error.message}</Text>
        </View>
      )
    }

    return this.props.children as React.ReactElement
  }
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    borderRadius: 8,
    marginHorizontal: 12,
    marginVertical: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
  },
  title: {
    fontWeight: '700',
    color: '#b91c1c',
    marginBottom: 4,
  },
  scriptLabel: {
    fontSize: 12,
    color: '#6b7280',
    marginBottom: 6,
  },
  message: {
    color: '#991b1b',
  },
})
