# Repo script-driven logic

## Overview

The repository uses a script-based validation system where custom logic is defined in `.relay/` scripts. The server focuses on routing, authentication, and Git plumbing. When the HTTP server needs to:

- validate incoming commits, `write_file_to_repo` extracts `.relay/pre-commit.mjs` from the new commit, runs it with `OLD_COMMIT`/`NEW_COMMIT` metadata, and aborts the commit if the script exits non-zero.
- serve discovery information, it can execute `.relay/options.mjs` to gather server metadata, repositories, and branches.

## Architecture

### Hook Scripts (`.relay/` directory)

All validation and custom logic is defined in repository-specific scripts:

- **`.relay/pre-commit.mjs`** - Executed during PUT operations (file inserts)
  - Validates file changes before committing
  - Called with env: GIT_DIR, OLD_COMMIT, NEW_COMMIT, BRANCH
  - Must exit 0 on success, non-zero with error message on failure

- **`.relay/pre-receive.mjs`** - Executed during git push operations
  - More comprehensive validation for received commits
  - Similar environment variables as pre-commit
  - Used for repository-to-repository synchronization

- **`.relay/validation.mjs`** (optional) - Custom domain-specific validation
  - Contains business logic for validation
  - Sandboxed execution with restricted API
  - Called by pre-commit/pre-receive as needed

- **`.relay/lib/utils.mjs`** - Shared utility functions
  - Git operations (read tree, list changes, verify signatures)
  - Index maintenance (relay_index.json)
  - YAML/JSON parsing

- **`.relay/lib/validation.mjs`** - Validation sandbox
  - Provides sandboxed execution environment
  - Restricted API for custom validators

- **`.relay/options.mjs`** - Server discovery endpoint
  - Returns metadata about repository and branches
  - Used by clients to discover available operations

## Execution Flow

### PUT (File Create/Update)

1. HTTP PUT request arrives with file path and content
2. Server creates commit candidate with the new file
3. Server extracts `.relay/pre-commit.mjs` from the candidate commit
4. Server writes script to temp file and executes with Node.js
5. Environment variables passed: GIT_DIR, OLD_COMMIT, NEW_COMMIT, REFNAME, BRANCH
6. On success (exit 0): commit is finalized
7. On failure (exit != 0): commit is aborted, error returned to client

### Git Push (Direct Repository Access)

1. User pushes to bare repository
2. Git pre-receive hook executes `.relay/pre-receive.mjs` if present
3. Script validates commits with same environment variables
4. On failure: push is rejected with error message

## Validation API

When `.relay/pre-commit.mjs` or `.relay/pre-receive.mjs` calls custom validation:

```javascript
const api = {
  listStaged: () => [], // Array of changed files with status
  readFile: (path) => null, // Returns file content as Buffer or null
};
```

The validation function runs in a VM sandbox with limited capabilities:
- Can read files from the git tree
- Can access console for logging
- Cannot access filesystem or network directly
- Has a 2-second timeout

## Benefits

1. **No External Dependencies** - Validation runs in Node.js (already in template)
2. **Repository-Specific Logic** - Each repo can define custom rules
3. **Flexible Validation** - Not limited to declarative schemas
4. **Git Native** - Follows standard hook conventions
5. **Easier Debugging** - Script output directly in server logs
6. **Version Controlled** - Validation rules stored in git with repository

Environmental configuration follows the previous defaults (`RELAY_NODE_BIN`, `RELAY_IPFS_CACHE_ROOT`, etc.) but relies on the new scripts for all IPFS/grid logic.

---

## `.relay/get.mjs`

Purpose: resolve misses that reach the HTTP handler (files or directories that are either absent in Git or exposed via IPFS). The script expects the following environment variables:

| Name | Meaning |
| --- | --- |
| `GIT_DIR` | The bare repository path. |
| `BRANCH` | Target branch name. Defaults to `main`. |
| `REL_PATH` | The requested file/directory relative path (no leading slash). |
| `CACHE_ROOT` | Optional cache directory for directory listings; default `/srv/relay/ipfs-cache`. |

Behavior:

1. If `.relay/root.ipfs` on the branch is empty, it falls back to a Git directory listing.
2. First tries `ipfs cat` for `REL_PATH`; on success, returns `{ kind: "file", contentType, bodyBase64 }`.
3. For directories it merges `git ls-tree` (branch) with `ipfs ls` listings, deduplicates entries, annotates each item with `source: git|ipfs|both`, caches the result in `CACHE_ROOT/<cid>/<rel>.json`, and returns `{ kind: "dir", items }`.
4. On any failure it returns `{ kind: "miss" }`; the caller logs and falls back to the standard 404 page.

On the server side, `run_get_script_or_404` writes the blob to a temp file, sets the right env, runs Node via `RELAY_NODE_BIN` (default `node`), and interprets the JSON payload to construct the HTTP response.

---

## `.relay/query.mjs`

Purpose: replace the Rust query handler that previously depended on `relay_db` abstractions. It acts as a thin bridge over `relay_index.json` which is kept in sync by the pre-commit hook.

Inputs/outputs:

- Environment: `GIT_DIR`, `BRANCH`. `BRANCH` may also be set to `all` to search every branch.
- Reads JSON input from STDIN (expecting keys `page`, `pageSize`, `filter`). Falls back to defaults `page=0`, `pageSize=25`, `filter=null`.
- Loads `relay_index.json` from `GIT_DIR` (it contains metadata docs keyed by `_branch`/`_meta_dir`). Filters entries to the target branch and any `filter` criteria (supports `$text` for substring searches plus equality checks).
- Returns `{ items, total, page, pageSize, branch }` via STDOUT.

The server transcodes incoming HTTP query bodies to JSON, writes them to the child’s STDIN, waits for completion, and shuts down the temporary script file once it has produced valid JSON.

---

## `.relay/pre-commit.mjs`

Purpose: validate pushes and maintain `relay_index.json` for metadata queries.

Environment:

| Name | Meaning |
| --- | --- |
| `GIT_DIR` | Bare repo path. |
| `OLD_COMMIT`, `NEW_COMMIT` | Old/new revs from the candidate update. |
| `REFNAME`, `BRANCH` | Full refname and branch name (e.g., `refs/heads/main`). |

Responsibilities:

1. **Change detection** – runs `git diff --name-status` to enumerate files touched between the two commits.
2. **Pre-commit protection** – if `.relay/pre-commit.mjs` was touched, it requires the commit to be signed (`git verify-commit` or `SSH allowed-signers` list); otherwise, it rejects the push.
3. **Validation sandbox** – if `.relay/validation.mjs` exists, the script loads it into a Node `vm` sandbox, injects a thin API (`listStaged`, `readFile`), and expects the module to expose a `validate(api)` function that returns `{ ok: true }` or `{ ok: false, message }`. It aborts if the validation rejects and no allowed signer authored the commit.
4. **Index maintenance** – `relay_index.json` is kept at the repo root. For every changed `meta.yaml`/`meta.yml`, it parses YAML (via `js-yaml` if available, else JSON), annotates it with `_branch`, `_meta_dir`, timestamps, and upserts the document into the index.

Additional notes:

- `collectAllowedSigners` looks for SSH keys under `.relay/.ssh` or `.ssh` inside the repo and writes them to a temp file for `git verify-commit` runs.
- The script is responsible for writing the `relay_index.json` file directly under `GIT_DIR`, so `query.mjs` can read it without invoking Git.

---

## How the pieces fit

- The HTTP server keeps delegating IPFS/DB/validation work to these Node scripts, which allows teams to iterate on repo-specific policies without rebuilding the Rust service.
- `.relay/pre-commit.mjs` ensures the index used by `.relay/query.mjs` stays consistent with metadata files, and it applies any additional validations defined in `.relay/validation.mjs`.
- `.relay/get.mjs` caches directory listings per CID and merges Git and IPFS views, letting the server respond with JSON/streamed files without embedding IPFS clients in Rust.

Deployers should keep `RELAY_NODE_BIN`, `RELAY_IPFS_CACHE_ROOT`, and any additional environment variables updated via systemd/containers so the service can locate Node and persistent cache directories.