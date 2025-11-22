relay-lib — Shared library and bundled assets

This crate provides:
- Client helpers for talking to a Relay server (HTTP).
- Common types and constants.
- Bundled, self-contained assets available to all binaries/crates:
  - assets/openapi.yaml — OpenAPI 3.0 spec
  - assets/rules.schema.yaml — JSON Schema (YAML) for repo `relay.yaml`
  - assets/template.html — Default HTML template supporting {title}, {head}, {body}
  - assets/404.md — Default 404 page

Rust API
- `relay_lib::assets::OPENAPI_YAML` — `&'static str`
- `relay_lib::assets::RULES_SCHEMA_YAML` — `&'static str`
- `relay_lib::assets::TEMPLATE_HTML` — `&'static str`
- `relay_lib::assets::DEFAULT_404_MD` — `&'static str`
- `relay_lib::assets::get_asset(name)` — optional helper

Notes and strategy
- Binaries must not read repo-relative assets directly from the source tree at runtime. Instead, use these bundled assets so crates remain self-contained.
- HTML and JavaScript are forbidden from insertion via the Relay API, but if such files already exist in the repository at commit time, the server may render or serve them. The rules forbid modifying files outside of what `relay.yaml` allows; therefore JavaScript cannot be modified through the API after the initial repo release.
- We will later add public-key signatures to enable secure, admin-authorized modifications to a small set of files.
