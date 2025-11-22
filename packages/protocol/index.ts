// Export path to the OpenAPI document and common constants used across apps.
export const RELAY_OPENAPI_PATH = new URL('./openapi.yaml', import.meta.url).toString();

// Path to the repository rules schema (YAML) used to validate per-repo relay.yaml
export const RULES_SCHEMA_PATH = new URL('./rules.schema.yaml', import.meta.url).toString();

export const DISALLOWED_EXTENSIONS = ['.html', '.htm', '.js'];
export const DEFAULT_BRANCH = 'main';
export const DEFAULT_INDEX_FILE = 'index.md';
export const CAPABILITIES = ['git', 'torrent', 'ipfs', 'http'] as const;
