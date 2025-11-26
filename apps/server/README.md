Relay Server (Rust)

Implements the Relay API over a bare Git repository.

Repository policy
- Never import or reference files directly from `apps/` other than code in this crate; prefer shared assets and data in shared crates.

Endpoints
- OPTIONS / and OPTIONS /* — discovery endpoint returning capabilities, branches, repos, current selections, and branch HEAD commits (branchHeads). If `X-Relay-Branch` or `X-Relay-Repo` headers (or `?branch=`/`?repo=` query) are sent, the response is filtered accordingly.
- GET /{path} — read file at branch/repo (branch via header X-Relay-Branch or query `?branch=...`, repo via header X-Relay-Repo or query `?repo=...`).
  - If the path resolves to a directory, returns a markdown listing with breadcrumbs and links.
  - If the file/dir is missing, returns 404 with `text/html` body. If `/site/404.md` exists on that branch, it is rendered; otherwise a default page plus a parent directory listing is returned. Global and per-directory CSS are auto-linked when present.
- PUT /{path} — write file and commit to selected branch/repo (branch via header or query `?branch=...`; repo via header or query `?repo=...`).
  - Commits are validated by the hooks runner (`relay-hooks`) via a pre-receive check. Rejected commits return 400/500 with error text.
- DELETE /{path} — delete file and commit to selected branch/repo (branch via header or query `?branch=...`).
- QUERY * — Custom method for YAML-driven query using the local PoloDB index built by hooks (no POST alias).
  - Pagination defaults: pageSize=25, page=0; can override via request body
  - Header X-Relay-Branch may be a branch name or `all` to query across branches
  - Request body (generic): `{ filter?: object, page?: number, pageSize?: number, sort?: [{ field, dir }] }`
  - Response: `{ total, page, pageSize, items }`

Env
- RELAY_REPO_PATH: path to a bare repo (default ./data/repo.git)
- RELAY_BIND: address (default 0.0.0.0:8088)
- RELAY_HOOKS_BIN: optional path to the hooks runner binary (default `relay-hooks` on PATH)
- RELAY_DB_PATH: optional path to the local PoloDB file (default `<gitdir>/relay_index.polodb`)
// Tracker self-registration (optional)
- RELAY_TRACKER_URL: tracker base URL (e.g., https://relaynet.online)
- RELAY_SOCKET_URL: the public socket URL of this server (e.g., http://localhost:8088)
- RELAY_REPOS: optional comma-separated list of repo subdirectories to report (if omitted, discovered from the current branch)
- RELAY_REGISTER_BRANCH: which branch to scan for repo discovery (default: main)

Rules
- The server will read `relay.yaml` from the default branch (main) when serving `/status` and return it as JSON.
- `rules.db` defines a minimal, engine-agnostic config for PoloDB: collection, unique keys, indexes, field mapping, and queryPolicy (allowed fields/ops, sort, pagination).
- Rules are enforced for new commits by the Git hooks crate (`crates/hooks`). The hooks also maintain the local PoloDB index by mapping meta.json documents into DB documents per `rules.db.mapping`.

Testing policy
- For tests that require a repository with `relay.yaml`, tests may clone from the canonical template repository: `https://github.com/clevertree/relay-template/`.
- The hooks runner enforces that `relay.yaml` exists and validates it; writes/commits will be rejected if `relay.yaml` is missing or invalid.

Run
1) Build everything
   cargo build --workspace

2) Run server (ensure hooks binary is reachable)
   # Windows PowerShell
   $env:RELAY_HOOKS_BIN = "${pwd}\target\debug\relay-hooks.exe"; cargo run --manifest-path apps/server/Cargo.toml

3) Try requests
   - Root listing with breadcrumbs:
     curl -i "http://localhost:8088/?branch=main"
   - Put a file (validates via hooks):
     curl -i -X PUT "http://localhost:8088/README.md?branch=main" \
       -H "Content-Type: application/octet-stream" \
       --data-binary @-
     Hello Relay!
     [Ctrl+D]
   - Fetch it:
     curl -i "http://localhost:8088/README.md?branch=main"
   - Query (POST):
     curl -i -X POST "http://localhost:8088/query" -H "X-Relay-Branch: main" -H "Content-Type: application/json" --data '{"filter":{"title":"Inception"}}'
   - Query (QUERY alias):
     curl -i -X QUERY "http://localhost:8088" -H "X-Relay-Branch: main" -H "Content-Type: application/json" --data '{"filter":{"title":"Inception"}}'

Logs
- Structured logs are written to stdout and to rolling daily files under `./logs/server.log*`.
- HTTP request/response spans are included (method, path, status, latency).
