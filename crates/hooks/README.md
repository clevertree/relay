Relay Hooks Runner

This crate implements the hooks runner (`relay-hooks`) used by the server to validate commits.

- The hooks runner validates `relay.yaml` (must exist and satisfy the schema).
- If `relay.yaml` is missing or invalid on the repository's default branch, hook validation fails and pushes from the HTTP server are rejected.

Local index (PoloDB)

- When a push is accepted, the hooks runner also maintains a local PoloDB index derived entirely from `relay.yaml`:
  - `rules.db.engine: polodb` selects the embedded DB engine.
  - `rules.db.collection`, `rules.db.unique`, `rules.db.indexes`, and `rules.db.mapping` define how meta.json documents are transformed into stored documents (MetaDoc).
  - System fields are injected automatically: `_branch`, `_meta_dir`, `_created_at`, `_updated_at`.
  - The DB file path can be overridden with `RELAY_DB_PATH`; by default it is `<gitdir>/relay_index.polodb`.
- The HTTP server’s generic `/query` endpoint uses the same mapping to answer queries from the local index. A custom HTTP method alias `QUERY` is supported and rewritten internally to `POST /query/*`.

Testing policy

- Unit tests that require a populated repo will clone from the canonical template repository:
  https://github.com/clevertree/relay-template/
  This template repo always contains `relay.yaml` in the root so tests that rely on rules should not see it missing unless explicitly testing the missing-file behavior.

- Tests that exercise the 'missing relay.yaml' behavior create a fresh repository (without the template) and assert the hook rejects.

Makefile / CI notes

- CI should allow network access to the template repo when running these integration tests, or you can vendor a local copy of the template and point tests to it by setting the `TEMPLATE_REPO` constant in `src/main.rs` during CI.
