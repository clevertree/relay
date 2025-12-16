import React from 'react'
import { Text, View } from 'react-native'
import { styled } from '../themedRuntime'

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
      const TWView = styled(View)
      const TWText = styled(Text)
      return (
        <TWView className="mx-3 my-2 rounded-lg bg-red-50 border border-red-200 p-4">
          <TWText className="font-bold text-red-700 mb-1">Hook rendering failed</TWText>
          <TWText className="text-xs text-gray-500 mb-1">Script: {this.props.scriptPath ?? 'unknown'}</TWText>
          <TWText className="text-red-700">{this.state.error.message}</TWText>
        </TWView>
      )
    }

    return this.props.children as React.ReactElement
  }
}
