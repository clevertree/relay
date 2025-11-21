// Export path to the OpenAPI document and common constants used across apps.
export const RELAY_OPENAPI_PATH = new URL('./openapi.yaml', import.meta.url).toString();

export const DISALLOWED_EXTENSIONS = ['.html', '.htm', '.js'];
export const DEFAULT_BRANCH = 'main';
export const CAPABILITIES = ['git', 'torrent', 'ipfs', 'http'] as const;
