import {AppRegistry} from 'react-native';
// Inject repo .env values into the JS runtime for development builds
import './native/env-inject';
import App from './src/App';

AppRegistry.registerComponent('RelayClient', () => App);
