Relay Hooks Runner

This crate implements the hooks runner (`relay-hooks`) used by the server to validate commits.

- The hooks runner validates `rules.yaml` (must exist and satisfy the schema in `packages/protocol/rules.schema.yaml`).
- If `rules.yaml` is missing or invalid on the repository's default branch, hook validation fails and pushes from the HTTP server are rejected.

Testing policy

- Unit tests that require a populated repo will clone from the canonical template repository:
  https://github.com/clevertree/relay-template/
  This template repo always contains `rules.yaml` in the root so tests that rely on rules should not see it missing unless explicitly testing the missing-file behavior.

- Tests that exercise the 'missing rules.yaml' behavior create a fresh repository (without the template) and assert the hook rejects.

Makefile / CI notes

- CI should allow network access to the template repo when running these integration tests, or you can vendor a local copy of the template and point tests to it by setting the `TEMPLATE_REPO` constant in `src/main.rs` during CI.
