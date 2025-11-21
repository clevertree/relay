@relay/protocol — OpenAPI Spec

Provides the shared OpenAPI 3.0 spec for the Relay API and a few common constants.

Contents
- openapi.yaml — API spec
- index.ts — exports path and constants
- rules.schema.yaml — JSON Schema (YAML) for per-repo rules.yaml files

API Highlights
- Header X-Relay-Branch selects branch, default main
- CRUD on any path (except .html/.htm/.js)
- POST /status returns status, branches, sample paths, capabilities [git, torrent, ipfs, http], and includes `rules` if the repo contains a `rules.yaml` (JSON form). Clients may use `rules.indexFile` to choose a default document.
- POST /query — policy-driven query using `rules.db.queryPolicy`. Default pagination pageSize=25; `X-Relay-Branch` may be a branch or `all`.

Rules schema notes
- Generalized (domain-agnostic): `allowedPaths`, `insertTemplate`, optional `indexFile`, and `metaSchema` for validating `meta.json`.
- Database section `db` (all SQL allowed):
  - `schema: string[]` — executed in order to prepare the SQLite index.
  - `constraints: string[]` — fields from meta forming uniqueness with implied branch.
  - `insertPolicy: { branch?: "*"|string, statements: string[] }` — executed for each changed `meta.json` with named params:
    - `:branch`, `:path`, `:meta_dir`, `:meta_json`, and `:meta_<field>` per top-level meta field.
  - `queryPolicy: { statement: string, countStatement?: string, pageSizeParam?: string, pageOffsetParam?: string }` — executed by server `/query`.

Usage
import { RELAY_OPENAPI_PATH, RULES_SCHEMA_PATH, DEFAULT_BRANCH, DEFAULT_INDEX_FILE } from '@relay/protocol'
