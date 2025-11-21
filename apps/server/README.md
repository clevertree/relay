Relay Server (Rust)

Implements the Relay API over a bare Git repository.

Endpoints
- POST /status — returns status, branches, sample paths, capabilities
  - Includes `rules` if the repository contains a `rules.yaml` at root (returned as JSON)
  - Honors `rules.indexFile` to set the suggested default index document in response.samplePaths.index
- GET /{path} — read file at branch (header X-Relay-Branch, default main)
- PUT /{path} — write file and commit to branch
- DELETE /{path} — delete file and commit to branch
- POST /query/{path?} — Policy-driven query using the local SQLite index built by hooks
  - Pagination defaults: pageSize=25, page=0; can override via request body
  - Header X-Relay-Branch may be a branch name or `all` to query across branches

Env
- RELAY_REPO_PATH: path to a bare repo (default ./data/repo.git)
- RELAY_BIND: address (default 0.0.0.0:8088)

Rules
- The server will read `rules.yaml` from the default branch (main) when serving `/status` and return it as JSON.
- See `packages/protocol/rules.schema.yaml` for the schema to validate rules files.
- Rules are enforced for new commits by the Git hooks crate (`crates/hooks`). Existing files are not retroactively validated.
 - The `rules.db` section declares the SQLite schema and policies. The server executes `rules.db.queryPolicy` for `/query`.

Run
cargo run --manifest-path Cargo.toml
