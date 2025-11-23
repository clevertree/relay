Running Storybook accessibility checks

Prerequisites:
- Have Storybook running locally: `pnpm storybook` (defaults to http://localhost:6006)
- Node 18+ and `pnpm` installed
- Playwright installed (for browsers). Install via:

```bash
pnpm add -D playwright
# or globally: npm i -g playwright
```

Run the accessibility runner (it opens each story and listens for axe results):

```bash
pnpm storybook # in one terminal
pnpm test:a11y # in another terminal
```

Notes:
- The runner expects Storybook manager to expose story links via `a[role="treeitem"]` which works for the default manager layout.
- The preview injects `axe-core` from unpkg; for air-gapped setups add `axe-core` as a dependency and modify `preview.js` to import it locally.
