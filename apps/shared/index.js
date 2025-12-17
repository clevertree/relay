// Shim to prefer workspace source during local development.
// Metro may attempt to resolve @relay/shared from node_modules; this file
// delegates to the workspace `apps/shared/src` so the bundler uses the
// uncompiled TypeScript sources (Metro is configured to handle them).
// Delegate to the workspace package source; allow failures to surface so Metro
// and the developer see a clear error instead of silently using empty stubs.
// Use an absolute path to the workspace shared source to avoid incorrect
// relative resolution from node_modules when Metro bundles files.
module.exports = require('/home/ari/dev/relay/apps/shared/src/index');

