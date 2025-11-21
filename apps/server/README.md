Relay Server (Rust)

Implements the Relay API over a bare Git repository.

Endpoints
- POST /status — returns status, branches, sample paths, capabilities
- GET /{path} — read file at branch (header X-Relay-Branch, default main)
- PUT /{path} — write file and commit to branch
- DELETE /{path} — delete file and commit to branch
- POST /query/{path?} — 501 Not Implemented (recommended to index via hooks + SQLite)

Env
- RELAY_REPO_PATH: path to a bare repo (default ./data/repo.git)
- RELAY_BIND: address (default 0.0.0.0:8088)

Run
cargo run --manifest-path Cargo.toml
