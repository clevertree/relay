### Relay Client Declarative Plugin Spec (v1)

#### Overview
Declarative plugins let a repository define a native UI without shipping executable code. The client fetches a manifest from the repo and renders views natively. If the manifest is missing or invalid, the client falls back to the built‑in plugins (Native Repo Browser or Webview).

Manifest is typically served at the path advertised by `relay.yaml` under `interface.<os>.path`. That path may be a directory containing a `plugin.manifest.json` file and additional assets.

#### Selection priority
1. Repo‑provided plugin (if `interface.<os>.enabled==true` and loaded successfully)
2. Built‑in Default (native)
3. Built‑in Webview

Users can switch between available plugins at runtime per repo/tab.

#### Example manifest (JSON)
```json
{
  "name": "Movies Native UI",
  "version": "1.0.0",
  "type": "native-declarative",
  "requires": { "api": ">=1.0", "features": ["query", "markdown", "assets"] },
  "initialView": "home",
  "views": [
    { "id": "home", "kind": "markdown", "source": "index.md" },
    {
      "id": "search",
      "kind": "grid",
      "query": {
        "filter": {},
        "columns": ["title", "release_year", "genre"],
        "pageSize": 25
      },
      "rowActions": [
        {
          "label": "View",
          "navigateTo": { "kind": "markdown", "pathFrom": "meta_dir", "append": "index.md" }
        }
      ]
    }
  ],
  "components": {
    "video": { "tag": "video", "props": ["url", "poster"] }
  }
}
```

#### Fields
- `name`, `version`: Human‑readable metadata.
- `type`: Must be `native-declarative` for this spec.
- `requires`: Optional compatibility declaration.
- `initialView`: View `id` to show first.
- `views`: Array of views:
  - `kind`: One of `markdown`, `grid`, `detail-json`, `action`.
  - `markdown` view:
    - `source`: Repo path to a markdown file. If a directory is given, `.../index.md` is implied.
  - `grid` view:
    - `query`: Body for server `QUERY` method. `columns` selects which fields to display. Paging/sort optional.
    - `rowActions`: Buttons per row; `navigateTo` supports `kind: "markdown"`, `pathFrom` (field name), and `append` to form a path.
  - `detail-json` view:
    - `sourceFrom`: Field name in the current item to render as JSON detail.
  - `action` view:
    - `script`: Optional inline script to run in the sandbox, or a `query`/`get` to execute and navigate.
- `components`: Optional custom tag bindings. Each entry declares a `tag` name (e.g., `video`) and allowed `props`. Markdown renderer will translate `<video url="..."/>` into a native component using this registry.

#### Security model
- No filesystem or process access.
- Network limited to the selected peer via the client’s bridge.
- Webview bundles (if used) run with a restricted API: `relay.fetch`, `relay.state()`, and `relay.postMessage()` only.

#### Server expectations
- `OPTIONS /` returns a JSON payload that includes `relay.yaml` (or a structured equivalent). The client reads `interface.<os>.enabled`, `interface.<os>.path`, and optional `interface.<os>.hash` for integrity checks.
- The `interface.<os>.path` may point to a directory; the client will request `plugin.manifest.json` within it.

#### Integrity & caching
- If `interface.<os>.hash` is provided in `relay.yaml`, the client verifies the manifest file content hash.
- Assets are cached per peer with ETag/Last‑Modified or content hash; caches have size/TTL limits.

#### Fallbacks
- If loading the manifest fails or the spec is unsupported, the client falls back to the Built‑in Default plugin, with an option to switch to Webview.
