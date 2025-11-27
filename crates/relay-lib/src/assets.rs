//! Embedded static assets bundled with relay-lib.
//! These are available to binaries and other crates without accessing repo files.

// NOTE: The OpenAPI spec is now provided by the Next.js tracker app only.
// The crate no longer bundles a copy to avoid duplication.

/// Bundled rules JSON schema (YAML)
pub const RULES_SCHEMA_YAML: &str = include_str!("../assets/relay.schema.yaml");

/// Bundled default HTML template
pub const TEMPLATE_HTML: &str = include_str!("../assets/template.html");

/// Bundled default 404 markdown page
pub const DEFAULT_404_MD: &str = include_str!("../assets/404.md");

/// Get a bundled asset by canonical name.
/// Names: "openapi.yaml", "relay.schema.yaml", "template.html", "404.md"
pub fn get_asset(name: &str) -> Option<&'static str> {
    match name {
        "relay.schema.yaml" => Some(RULES_SCHEMA_YAML),
        "template.html" => Some(TEMPLATE_HTML),
        "404.md" => Some(DEFAULT_404_MD),
        _ => None,
    }
}
