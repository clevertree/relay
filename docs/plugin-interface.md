# Plugin Interface Architecture

This document describes the plugin interface system used by Relay clients to render markdown content with native components.

## Overview

The Relay client ecosystem uses a **plugin architecture** where each platform (web, Android, iOS, desktop) implements the same component interface. This allows:

1. **Consistent markdown rendering** across all platforms
2. **Native performance** by using platform-specific media players
3. **Security** through component whitelisting
4. **Extensibility** by adding new components over time

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Markdown Content                      │
│  "# Hello\n<Video src='video.mp4' />\nSome text..."    │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Markdown Parser                        │
│  - Parses markdown to AST                               │
│  - Extracts custom components                           │
│  - Validates against whitelist                          │
└─────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────┐
│                   Plugin Interface                       │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│  │  Video  │ │  Image  │ │  Audio  │ │   ...   │       │
│  └─────────┘ └─────────┘ └─────────┘ └─────────┘       │
└─────────────────────────────────────────────────────────┘
                            │
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌───────────┐   ┌───────────┐   ┌───────────┐
    │    Web    │   │  Android  │   │    iOS    │
    │  Plugin   │   │  Plugin   │   │  Plugin   │
    │           │   │           │   │           │
    │ HTML5     │   │ ExoPlayer │   │ AVPlayer  │
    │ <video>   │   │           │   │           │
    └───────────┘   └───────────┘   └───────────┘
```

## Plugin Interface

Each plugin must implement the `Plugin` interface:

```typescript
interface Plugin {
  // Identification
  name: string
  version: string
  platform: 'web' | 'android' | 'ios' | 'desktop'
  
  // Component registry
  components: PluginComponents
  
  // Configuration
  config: PluginConfig
  
  // Content fetching
  fetchContent: (path: string) => Promise<string>
  
  // Navigation (optional)
  navigate?: (path: string) => void
  
  // Media capabilities (optional)
  getMediaCapabilities?: () => Promise<MediaCapabilities>
}
```

## Component Registry

The `PluginComponents` interface defines all available components:

```typescript
interface PluginComponents {
  Video: ComponentType<VideoProps>
  Image: ComponentType<ImageProps>
  Audio: ComponentType<AudioProps>
  Link: ComponentType<LinkProps>
  CodeBlock: ComponentType<CodeBlockProps>
}
```

### Current Components

| Component | Purpose | Props |
|-----------|---------|-------|
| `Video` | Video playback | `src`, `poster`, `width`, `height`, `autoplay`, `loop`, `muted`, `controls`, `preload` |
| `Image` | Image display | `src`, `alt`, `width`, `height`, `loading` |
| `Audio` | Audio playback | `src`, `autoplay`, `loop`, `muted`, `controls`, `preload` |
| `Link` | Navigation | `href`, `target`, `rel` |
| `CodeBlock` | Code display | `language`, `filename` |

### Adding New Components

To add a new component:

1. Define the props interface in `plugins/types.ts`:
   ```typescript
   export interface NewComponentProps extends BaseComponentProps {
     // ... props
   }
   ```

2. Add to `PluginComponents`:
   ```typescript
   interface PluginComponents {
     // ...existing
     NewComponent: ComponentType<NewComponentProps>
   }
   ```

3. Add to `ALLOWED_COMPONENTS`:
   ```typescript
   export const ALLOWED_COMPONENTS = [
     // ...existing
     'NewComponent',
   ]
   ```

4. Implement in each platform plugin.

## Security: Component Whitelisting

**Only components in the whitelist are rendered.** All other HTML tags and components are stripped.

```typescript
const ALLOWED_COMPONENTS = [
  'Video',
  'Image',
  'Audio',
  'Link',
  'CodeBlock',
]

function isAllowedComponent(name: string): boolean {
  return ALLOWED_COMPONENTS.includes(name)
}
```

This prevents:
- XSS attacks via `<script>` tags
- Malicious `<iframe>` embedding
- Arbitrary HTML injection

## Usage in Markdown

### Basic Syntax

Components are used with self-closing or paired tag syntax:

```markdown
# My Video

<Video src="/media/intro.mp4" poster="/media/poster.jpg" controls />

Or with a caption:

<Video src="/media/intro.mp4" controls>
  Introduction video
</Video>
```

### Component Detection

The markdown parser looks for patterns:

1. **Self-closing**: `<ComponentName prop="value" />`
2. **Paired tags**: `<ComponentName prop="value">content</ComponentName>`

### Props Parsing

Props are parsed from the tag:

```markdown
<Video src="video.mp4" autoplay loop muted />
```

Becomes:
```javascript
{
  src: "video.mp4",
  autoplay: true,
  loop: true,
  muted: true
}
```

## Platform Implementations

### Web Plugin

Uses HTML5 elements:
- `<video>` for Video component
- `<img>` for Image component
- `<audio>` for Audio component

Location: `apps/client-web/src/plugins/web/`

### Android Plugin (Planned)

Will use native Android components:
- ExoPlayer for Video/Audio
- Glide/Coil for Image loading

### iOS Plugin (Planned)

Will use native iOS components:
- AVPlayer for Video/Audio
- UIImageView with SDWebImage for images

### Desktop Plugin (Planned)

Will use cross-platform libraries:
- libmpv/gstreamer for media
- System image loading

## Client-Side Routing

The web client handles navigation internally:

1. **Intercept clicks** on internal links
2. **Update URL** with `history.pushState()`
3. **Fetch content** from Relay server
4. **Render markdown** without page reload

```typescript
// In Link component
const handleClick = (e: React.MouseEvent) => {
  if (isInternalLink(href)) {
    e.preventDefault()
    window.history.pushState({}, '', href)
    // Triggers content fetch
  }
}
```

## Content Fetching

Plugins fetch content from the Relay server:

```typescript
async fetchContent(path: string): Promise<string> {
  const response = await fetch(path, {
    headers: {
      'X-Relay-Branch': this.config.branch,
      'X-Relay-Repo': this.config.repo,
    }
  })
  return response.text()
}
```

## Configuration

Plugins accept configuration:

```typescript
interface PluginConfig {
  baseUrl?: string           // Server base URL
  headers?: Record<string, string>  // Custom headers
  branch?: string            // Git branch
  repo?: string              // Repository name
}
```

## Future Enhancements

### Planned Components

- `<Gallery>` - Image gallery with lightbox
- `<Embed>` - Safe embedding (YouTube, etc.)
- `<Table>` - Enhanced data tables
- `<Chart>` - Data visualization
- `<Map>` - Geographic maps

### Planned Features

- Component caching
- Offline support
- Progressive loading
- Accessibility improvements
