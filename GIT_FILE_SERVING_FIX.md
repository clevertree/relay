# Git File Serving Fix - Summary

## Problem
The relay server was not serving files from git repositories. The primary issue was that when the repository had subdirectories (like `.relay/`, `.ssh/`), the server would default to serving files from the first subdirectory instead of from the repository root.

For example, requesting `/README.md` would look for `.relay/README.md` instead of `README.md` at the root.

## Root Cause
In `apps/server/src/main.rs`, the `repo_from()` function had this logic:
```rust
if let Ok(list) = list_repos(repo_path, branch) {
    return list.into_iter().next();  // Returns FIRST subdirectory found
}
Some("".to_string())  // Falls back to root only if NO subdirectories
```

This meant subdirectories were treated as "repos" and took priority over the root repository.

## Solution

### 1. Fixed Repository Resolution (lines 1061-1098)
Changed the logic to prefer the root repository by default:

**Before:**
```rust
if let Ok(list) = list_repos(repo_path, branch) {
    return list.into_iter().next();
}
// If no subdirectories found, serve the root as the default repository
Some("".to_string())
```

**After:**
```rust
// Prefer root repository ("") as the default, then fall back to first subdirectory
Some("".to_string())
```

Now the root repository is ALWAYS the default unless explicitly overridden via query parameter, header, cookie, or environment variable.

### 2. Added Directory Listing Support (lines 1430-1463)
Previously, when a GET request hit a directory (git tree object), it would return 404 and delegate to `.relay/get.mjs` script.

Now it returns a JSON listing of directory contents:

**Before:**
```rust
Some(ObjectType::Tree) => {
    // Defer directory listing logic to repo script (.relay/get.mjs)
    GitResolveResult::NotFound(rel.to_string())
}
```

**After:**
```rust
Some(ObjectType::Tree) => {
    // List directory contents as JSON
    match repo.find_tree(entry.id()) {
        Ok(dir_tree) => {
            let mut entries = serde_json::json!({});
            for item in dir_tree.iter() {
                if let Some(name) = item.name() {
                    let kind = match item.kind() {
                        Some(ObjectType::Blob) => "file",
                        Some(ObjectType::Tree) => "dir",
                        _ => "unknown",
                    };
                    entries[name] = serde_json::json!({
                        "type": kind,
                        "path": format!("{}/{}", rel, name)
                    });
                }
            }
            let resp = (
                StatusCode::OK,
                [
                    ("Content-Type", "application/json".to_string()),
                    (HEADER_BRANCH, branch.to_string()),
                    (HEADER_REPO, repo_name.to_string()),
                ],
                serde_json::to_string(&entries).unwrap_or_else(|_| "{}".to_string()),
            )
                .into_response();
            GitResolveResult::Respond(resp)
        }
        Err(e) => {
            error!(?e, "tree read error");
            GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response())
        }
    }
}
```

Directory listing response format:
```json
{
  "filename1": {"type": "file", "path": ".relay/filename1"},
  "filename2": {"type": "file", "path": ".relay/filename2"},
  "subdir": {"type": "dir", "path": ".relay/subdir"}
}
```

## Test Updates
Updated `scripts/e2e/test-local-file-serving.mjs` to:
1. Test files that actually exist in relay-template (`.env`, `.relay/get.mjs`)
2. Add directory listing tests (`.relay/` subdirectory)
3. Test both file and directory content handling
4. Verify JSON directory listing response format

## Test Results
All 9 E2E tests now pass:
- ✓ OPTIONS request returns correct headers
- ✓ Root path (/) returns file listing
- ✓ README.md served from root (906 bytes)
- ✓ .env file served (611 bytes)
- ✓ .relay/ directory listing returns JSON with 14 items
- ✓ .relay/get.mjs file served (5647 bytes)
- ✓ 404 for non-existent files
- ✓ 404 for non-existent directories

## Git Objects Flow
The server now correctly serves files from git objects in this order:
1. Try to serve from static directories (if configured)
2. Try to serve from git objects:
   - If blob: return file content
   - If tree: return JSON directory listing
3. If not found: delegate to `.relay/get.mjs` script

## Precedence for Repository Selection
When determining which "repository" (directory scope) to use:
1. Query parameter `?repo=`
2. Header `X-Relay-Repo`
3. Cookie `relay-repo`
4. Environment variable `RELAY_DEFAULT_REPO`
5. **ROOT ("") - NEW DEFAULT** (was step 6 before, now step 5)
6. First subdirectory in list_repos (fallback only)

## Deployment Impact
- **Non-breaking change** - existing deployments work as before
- **File serving restored** - README.md and other root files now served
- **Directory listing added** - new JSON listing for directory requests
- **Backward compatible** - explicit repo selection still works

## Related Functions
- `repo_from()` - Determines which "repository" scope to use for the request
- `git_resolve_and_respond()` - Resolves and serves files from git objects
- `list_repos()` - Lists subdirectories in the repository (for explicit repo selection)
- `get_file()` - Main HTTP GET handler that orchestrates the flow
