# Repository Initialization (relay-cli)

This document explains how to create a new repository for Relay using the `relay-cli` command-line tool (which uses the shared `relay-core` library and the system `git` installation).

Why use the CLI
----------------
- The CLI calls into the shared `relay-core` library which performs repository templating, initial commits, and hooks installation. It relies on the system `git` binary for on-disk repository operations and for working-tree materialization.
- Using the CLI is the canonical, supported way to create reproducible repositories that include the required `.relay/*` files and default content.

Quick example
-------------

From the project root you can create the sample `movies` repository used in the examples in `README.md`:

```bash
cargo run -p relay-cli -- init --repo movies --template movies --path ./host/repos
```

What this does
---------------
- Copies the chosen template (`template/movies`) into `./host/repos/movies`.
- Initializes a git repository in `./host/repos/movies` using the system `git` binary.
- Makes the initial commit(s) containing the template content and writes any required `.relay/*` files (schema, interface, etc.).
- (Optional) Installs repository hooks when requested, for server-side validation on future pushes.

Notes and requirements
----------------------
- System Git: The operation requires `git` available on the PATH (the system git client). Ensure `git --version` works before running the CLI.
- File permissions: Creating repositories writes to the `--path` you specify. Ensure the process has write permission to that path.
- Templates: Templates live in the monorepo under `template/` (for example `template/movies`). You may add more templates following the same structure.
- Non-bare repos: Host-mode repositories are created as checked-out working trees (non-bare) so the HTTP static server can serve files directly from the working tree.

Host mode & git-daemon
----------------------
After creating repositories under `./host/repos`, you can start host mode which serves these repositories over HTTP and git protocol:

```bash
# start HTTP static host + git protocol server (default ports shown in README)
cargo run -p relay-cli -- host start --port 8080 --root ./host

# Alternatively run git daemon directly to expose git:// on port 9418
relay git-daemon start --base-path ./host/repos --port 9418
```

Web-only UI behavior
--------------------
- The Next.js web UI is designed to be a static/web-only client and cannot access the local filesystem or run the CLI.
- Because repository creation requires filesystem access and a system `git` executable, the web-only client cannot perform repo-init operations itself. Therefore, when the UI is running in web-only mode (served from a remote master or static host), the "Add repository" control should be disabled or hidden.
- For desktop (Tauri) mode we can implement a native command that calls the same `relay-core` initialization logic (or spawns the `relay-cli`) since the desktop build has local filesystem access.

Suggested API and desktop wiring (implementers)
-----------------------------------------------
- Server API (host mode): If you want remote web clients to be able to request a repo be created on the host server, implement a secure server-side endpoint such as `POST /api/repos/init` or `POST /repos/init` on the host which:
  - Validates and sanitizes the repository name and template choice.
  - Runs the same initialization logic (call into `relay-core` or spawn `relay-cli` with the same args) under the host's process permissions.
  - Returns a success/failure JSON response and appropriate HTTP status codes.
  - IMPORTANT: Protect this endpoint with authentication and rate-limiting — allowing anonymous repo creation may be a security risk on public hosts.

- Desktop (Tauri) path: For the desktop app, add a Tauri command (e.g. `init_repo`) that invokes the same initialization logic (via `relay-core` bindings or by spawning the CLI) so the UI's "Add repository" button can call `window.__TAURI__.invoke('init_repo', { name, template })`.

Example server-side interaction (pseudocode):

```text
POST /repos/init
Body: { name: "movies", template: "movies" }

Server behavior:
- verify name (alpha-numeric, no ../, length limits)
- call relay-core init function or run `relay-cli -- init --repo <name> --template <template> --path ./host/repos`
- on success: return 201 { repo: "/repos/movies" }
- on failure: return 400/500 with an error message
```

Updating the UI
---------------
- The web UI should only enable the Add button when running in desktop mode or when the master endpoint explicitly advertises an init API.
- The UI should rely on the configured `masterEndpoint` (see `apps/web/src/store/config.ts`) when attempting to refresh the repo list after creation.

Further reading
----------------
- See the `README.md` quick start for the canonical `relay-cli` example used above.
- See `template/` for repository template structure and `crates/relay-core` for shared init logic (when available).

If you'd like, I can:
- Add the UI modal + disabled state for web-only mode in `apps/web` (fast, UI-only change), or
- Implement a starter server endpoint and wire a safe handler in `relay-cli` (requires server-side changes and tests), or
- Add a Tauri command and wire the desktop UI to call it (desktop-only path).

Choose which of these you want me to implement next and I will add it to the TODO list and start the work.
