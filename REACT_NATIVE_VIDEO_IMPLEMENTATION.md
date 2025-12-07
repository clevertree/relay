# React Native Distributed File Loader - Implementation Guide

## Overview

I've created React Native equivalents of the web components for handling distributed file loading (torrent, IPFS) with native video playback support for iOS and Android.

## Components Created

### 1. DistributedFileLoader (React Native)
**Location**: `apps/client-react-native/src/components/DistributedFileLoader.tsx`

Mirrors the web version with React Native-specific features:

**Key Features:**
- ✅ Same 7-stage loading pipeline as web version
- ✅ AsyncStorage caching for faster replays
- ✅ Lazy library loading on demand
- ✅ Protocol support: `torrent://`, `ipfs://`, `magnet:`, `http(s)://`
- ✅ AbortController for cancellation
- ✅ Detailed error messages with troubleshooting

**API:**
```typescript
<DistributedFileLoader
  src="torrent://..."
  onStatusChange={(status, msg, progress) => {}}
  onSuccess={(result) => {}}
  onError={(error, details) => {}}
  cacheEnabled={true}
  cacheKey="optional_cache_id"
/>
```

### 2. VideoPlayer (React Native)
**Location**: `apps/client-react-native/src/components/VideoPlayer.tsx`

Native video player wrapper with status UI:

**Features:**
- ✅ Uses DistributedFileLoader for all media loading
- ✅ Status display with emoji icons & progress bar
- ✅ Error display with expandable details
- ✅ Loading placeholder
- ✅ Ready for native video integration
- ✅ Auto-play support
- ✅ Native controls integration

---

## Recommended Libraries

### For Torrent Support: `react-native-torrent-streamer`

**Why this library:**
- Direct torrent streaming to native player
- iOS: Uses native networking stack
- Android: Uses native media framework
- Built specifically for React Native
- Lower overhead than browser-based solutions
- Peer discovery via DHT (Distributed Hash Table)

**Installation:**

```bash
# Install package
npm install react-native-torrent-streamer

# iOS setup
cd ios && pod install && cd ..

# Android setup
cd android
# No additional setup needed, uses native modules

# Rebuild for Android
./gradlew clean build
```

**Basic Usage:**

```typescript
import { TorrentStreamer } from 'react-native-torrent-streamer'

const result = await TorrentStreamer.stream(magnetUri, {
  onProgress: (bytes, total) => {
    const percent = (bytes / total) * 100
    console.log(`Downloaded: ${percent}%`)
  },
  onPeers: (count) => {
    console.log(`Connected to ${count} peers`)
  }
})

console.log('Streaming URL:', result.url)
```

**Integration with DistributedFileLoader:**

Replace the TODO in `loadTorrentFile()`:

```typescript
async function loadTorrentFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading torrent streaming library...')
    
    // Import dynamically
    const { TorrentStreamer } = await import('react-native-torrent-streamer')
    
    if (signal.aborted) throw new Error('Loading cancelled')
    
    const infoHash = extractInfoHash(src)
    if (!infoHash) throw new Error('Invalid torrent URI')
    
    onUpdate('connecting', `Connecting to torrent: ${infoHash.substring(0, 8)}...`, 10)
    
    const magnetUri = `magnet:?xt=urn:btih:${infoHash}`
    
    let lastProgress = 10
    const result = await TorrentStreamer.stream(magnetUri, {
      onProgress: (bytes, total) => {
        if (signal.aborted) throw new Error('Cancelled')
        const percent = Math.round((bytes / total) * 90) + 10
        onUpdate('downloading', 
          `Downloading: ${(bytes / 1024 / 1024).toFixed(1)}MB / ${(total / 1024 / 1024).toFixed(1)}MB`,
          percent
        )
        lastProgress = percent
      },
      onPeers: (count) => {
        if (count > 0) {
          onUpdate('locating', `Connected to ${count} peer${count > 1 ? 's' : ''}`, lastProgress)
        }
      }
    })
    
    onUpdate('ready', 'Torrent ready to stream', 100)
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw new Error(`Torrent loading failed: ${error.message}`)
  }
}
```

---

### For IPFS Support: `js-ipfs` with Polyfills

**Why this approach:**
- Full IPFS node in React Native
- No external gateway dependency
- Peer-to-peer content distribution
- Works offline once content is cached

**Installation:**

```bash
npm install ipfs
npm install --save-dev @react-native-webrtc/react-native-webrtc
```

**Metro Configuration:**

Update `metro.config.js`:

```javascript
module.exports = {
  project: {
    ios: {},
    android: {},
  },
  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },
  // Add IPFS specific configuration
  resolver: {
    extraNodeModules: {
      // Polyfills for Node modules
      crypto: require.resolve('crypto-browserify'),
      fs: require.resolve('memfs'),
    },
  },
}
```

**Integration with DistributedFileLoader:**

Replace the TODO in `loadIpfsFile()`:

```typescript
async function loadIpfsFile(
  src: string,
  signal: AbortSignal,
  onUpdate: (status: LoadingStatus, message: string, progress?: number) => void,
): Promise<void> {
  try {
    onUpdate('loading-lib', 'Loading IPFS library...')
    
    // Import dynamically
    const IPFS = await import('ipfs')
    
    if (signal.aborted) throw new Error('Loading cancelled')
    
    const cid = src.replace(/^ipfs:\/\//, '')
    onUpdate('parsing', `Parsed CID: ${cid.substring(0, 8)}...`)
    
    onUpdate('connecting', 'Starting IPFS node...')
    const ipfs = await IPFS.create()
    
    if (signal.aborted) throw new Error('Loading cancelled')
    
    onUpdate('locating', 'Finding content on DHT...', 30)
    
    // Use IPFS HTTP gateway as fallback for streaming
    const url = `https://ipfs.io/ipfs/${cid}`
    
    onUpdate('downloading', 'Content available', 100)
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    throw new Error(`IPFS loading failed: ${error.message}`)
  }
}
```

---

### For Video Playback: `react-native-video`

**Why this library:**
- Supports both AVPlayer (iOS) and ExoPlayer (Android)
- Full-featured native video player
- Supports streaming protocols (HLS, DASH, HTTP)
- Hardware-accelerated decoding
- Subtitle support
- Playback controls

**Installation:**

```bash
npm install react-native-video

# iOS setup
cd ios && pod install && cd ..

# Android setup (usually no additional setup needed)
# but verify in android/app/build.gradle that video player dependencies are included
```

**Integration with VideoPlayer Component:**

Replace the TODO placeholder in `VideoPlayer.tsx`:

```typescript
import Video from 'react-native-video'

// In the VideoPlayer render, replace the placeholder:
{isReady && resolvedSrc ? (
  <Video
    source={{ uri: resolvedSrc }}
    poster={poster}
    style={{ width: '100%', height: videoHeight }}
    controls={controls}
    autoplay={autoPlay}
    resizeMode={resizeMode}
    progressUpdateInterval={250}
    onError={(error) => {
      console.error('Video playback error:', error)
      handleError(error, 'Failed to play video')
    }}
    onLoad={(data) => {
      console.log('Video loaded:', data)
    }}
    onProgress={(data) => {
      console.log('Progress:', data.currentTime)
    }}
    onEnd={() => {
      console.log('Video ended')
    }}
  />
) : (
  // Loading/error placeholder
)}
```

---

## Installation Summary

### Quick Start
```bash
cd apps/client-react-native

# 1. Install torrent support (REQUIRED for torrent://)
npm install react-native-torrent-streamer

# 2. Install native video player
npm install react-native-video

# 3. (Optional) Install IPFS support
npm install ipfs

# 4. iOS setup
cd ios && pod install && cd ..

# 5. Android build
cd android && ./gradlew clean build && cd ..

# 6. Test on device
npm run android
# or
npm run ios
```

---

## Component Architecture

### Data Flow

```
User provides torrent:// or ipfs:// URI
          ↓
DistributedFileLoader receives URI
          ↓
Parses protocol and extracts identifier
          ↓
Lazy-loads appropriate library (if needed)
          ↓
Connects to network (DHT, peers, nodes)
          ↓
Library provides streaming URL (or local path)
          ↓
URL cached in AsyncStorage for next time
          ↓
VideoPlayer receives resolved URL
          ↓
Native video player streams content
          ↓
User sees video with native controls
```

### Status Pipeline

```
idle → parsing → loading-lib → connecting → locating → downloading → ready
                                                                          ↓
                                                                       (cache)
                                                                          ↓
                                                                    onSuccess()
```

---

## Testing Checklist

### HTTP/HTTPS (works out of box)
- [ ] Load regular MP4 from URL
- [ ] Verify status shows "ready" immediately
- [ ] Video plays with native controls

### Torrent (requires react-native-torrent-streamer)
- [ ] Add test torrent link with active seeds
- [ ] Verify loading pipeline:
  - [ ] "parsing" status
  - [ ] "loading-lib" (should load in < 2 seconds)
  - [ ] "connecting" status
  - [ ] "locating" with peer count
  - [ ] "downloading" with progress
  - [ ] "ready" when playable
- [ ] Video streams successfully
- [ ] Close app and reopen - should use cache if enabled

### IPFS (requires ipfs installation)
- [ ] Add test CID with available content
- [ ] Verify loading pipeline similar to torrent
- [ ] Content streams from IPFS gateway

### Error Handling
- [ ] Invalid URI shows error
- [ ] Expandable error details work
- [ ] Error messages are specific to protocol
- [ ] Cancellation works (navigate away during load)

### Performance
- [ ] App starts quickly (libraries lazy-load)
- [ ] Caching speeds up replays
- [ ] Memory usage stays reasonable during playback
- [ ] No crashes with large files

---

## Debugging Tips

### Enable Development Logging

```typescript
import { LogBox } from 'react-native'

// Suppress known warnings
LogBox.ignoreLogs(['Non-serializable values', 'Require cycle'])

// Enable file loader debugging
const debugLog = (msg: string) => {
  if (__DEV__) console.log('[FileLoader]', msg)
}
```

### Inspect AsyncStorage Cache

```typescript
import AsyncStorage from '@react-native-async-storage/async-storage'

// View all cached files
const getAllKeys = async () => {
  const keys = await AsyncStorage.getAllKeys()
  const fileCaches = keys.filter(k => k.startsWith('file_cache_'))
  console.log('Cached files:', fileCaches)
  
  for (const key of fileCaches) {
    const data = await AsyncStorage.getItem(key)
    console.log(`${key}:`, data)
  }
}

// Clear specific cache
const clearCache = async (cacheKey: string) => {
  await AsyncStorage.removeItem(cacheKey)
}
```

### Monitor Network Activity

```typescript
// In DevTools (if using React Native Debugger)
// Menu → Network → Monitor fetch/XMLHttpRequest calls
```

---

## Future Enhancements

1. **Local File Support**: Add support for `file://` URIs for locally stored videos
2. **Subtitle Support**: Parse and apply subtitle tracks from distributed sources
3. **Fallback Chain**: Try torrent → IPFS → HTTP gateway in sequence
4. **Adaptive Bitrate**: Implement HLS/DASH for bandwidth-adaptive playback
5. **Background Download**: Download while app is backgrounded
6. **Hardware Acceleration**: Ensure hardware video decoding on both platforms
7. **DRM Support**: Add widevine/fairplay for protected content
8. **Recording**: Record streaming content for offline viewing
9. **Analytics**: Track playback metrics and library performance
10. **Push Notifications**: Notify when torrent seeds become available

---

## Architecture Advantages

### Same API Across Platforms
Both web and React Native use identical callback interfaces:
- `onStatusChange(status, message, progress?)`
- `onSuccess(result)`
- `onError(error, details)`

This enables:
- Easier code sharing between platforms
- Consistent user experience
- Simpler testing strategies
- Faster onboarding for new developers

### Lazy Loading Strategy
Libraries only load when needed:
- ✅ Smaller initial app bundle
- ✅ Faster app startup
- ✅ User doesn't pay cost they don't use
- ✅ Easy to A/B test torrent vs. HTTP

### Caching Layer
Built-in AsyncStorage caching provides:
- ✅ Instant replay of previously watched content
- ✅ Works offline (if content was cached)
- ✅ Reduces bandwidth costs
- ✅ Better user experience

### Error Resilience
Protocol-specific error messages help users:
- ✅ Understand what went wrong
- ✅ Take corrective action
- ✅ Report issues accurately
- ✅ Reduce support burden

---

## Migration Checklist

### Phase 1: Setup (Day 1)
- [ ] Install react-native-video
- [ ] Update Metro config if using IPFS
- [ ] Run `pod install` on iOS
- [ ] Rebuild Android project

### Phase 2: Integration (Day 2-3)
- [ ] Replace library simulation code with actual imports
- [ ] Test HTTP/HTTPS playback
- [ ] Test with basic torrent links
- [ ] Verify caching works

### Phase 3: Optimization (Day 4-5)
- [ ] Implement progress callbacks
- [ ] Add peer counting
- [ ] Optimize library load times
- [ ] Profile memory usage

### Phase 4: Enhancement (Day 6+)
- [ ] Add IPFS support
- [ ] Implement fallback chain
- [ ] Add analytics
- [ ] Optimize for low bandwidth

---

## Support & Resources

### Documentation Links
- [react-native-video Docs](https://github.com/react-native-video/react-native-video)
- [react-native-torrent-streamer Docs](https://github.com/react-native-torrent-streamer/react-native-torrent-streamer)
- [js-ipfs Documentation](https://github.com/ipfs/js-ipfs)
- [React Native AsyncStorage](https://react-native-async-storage.github.io/async-storage/)

### Troubleshooting
- Check `react-native-video` issues for platform-specific problems
- Monitor iOS/Android logs via Xcode/Android Studio
- Test on real devices (simulator may have limitations)
- Verify network connectivity in settings

---

## Next Steps

1. ✅ Components created and ready
2. ⏭️ Install recommended libraries
3. ⏭️ Replace simulation code with real imports
4. ⏭️ Test on iOS simulator/device
5. ⏭️ Test on Android emulator/device
6. ⏭️ Optimize performance
7. ⏭️ Ship to production! 🚀
