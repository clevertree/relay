# IPFS Plan (Node, Seeding/Serving/Caching)

This document proposes how Relay nodes run an embedded IPFS (Kubo) daemon and how the relay server and nginx cooperate
to serve content from Git and IPFS with on‑demand fetching and local caching.

Goals:

- Each deployed Relay node runs its own IPFS daemon for low‑latency access and seeding.
- HTTP GET requests first read from the Git checkout by branch; if the file is missing, read from the IPFS workspace for
  that repo/branch; if still missing, fetch on‑demand from IPFS and then serve.
- Keep the triggering HTTP GET open while we search and (optionally) fetch, with a 10 second timeout.
- Cache locally after the first fetch so later requests are fast.

---

## 1) IPFS node in Docker

The base image installs Kubo and starts it from the entrypoint:

- Binary: `ipfs` (Kubo)
- Repo path: `/srv/relay/ipfs` (set via `IPFS_PATH`)
- API: `http://127.0.0.1:5001` inside the container
- Gateway: `http://0.0.0.0:8080` (can be used for manual debugging; not required for serving)
- Swarm: TCP 4001 and QUIC 4001/udp (both bound to `0.0.0.0`)

Ports exposed by the image (already wired):

- 4001/tcp (swarm)
- 4001/udp (swarm QUIC)
- 5001/tcp (IPFS API)
- 8080/tcp (IPFS gateway)

Entrypoint ensures:

- `Addresses.API = /ip4/0.0.0.0/tcp/5001`
- `Addresses.Gateway = /ip4/0.0.0.0/tcp/8080`
- `Addresses.Swarm` includes TCP and QUIC: `/ip4/0.0.0.0/tcp/4001`, `/ip4/0.0.0.0/udp/4001/quic-v1`

Usage inside the container:

```
IPFS_PATH=/srv/relay/ipfs ipfs repo stat
curl -s http://127.0.0.1:5001/api/v0/id
```

Note: All internal RPC calls should use `http://127.0.0.1:5001`.

---

## 2) Directory layout for seeding/caching

We keep an explicit, branch‑scoped IPFS workspace per repo:

```
/srv/relay/ipfs-cache/
  <repo-name>/
    <branch>/
      ... arbitrary subpaths mirrored from the IPFS directory tree ...
```

Important constraints:

- We do not store files by content hash; the IPFS root directory hash (CID) may change over time.
- The workspace mirrors the directory layout under that root hash so HTTP routes align with paths in Git.
- The workspace acts both as a local cache (served immediately) and a seed source (pinned and re‑announced by the local
  node).

---

## 3) Reading the IPFS root from relay.yaml

When a relay node first clones a repo (or on update), it reads `relay.yaml` in the repo root for:

```
ipfs:
  rootHash: "<CID>"
  branches: ["main", "staging", ...]
```

Behavior:

- If `ipfs.rootHash` exists, ensure we have a workspace directory: `/srv/relay/ipfs-cache/<repo-name>/<branch>/`.
- Do not automatically prefetch the entire tree. Only fetch files on demand.
- Track the current `<CID>` per branch so future requests use the latest hash after commits.

---

## 4) HTTP request flow (Git → IPFS cache → IPFS network)

Given a GET request for `/{branch}/<subpath>`:

1. Check Git checkout for that branch. If file exists and is allowed by policy, serve it immediately.
2. If missing (forbidden or `.gitignore`d), check the IPFS workspace: `/srv/relay/ipfs-cache/<repo>/<branch>/<subpath>`.
    - If found, serve immediately.
3. If still missing, attempt on‑demand fetch from IPFS, using the current `ipfs.rootHash` for that branch:
    - Construct the IPFS path: `/ipfs/<rootCID>/<subpath>`.
    - Fetch via the embedded node using one of:
        - RPC: `POST /api/v0/get?arg=/ipfs/<rootCID>/<subpath>` writing to the branch workspace path, or
        - CLI: `ipfs get /ipfs/<rootCID>/<subpath> -o /srv/relay/ipfs-cache/<repo>/<branch>/<subpath>`
    - Pin or add to MFS for durability: `ipfs files cp /ipfs/<rootCID>/<subpath> /<repo>/<branch>/<subpath>` (optional),
      and/or `ipfs pin add` for the fetched CID.
4. Serve the file once it becomes locally available, subject to the 10s timeout below.

Timeout and status codes:

- Keep the original HTTP request open while steps 1–3 occur, up to 10 seconds.
- If the file is confirmed not present in the IPFS directory (path not found under `<rootCID>`): return `404 Not Found`.
- If the file does exist in the IPFS directory but could not be fetched within 10 seconds (network slow or peers
  unavailable): return `503 Service Unavailable`.

Caching policy:

- Successfully fetched files are written into the branch workspace and served from there on subsequent requests.
- Optional: set OS‑level `sendfile` or zero‑copy sends via nginx for large static files.

---

## 5) Nginx vs Relay server: responsibilities

Recommended split:

- Relay server (Rust): owns the decision tree (Git → cache → IPFS), IPFS RPC calls, branch/hash tracking, and the 10s
  request‑lifetime orchestration.
- Nginx: reverse proxy and TLS termination only; configure timeouts to allow up to 10 seconds for upstream responses.

Nginx example (conceptual):

```
proxy_read_timeout 10s;
proxy_send_timeout 10s;
proxy_connect_timeout 2s;
proxy_buffering off;          # stream back as soon as the server has bytes
sendfile on;                  # for static files when served directly by nginx (optional)
tcp_nopush on;                # optimize large file sends
```

Why server‑side orchestration?

- The server knows per‑repo branch policies, allowed paths, and the latest `rootHash` from `relay.yaml`.
- It can atomically check local paths and drive IPFS RPC calls while holding the same HTTP request context and enforcing
  the 10s ceiling.

Note: If you prefer nginx to directly serve the IPFS workspace directory for cache hits, we can add an internal location
block that aliases `/srv/relay/ipfs-cache` and only fall through to the server for cache misses. Confirm if you want
this variant.

Open question to confirm with stakeholders:

- Keep the orchestration in the Relay server (recommended), with nginx handling TLS/timeout only? Or shift more
  static‑file serving logic into nginx and implement a miss‑handler endpoint in the server? This repo currently favors
  server‑side control.

---

## 6) Updating the root hash after commits

When a commit updates `relay.yaml: ipfs.rootHash`:

- Update the in‑memory/latest mapping for `<repo>/<branch> → <rootCID>`.
- Do not move or recreate the workspace path; continue to seed/serve from `/srv/relay/ipfs-cache/<repo>/<branch>/`.
- Future on‑demand fetches use the new `<rootCID>` while reusing the same local directory.
- Optionally, prune cached files no longer present under the new root (policy‑driven, not required initially).

---

## 7) Implementation notes for the Relay server

Minimal API/logic required:

- On repo clone/open: parse `relay.yaml` and stash `ipfs.rootHash` per branch.
- Add a static file handler that applies the decision tree with a 10s timeout, returning 200/404/503 per rules.
- IPFS client:
    - Preferred: HTTP RPC client to `http://127.0.0.1:5001/api/v0` to call `files/stat`, `get`, `pin/add` as needed.
    - Alternative: spawn `ipfs` CLI with `IPFS_PATH=/srv/relay/ipfs` (more overhead; OK for MVP).
- Concurrency: de‑duplicate concurrent fetches of the same file via in‑process locking; allow other requests to wait for
  the same result up to 10s.
- Telemetry: log fetch duration, CID path, and outcome (hit/miss/fetch/timeout).

Security and correctness:

- Validate `subpath` to prevent directory traversal.
- Enforce `allowedPaths` from `relay.yaml` for Git‑backed files; IPFS fallbacks only apply where Git denies or doesn’t
  have content.
- Rate‑limit initial fetches to avoid stampedes.

---

## 8) Operational commands (reference)

Within the container:

```
# IPFS health
curl -s http://127.0.0.1:5001/api/v0/id | jq .

# Fetch a single file manually to workspace
mkdir -p /srv/relay/ipfs-cache/<repo>/<branch>/path/to
ipfs get /ipfs/<rootCID>/path/to/file -o /srv/relay/ipfs-cache/<repo>/<branch>/path/to/file

# Pin fetched content (optional)
ipfs pin add /ipfs/<rootCID>/path/to/file
```

---

## 9) Configuration summary

- IPFS repo path: `/srv/relay/ipfs`
- IPFS API: `http://127.0.0.1:5001`
- IPFS gateway: `http://0.0.0.0:8080` (debugging)
- Local cache root: `/srv/relay/ipfs-cache`
- Workspace per branch: `/srv/relay/ipfs-cache/<repo>/<branch>/`
- HTTP timeout: 10 seconds (nginx `proxy_read_timeout`, plus server‑side deadline)

---

## 10) Next steps

1. Implement the server handler for the Git → cache → IPFS decision tree with deadline and status code semantics.
2. Optionally wire nginx to serve cache hits directly via `alias` to `/srv/relay/ipfs-cache` for very large static
   files.
3. Add tests covering: cache hit, cache miss with successful fetch (<10s), cache miss with slow fetch (503), and
   not‑found under CID (404).
