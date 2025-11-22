# Relay Project Roadmap

This roadmap maps the project's vision to concrete phases, shows what's implemented today, and lists the next milestones and recommended tasks. Place this file under `/docs/` so it’s visible to contributors.

## Summary
- Current state: Core architecture implemented (Rust server, Tauri client, Next tracker, OpenAPI protocol, rules schema, hooks crate). Many advanced features from the vision remain to be implemented.
- Goal: Deliver a secure, decentralized, branch-oriented web platform that supports safe community edits, voting workflows, and cryptographic governance while remaining high-performance.

---

## Phase A — Core Platform (Foundation)
Goal: Provide a stable, high-performance Git-backed server and client with rules-based validation and indexing.

Milestones
- [x] Rust Relay server exposing CRUD + `/status` + `/query` (via `X-Relay-Branch`).
  - Evidence: `apps/server` README and OpenAPI in `packages/protocol`.
- [x] Tauri + React desktop client with RepositoryBrowser and Markdown rendering.
  - Evidence: `apps/client` README; branch dropdown, path input, markdown rendering.
- [x] Tracker (Next.js) listing master peers.
  - Evidence: `apps/tracker` README and APIs.
- [x] Shared OpenAPI spec and `rules.schema.yaml`.
  - Evidence: `packages/protocol` contains `openapi.yaml` and `rules.schema.yaml`.
- [x] Git hooks crate scaffolding to validate `relay.yaml` on new commits.
  - Evidence: `crates/hooks` exists and is referenced in README.
- [x] Basic security guardrails (block .html/.htm/.js).
  - Evidence: Protocol and README note disallowed extensions.

Acceptance criteria
- Server and client run locally using README steps.
- Query endpoint functions with a `rules.db.queryPolicy` in a test repository.

Risks & Notes
- Index DB behavior relies on hooks; ensure hooks are installed in CI or Git server.

---

## Phase B — Declarative Content and UX
Goal: Make it easy for repository owners to define content models and for users to discover and edit content.

Milestones
- [x] `rules.db` declarative schema and query policy design.
  - Evidence: `rules.schema.yaml` and `packages/protocol` docs.
- [ ] Provide example content repository ("movies") showcasing `relay.yaml`, `meta.json`, indexing with SQLite, and sample queries.
  - Why: Demonstrates end-to-end rules-driven indexing and `/query` usage.
  - Recommended work: add `examples/movies/` with `relay.yaml`, sample `data/` files, and a test script to run a query.
- [ ] Improve client UX for creating branches and editing meta (inline forms for `meta.json`).
  - Why: current client reads `.md` and allows edits, but doesn't expose structured meta editing.

Acceptance criteria
- Working example repo in `examples/` with documented steps to run the server, commit sample data, and execute `/query`.

---

## Phase C — Governance & Collaboration (PRs, Voting)
Goal: Add governance primitives: pull/merge requests, voting branches, approvals, and review workflows.

Milestones
- [ ] Pull request primitives: create/list/approve/merge PRs (API + client UI).
  - Why: Needed for collaborative workflows and governance.
- [ ] Voting workflow: automated branch creation for votes, special allowed-file rules for voting branches, UI to create/participate in votes.
  - Why: Many vision use-cases rely on ephemeral voting branches.

Acceptance criteria
- Ability to open a PR on a branch, leave comments, approve and merge with server-side merge logic and conflict resolution.
- Ability to create voting branches with restricted rules and allow users to submit votes/results without affecting `main`.

---

## Phase D — Decentralization & Replication
Goal: Implement master peer replication and resilient decentralized hosting.

Milestones
- [ ] Peer-to-peer repository sync: use Git transports, BitTorrent/IPFS hints, and tracker coordination to replicate repositories between master peers.
  - Recommendation: Begin with a two-node proof-of-concept using bare Git push/pull, then extend with IPFS/BitTorrent for blobs.
- [ ] Automatic discovery and reconcilation: integrate tracker to coordinate and heal inconsistent branches across peers.

Acceptance criteria
- Two or more master peers can synchronize commits and branches automatically; conflict resolution strategy documented and tested.

Risks & Notes
- This is the most complex phase. Design first: detail the transport, conflict policy, and security model before implementing.

---

## Phase E — Cryptographic Governance & Signing
Goal: Make `main` modifications only possible by a configured repository key and provide cryptographic proof of repository authorship.

Milestones
- [ ] Commit signature verification in `crates/hooks` and server-side enforcement for protected branches.
- [ ] `relay.yaml` fields to declare required signer(s) for branches.
- [ ] Key provisioning and rotation documentation.

Acceptance criteria
- Unauthenticated pushes to `main` are rejected unless commits are signed by the configured private key(s); server verifies and refuses to apply unsigned commits.

---

## Phase F — Plugin Ecosystem & Safe Components
Goal: Support safe, composable interactivity in user-hosted content via a plugin system and Markdown components.

Milestones
- [ ] Define Markdown components spec and safe runtime sandbox.
- [ ] Implement a plugin API (client-side and optional server-side helper) and provide an example TMDB plugin that can insert movie entries to a branch.

Acceptance criteria
- Plugin can fetch external data and propose an upsert to a branch via client UI; safe component rendering allowed under rules enforcement.

---

## Cross-cutting Tasks
These items should be addressed across phases.

- Documentation: step-by-step examples for dev and production (`/docs/` and `examples/`).
- Tests: unit/integration tests for hooks, server endpoints, and query engine.
- CI: ensure hooks run and server build/test in CI.
- Security review: threat model and design review for plugin runtime and peer synchronization.

---

## Current status at a glance
- Foundation (Phase A): Mostly done (server, client, tracker, protocol, hooks scaffolding). ✅
- Declarative content (Phase B): Partial — design present; need example repos and client UX improvements. ⚠️
- Governance & Voting (Phase C): Missing — design only in vision. ❌
- Decentralization & Replication (Phase D): Partial — tracker and P2P tooling referenced, replication not implemented. ⚠️
- Cryptographic Governance (Phase E): Missing — hooks present but no signing enforcement. ❌
- Plugin Ecosystem & Safe Components (Phase F): Missing — conceptual only. ❌

---

## Suggested immediate next sprint (4 weeks)
1. Add `examples/movies/` demonstrating `relay.yaml`, `meta.json`, sample data, and a script to run a `/query` against a local server (est. 1 week).
2. Implement commit-signature check in `crates/hooks` for a protected-branch demo (est. 1 week).
3. Add PR API skeleton and a minimal client UI to open/close PRs (est. 1.5 weeks).
4. Write design doc for peer replication and create a two-node proof-of-concept plan (est. 1 week parallel work).

---

## Where to find things in the repo
- Server: `apps/server/`
- Client: `apps/client/`
- Tracker: `apps/tracker/`
- OpenAPI + Rules Schema: `packages/protocol/`
- Hooks crate: `crates/hooks/`

---

## Next steps I can take for you
- Create the `examples/movies/` repo and add a test harness for `/query`.
- Implement commit signature verification in `crates/hooks` as a minimal PoC.

Which of these would you like me to start with? Or do you want any edits to the roadmap before I mark the roadmap task completed in the todo list?