// Basic React Native jest setup
jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper');
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
