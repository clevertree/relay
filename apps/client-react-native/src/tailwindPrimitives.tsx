import { styled } from './tailwindRuntime'
if (typeof styled !== 'function') {
  console.warn('[tailwindPrimitives] styled export is not a function:', styled)
}
import {
  SafeAreaView as RNSafeAreaView,
  ScrollView as RNScrollView,
  Text as RNText,
  TouchableOpacity as RNTouchableOpacity,
  View as RNView,
  TextInput as RNTextInput,
} from 'react-native'

export const SafeAreaView = styled(RNSafeAreaView)
export const ScrollView = styled(RNScrollView)
export const Text = styled(RNText)
export const TextInput = styled(RNTextInput)
export const TouchableOpacity = styled(RNTouchableOpacity)
export const View = styled(RNView)
