# .relay.yaml Configuration Guide

## Overview

The `.relay.yaml` file is a **required** configuration file that must exist at the root of your Git repository. It
defines the capabilities and hook paths for the Relay server, enabling clients to discover and execute
repository-specific functionality.

## Purpose

The `.relay.yaml` file serves as a manifest that:

1. **Defines client hooks** - Specifies paths to JavaScript/JSX modules that handle GET and search/query operations
2. **Declares server capabilities** - Lists supported operations (GET, PUT, DELETE, OPTIONS, QUERY)
3. **Configures repository metadata** - Provides name, version, and description

## OPTIONS Endpoint

Clients discover repository capabilities by making an `OPTIONS` request to `/`:

```bash
curl -X OPTIONS http://localhost:8080/
```

The server responds with a JSON object that includes:

- Repository information (name, branches, repos)
- **Client hooks paths** from `.relay.yaml` (critical for UI rendering)
- Supported capabilities (GET, PUT, DELETE, etc.)

## Required Structure

```yaml
# Repository metadata (optional but recommended)
name: "Your Repository Name"
version: "1.0.0"
description: "Your repository description"

# CLIENT CONFIGURATION (REQUIRED)
client:
  hooks:
    # Handler for GET requests - displays repository content
    get:
      path: /hooks/get-client.jsx    # Must be a valid path in the repository
    
    # Handler for search/query operations
    query:
      path: /hooks/query-client.jsx  # Must be a valid path in the repository

# SERVER CONFIGURATION (Optional)
server:
  hooks:
    pre-commit:
      path: /hooks/pre-commit.mjs
    pre-receive:
      path: /hooks/pre-receive.mjs

# CAPABILITIES (Optional)
capabilities:
  supports:
    - GET
    - PUT
    - DELETE
    - OPTIONS
    - QUERY
```

## Hook Paths

### get hook (`client.hooks.get.path`)

**Required**: YES  
**Type**: JavaScript/JSX module  
**Purpose**: Renders repository content when the client requests a file or directory

The hook receives a context object with:

- `React` - React library for JSX
- `params` - Query parameters and path information
- `helpers.navigate(path)` - Function to navigate to a different path
- `helpers.loadModule(path)` - Function to dynamically load other modules
- `FileRenderer` - Component for rendering file content
- `buildPeerUrl(path)` - Function to construct URLs for peer requests

**Example**:

```jsx
// /hooks/get-client.jsx
export default async function GetHook(ctx) {
  const { React, params, FileRenderer } = ctx;
  return React.createElement(FileRenderer, {
    path: params.path
  });
}
```

### query hook (`client.hooks.query.path`)

**Required**: YES  
**Type**: JavaScript/JSX module  
**Purpose**: Handles search and filtering operations

## Error Handling

### Missing .relay.yaml

If `.relay.yaml` does not exist in the repository:

- Server will log a warning: `"Missing .relay.yaml in repository"`
- OPTIONS request will still succeed, but `client.hooks` will be empty
- Clients will display an error: **"Missing hook path in OPTIONS. Ensure .relay.yaml has client.hooks.get.path"**

### Missing hook paths

If `client.hooks.get.path` or `client.hooks.query.path` are not defined:

- Client will retry once to refresh the configuration
- If still missing, client will display error with guidance to add paths to `.relay.yaml`

## Adding .relay.yaml to Your Repository

### 1. Create the file at repository root

```bash
cat > .relay.yaml << 'EOF'
name: "My Repository"
version: "1.0.0"

client:
  hooks:
    get:
      path: /hooks/get-client.jsx
    query:
      path: /hooks/query-client.jsx
EOF
```

### 2. Commit to Git

```bash
git add .relay.yaml
git commit -m "Add .relay.yaml with client hook configuration"
```

### 3. Create hook implementations

Create the JavaScript/JSX hook files at the paths specified in `.relay.yaml`:

```bash
mkdir -p hooks
touch hooks/get-client.jsx
touch hooks/query-client.jsx
```

### 4. Verify configuration

Test the OPTIONS endpoint:

```bash
curl -X OPTIONS http://localhost:8080/ | jq '.client.hooks'
```

Expected response:

```json
{
  "hooks": {
    "get": {
      "path": "/hooks/get-client.jsx"
    },
    "query": {
      "path": "/hooks/query-client.jsx"
    }
  }
}
```

## Client Support

### Web Client (client-web)

The web client makes an OPTIONS request on initialization and extracts `client.hooks.get.path` and
`client.hooks.query.path` to discover how to render content.

### React Native Client (client-react-native)

The React Native client uses the same OPTIONS discovery mechanism to load hook implementations dynamically.

## Best Practices

1. **Version control .relay.yaml** - Always commit it to your repository
2. **Keep paths consistent** - Use `/hooks/` directory for all hook implementations
3. **Document hooks** - Add comments in hook implementations explaining their behavior
4. **Test discovery** - Verify OPTIONS response after updating `.relay.yaml`
5. **Provide defaults** - If hooks reference other modules, bundle them in the repository

## Migration Guide

If you're upgrading from an older version without `.relay.yaml`:

1. Create `.relay.yaml` at repository root
2. Define paths to your existing hook implementations
3. Commit and push to main branch
4. Restart server or webhook to pick up new configuration
5. Clients should now display content correctly

## See Also

- [Server OPTIONS Endpoint](../README.md#options-endpoint)
- [Hook Development](./hooks.md)
- [Repository Structure](./repository-structure.md)
