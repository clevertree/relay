pub mod config;
pub mod schema;

pub use config::{load_config, save_config, Config, ConfigPaths};
pub use schema::{
    find_schema_path,
    load_schema_from_repo,
    quick_validate_repo,
    validate_repo,
    RepoSchema,
    ValidationReport,
    ValidationError,
    // Expose allowlist helpers for Host HTTP API
    allowed_extensions,
    is_allowed_file,
    guess_mime_from_ext,
};
