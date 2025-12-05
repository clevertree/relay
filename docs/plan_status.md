### Relay UI Refactor & Runtime Loader — Status Report (2025-12-05 11:12)

#### Executive Summary
- Web: Runtime TS/TSX transpiler stabilized; improved diagnostics and strict OPTIONS usage. Residual blank page persists in your environment; root cause likely JSX runtime mismatch. Loader now forces classic runtime and clears error state after a successful render.
- React Native (RN): Repo‑owned UI path in place — app renders the repository `get` hook under the Repo tab; legacy Visit/Search paths are bypassed. Shared runtime loader scaffold implemented; NativeWind/Tailwind dependencies and Babel plugin added.
- Tailwind/Theming: Design for slim class policy and runtime token overrides drafted; implementation pending.
- Docs: Pending updates to reflect RN refactor, unified loader, Tailwind policy, and theming.

---

### Completed This Session
- Web client
  - Normalized `@babel/standalone` import and preset resolution (prevents `undefined typescript preset` errors).
  - Forced classic JSX runtime in transform to avoid injected `react/jsx-runtime` imports and blank renders.
  - Better error lifecycle: error state cleared when hooks render successfully; more actionable console diagnostics across fetch/transform/import/exec phases.
- React Native client
  - Added a unified runtime loader (fetch TS/TSX → transform to CJS → safe eval) with contextual helpers: `navigate`, `loadModule`, `buildPeerUrl`.
  - Wired Repo tab to render repo `get` hook content; disabled old Visit/Search UI at runtime (no fallbacks).
  - Installed and configured NativeWind (Babel plugin) + Tailwind deps for RN styling.

### In Progress
- RN: Full removal of legacy code paths and polish of loading/error states (dumb host only).

### Open Issues / Risks
- Web: Intermittent blank render on your machine with warning “JSX factory cannot be set when using React automatic transform.”
  - Likely cause: a transform choosing automatic runtime while loader also sets pragma; or a third-party dev transform warning. Loader now forces classic; still need to confirm on your machine.
- Styling parity: Tailwind/NativeWind configuration and class policy not yet enforced; repo components still use raw palette classes that should be migrated to tokenized names.

---

### Next Steps (Actionable)
1. React Native: finalize dumb-host refactor
   - Delete/disable legacy Visit/Search/FlatList code paths, types, and styles.
   - Ensure the Repo tab always renders the repo hook element; unify loading/error empty states.
   - Add module cache and sourceURL markers for better stack traces in RN.
2. NativeWind/Tailwind setup (RN)
   - Add `tailwind.config.js` for RN app; ensure `content` points to repo hook output scope (shared policy below).
   - Verify Metro config doesn’t strip className; ensure `nativewind` transforms apply.
3. Tailwind class policy (both clients)
   - Implement slim safelist of common utilities only (layout, spacing 0..6/8/12, grid 1..6, typography xs..2xl, border/radius, sm/md/lg breakpoints).
   - Enforce via `safelist`/`blocklist` or a compile‑time extractor to keep output small; measure CSS size delta and set a threshold (e.g., +≤30 KB).
4. Tokenize colors and breakpoints
   - Replace hardcoded classes like `bg-gray-600` with tokenized classes (`bg-surface`, `btn-primary`, `text-muted`, etc.).
   - Web: map tokens to CSS variables; inject overrides from `.relay.yaml` or `/hooks/theme.json` at runtime.
   - RN: extend NativeWind theme with the same tokens on startup; read overrides from OPTIONS or `/hooks/theme.json`.
   - Provide sensible defaults; allow per-repo overrides.
5. Unified loader extraction
   - Extract the transform/dynamic‑load core into a small shared module used by both web and RN (adapters for import vs eval).
   - Normalize diagnostics shape and error surfaces across both clients.
6. Documentation
   - Update docs to reflect:
     - OPTIONS contract (A shape for `repos`).
     - Hook discovery strictly via OPTIONS; no fallbacks.
     - Authoring hooks in TSX; runtime transpilation rules and `/* @jsx h */` pragma behavior.
     - RN parity, NativeWind setup, slim Tailwind policy, and token/theming overrides.
     - How repos should reference tokenized classes instead of raw palette names.
7. Web blank‑page follow‑up (time‑boxed)
   - Add a temporary, verbose console banner with the detected transform mode (classic vs automatic) and the first 200 chars of transformed code header to confirm runtime.
   - Confirm hook fetch 200 + import success; capture first red error and diagnostics blob.

### Milestones & ETA (rough)
- RN dumb host complete, legacy paths removed: 0.5–1 day
- NativeWind/Tailwind config (RN) + validation: 0.5 day
- Slim Tailwind policy + tokens + migration of repo components: 1–1.5 days
- Unified loader extraction + diagnostics parity: 0.5 day
- Docs update: 0.5 day

### Dependencies
- None blocking. Web follow‑up requires a repro (console error + network details).

### Decision Log
- OPTIONS `repos` shape: using Option A: `{ "repos": [{ "name": "template", "branches": { "main": "<sha>", "dev": "<sha>" } }] }`.
- No backwards compatibility/fallbacks in clients; repo hook UI owns all navigation/search.
- Server hooks remain `.mjs`; client hooks/components migrated to TS/TSX.

### Requested Input
- Confirm acceptance of the Tailwind slim class list and the token names you’d like (e.g., `bg-surface`, `text-primary`, `btn-primary`, `chip-info`, etc.). If you have a preferred token set, please share; otherwise I will propose a minimal token palette aligned with your current UI.
