# Relay - Distributed Repository Protocol Implementation

A modern, cross-platform implementation of the Relay protocol for distributed file management, search, and content delivery. Built with React, TypeScript, Rust, and Node.js.

## Quick Start

### Prerequisites
- Node.js 18+ and npm
- Docker (for containerized deployment)
- Rust (for building native modules, optional)

### Local Development

```bash
# Install dependencies
npm install

# Start development server (Vite + template server on localhost:3000)
npm run web:dev:full

# Run tests
npm run test

# Build for production
npm run build
```

### Docker Deployment

```bash
# Build Docker image
docker build -t relay:latest .

# Run container
docker run -p 3000:3000 -p 3001:3001 relay:latest

# Access at http://localhost:3000
```

## Project Structure

```
relay/
├── apps/
│   ├── client-web/           # React web client (TypeScript)
│   ├── client-react-native/  # React Native mobile app
│   ├── server/               # Node.js backend (if applicable)
│   ├── extension/            # Browser extension
│   └── shared/               # Shared utilities
├── crates/                   # Rust modules
│   ├── relay-cli/            # Command-line interface
│   ├── relay-lib/            # Core library
│   └── streaming-files/      # File streaming implementation
├── template/                 # Template system for dynamic hooks
│   ├── hooks/                # GET/PUT/Query hooks
│   ├── components/           # JSX components (MovieResults, CreateView, Layout)
│   └── plugins/              # TMDB, YTS integrations
├── docs/                     # Documentation
├── docker/                   # Docker configuration
├── scripts/                  # Build and deployment scripts
├── terraform/                # Infrastructure as Code
└── data/                     # Data files and git repos
```

## Key Features

### Web Client
- **Modern UI** - React 19 with TypeScript
- **Real-time Updates** - Live search with TMDB/YTS integrations
- **Dynamic Components** - JSX-based template system with runtime transpilation
- **Responsive Design** - Cross-platform styling with Tailwind CSS
- **Plugin Architecture** - Extensible content handlers

### Template System
- **Hook-based Architecture** - GET/PUT/Query hooks for repository operations
- **Dynamic JSX Loading** - Components loaded and transpiled at runtime via Babel standalone
- **Relative Path Resolution** - Centralized path resolver for consistent URL handling
- **FileRenderer** - Supports markdown, code, images, and videos

### Protocol Implementation
- **OPTIONS Discovery** - Repository capability advertisement
- **GET/PUT/DELETE** - Standard HTTP operations
- **Query Interface** - Custom search and filtering
- **Branch Support** - Multi-branch repository handling
- **Peer-to-Peer** - Support for distributed peers

## Development Workflow

### Running Dev Server
```bash
npm run web:dev:full
```

This starts:
- **Vite dev server** on port 5173 (hot module reloading)
- **Template server** on port 3001 (serves /template files)
- **Proxy server** on port 3000 (combines both)

### Building Template Components

Template components are JSX files loaded dynamically at runtime:

```jsx
// template/hooks/client/components/MovieResults.jsx
/** @jsx h */

export function renderMovieResults(h, results, source, onPageChange, onViewMovie, theme = null) {
  // Component implementation
  return h('div', {}, /* content */)
}
```

Key patterns:
- Use `/** @jsx h */` pragma for classic JSX runtime
- Export functions, not components
- Accept `h` (createElement) as first parameter
- No ES6 imports (use `helpers.loadModule()` for dynamic loading)
- Use optional `theme` parameter for styling

### Path Resolution

All paths within `/template` go through the centralized `resolvePath()` function:

```javascript
// In hooks:
const module = await helpers.loadModule('./components/Layout.jsx')
const url = helpers.resolvePath('hooks/client/get-client.jsx')

// Direct fetches:
const response = await fetch(helpers.resolvePath('/README.md'))
```

This ensures:
- No double slashes in URLs
- Consistent relative path handling
- Proper base URL joining using URL constructor

## Configuration

### .relay.yaml

Define hook paths and repository capabilities:

```yaml
name: "Movie Repository"
version: "1.0.0"
client:
  hooks:
    get:
      path: hooks/client/get-client.jsx
    query:
      path: hooks/client/query-client.jsx
```

### Environment Variables

- `NODE_ENV` - Development or production
- `VITE_API_URL` - Backend API URL
- `DOCKER_REGISTRY` - Container registry (for deployments)

## Deployment

### Local Docker
```bash
docker build -t relay:latest .
docker run -p 3000:3000 relay:latest
```

### Production Deployments
- See `/docs/relay-yaml-configuration.md` for OPTIONS setup
- See `/docs/web-client-architecture.md` for architecture
- See `terraform/` for infrastructure as code
- See `docker/` for container configurations

## Troubleshooting

### Dev Server Issues
- **404 errors** - Verify paths in `.relay.yaml` don't have leading slashes
- **Double slashes in URLs** - Use `resolvePath()` or native `URL` constructor
- **Module loading errors** - Check browser console for Babel transpilation errors
- **Content-Type wrong** - Verify dev-server's `contentTypeMap` includes file extension

### Template Component Errors
- **Unexpected token '<'** - Ensure files use `/** @jsx h */` pragma
- **Module not found** - Use relative paths starting with `./` for dynamic imports
- **Theme undefined** - Pass theme as optional parameter, provide fallback defaults

## Documentation

- [Web Client Architecture](/docs/web-client-architecture.md)
- [Plugin Interface](/docs/plugin-interface.md)
- [Relay YAML Configuration](/docs/relay-yaml-configuration.md)
- [Repository Script System](/docs/repo-script-system.md)
- [Cross-Platform Styling Guide](/docs/CROSS_PLATFORM_STYLING_GUIDE.md)
- [Template Refactoring](/docs/TEMPLATE_REFACTORING_COMPLETE.md)
- [Project Vision](/docs/relay_project_vision.md)

## Architecture Decisions

### Babel Standalone for JSX
Template components use `@babel/standalone` for runtime JSX transpilation. This allows:
- Dynamic component loading without build step
- Classic JSX runtime with `/** @jsx h */` pragma
- Hot component updates during development

Trade-offs:
- Transpilation happens in browser (slower, but acceptable for template components)
- No tree-shaking or code splitting for templates
- Components must avoid ES6 imports

### Monorepo Structure
- Single repo with multiple apps (web, mobile, server, extension)
- Shared utilities in `apps/shared/`
- Rust modules in `crates/` for performance-critical code
- Workspace setup allows coordinated releases

### Hook-Based Routing
Instead of traditional REST API:
- GET hooks render content for arbitrary paths
- Query hooks handle search/filtering
- PUT hooks handle form submissions
- Allows flexible content-driven routing

## Performance Considerations

- **Code Splitting** - Vite handles automatic code splitting in dev
- **Lazy Loading** - Components loaded on-demand via `helpers.loadModule()`
- **Caching** - Use cache headers on static assets
- **Streaming** - Large files use streaming via `streaming-files` crate

## Contributing

1. Create feature branch: `git checkout -b feature/name`
2. Make changes and test locally: `npm run web:dev:full`
3. Build and test Docker image
4. Push and create pull request
5. See `/docs/git-branch-rules.md` for branching strategy

## License

See LICENSE file for details.

## Support

- GitHub Issues: Report bugs and request features
- Documentation: See `/docs/` directory
- Vision Document: `/docs/relay_project_vision.md`
