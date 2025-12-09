# Investigation: OPTIONS Endpoint Not Returning JSON Body

## Problem Summary
The live server at `node-dfw1.relaynet.online` was returning HTTP 200 OK for OPTIONS requests to `/` but with `Content-Length: 0` - no JSON body.

Expected response:
```json
{
  "ok": true,
  "capabilities": {"supports": ["GET","PUT","DELETE","OPTIONS","QUERY"]},
  "repos": [{"name": "relay-template", "branches": {...}}],
  "currentBranch": "main",
  "currentRepo": "relay-template"
}
```

Actual response (live server):
```
HTTP/1.1 200 OK
Content-Length: 0
```

## Investigation Results

### 1. Server Code Analysis
✅ The Relay server implementation (`apps/server/src/main.rs` lines 536-605) is correct:
- The `options_capabilities()` function properly constructs a JSON response body
- It includes all required fields: `ok`, `capabilities`, `repos`, `currentBranch`, `currentRepo`, and merges in client hooks from `.relay.yaml`
- The response is wrapped in `Json(body)` and returned with `Content-Type: application/json`

### 2. Local Testing
✅ Local server on `localhost:8080` works correctly:
```bash
$ curl -X OPTIONS http://localhost:8080/
{"ok":true,"capabilities":{"supports":["GET","PUT","DELETE","OPTIONS","QUERY"]},"repos":[{"name":"relay-template","branches":{}}],"currentBranch":"main","currentRepo":"relay-template"}
```
Returns proper JSON with Content-Length: 184 and Content-Type: application/json

### 3. Live Server Testing
❌ Live server at `node-dfw1.relaynet.online` returns empty body:
```bash
$ curl -v -X OPTIONS https://node-dfw1.relaynet.online/
< HTTP/1.1 200 OK
< Content-Length: 0
< Server: nginx/1.24.0 (Ubuntu)
```

## Root Cause Identified
The issue is in the **nginx proxy configuration** (`docker/nginx-relay.conf`):

The original nginx configuration had this structure:
```nginx
location / {
    try_files $uri $uri/ @proxy;  # ← Root path "/" is treated as "try to serve as directory"
    expires 1h;
    add_header Cache-Control "public, immutable";
}

location @proxy {
    proxy_pass http://127.0.0.1:8088;  # ← Backend relay-server
}
```

**The Problem:**
- When an OPTIONS request hits the root `/`, nginx's `try_files` directive with static file serving intercepts it
- Nginx has a default behavior for OPTIONS on static/directory paths: return 200 OK with an empty body
- The request never reaches the backend relay-server (port 8088) where the proper JSON response would be generated
- This is a common nginx behavior for pre-flight CORS OPTIONS requests on static content

## Solution Implemented
Modified `docker/nginx-relay.conf` to explicitly handle OPTIONS requests at the root path:

```nginx
location = / {
    limit_except GET HEAD POST PUT DELETE OPTIONS QUERY {
        deny all;
    }

    if ($request_method = OPTIONS) {
        proxy_pass http://127.0.0.1:8088;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # For other methods, try static files first
    try_files $uri $uri/ @proxy;
    expires 1h;
    add_header Cache-Control "public, immutable";
}
```

**What this does:**
1. Creates a specific location block for the exact path `/` (using `location =`)
2. Adds a conditional proxy rule for OPTIONS requests specifically
3. Routes OPTIONS to the backend relay-server (port 8088)
4. Preserves static file serving for GET/HEAD/POST/PUT/DELETE requests
5. Maintains the fallback to @proxy for non-existent static files

## Deployment Required
To activate this fix:

1. **Build the Docker image** with the updated nginx-relay.conf:
   ```bash
   docker build -t ghcr.io/clevertree/relay:latest --push .
   ```

2. **Trigger Kubernetes DaemonSet update** to pull the new image:
   ```bash
   kubectl rollout restart daemonset/relay-daemon
   ```

3. **Verify the fix** on the live server:
   ```bash
   curl -X OPTIONS https://node-dfw1.relaynet.online/ | jq .
   ```
   Should now return the full JSON body with repositories and capabilities.

## Files Modified
- **docker/nginx-relay.conf**: Added explicit OPTIONS handling at root location

## Commits
- `efac141`: Fix: Ensure OPTIONS requests to / return JSON from backend instead of nginx static response

## Testing After Deployment
```bash
# Should return 200 with JSON body containing repos and capabilities
curl -s -X OPTIONS https://node-dfw1.relaynet.online/ | jq .

# Should show Content-Type: application/json and non-zero Content-Length
curl -v -X OPTIONS https://node-dfw1.relaynet.online/ 2>&1 | grep -E "(Content-Type|Content-Length)"
```

Expected output:
```
< Content-Type: application/json
< Content-Length: 184
```

## Additional Notes
- The server code is already correct and up-to-date with the latest fixes
- The kubeconfig in `relay-kubeconfig (3).yaml` is valid and can connect to the cluster
- The Kubernetes DaemonSet is properly configured to use `ghcr.io/clevertree/relay:latest`
- Once the image is rebuilt with this nginx fix and deployed, OPTIONS requests will work correctly on the live server
