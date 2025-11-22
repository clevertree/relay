Relay Server (Rust)

Implements the Relay API over a bare Git repository.

Endpoints
- POST /status — returns status, branches, sample paths, capabilities
  - Includes `rules` if the repository contains a `rules.yaml` at root (returned as JSON)
  - Honors `rules.indexFile` to set the suggested default index document in response.samplePaths.index
- GET /{path} — read file at branch (branch via header X-Relay-Branch or query `?branch=...`, default `main`)
  - If the path resolves to a directory, returns a markdown listing with breadcrumbs and links.
  - If the file/dir is missing, returns 404 with `text/markdown` body. If `/404.md` exists on that branch, it is rendered. Otherwise, the body includes a cause and a parent directory listing.
- PUT /{path} — write file and commit to branch (branch via header or query `?branch=...`).
  - Commits are validated by the hooks runner (`relay-hooks`) via a pre-receive check. Rejected commits return 400/500 with error text.
- DELETE /{path} — delete file and commit to branch (branch via header or query `?branch=...`).
- POST /query/{path?} — Policy-driven query using the local SQLite index built by hooks
  - Pagination defaults: pageSize=25, page=0; can override via request body
  - Header X-Relay-Branch may be a branch name or `all` to query across branches

Env
- RELAY_REPO_PATH: path to a bare repo (default ./data/repo.git)
- RELAY_BIND: address (default 0.0.0.0:8088)
- RELAY_HOOKS_BIN: optional path to the hooks runner binary (default `relay-hooks` on PATH)

Rules
- The server will read `rules.yaml` from the default branch (main) when serving `/status` and return it as JSON.
- See `packages/protocol/rules.schema.yaml` for the schema to validate rules files.
- Rules are enforced for new commits by the Git hooks crate (`crates/hooks`). Existing files are not retroactively validated.
 - The `rules.db` section declares the SQLite schema and policies. The server executes `rules.db.queryPolicy` for `/query`.

Testing policy
- For all tests that require a repository with `rules.yaml`, tests will clone from the canonical template repository: `https://github.com/clevertree/relay-template/`.
- The hooks runner enforces that `rules.yaml` exists and validates it; writes/commits will be rejected if `rules.yaml` is missing or invalid.

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
   - Missing path (404 markdown with parent listing):
     curl -i "http://localhost:8088/does/not/exist.md?branch=main"

Logs
- Structured logs are written to stdout and to rolling daily files under `./logs/server.log*`.
- HTTP request/response spans are included (method, path, status, latency).
