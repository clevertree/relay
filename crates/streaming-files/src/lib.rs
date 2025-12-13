pub mod config;
pub mod env;
pub mod errors;
pub mod model;
pub mod playback;
pub mod rpc;
pub mod service;

#[cfg(feature = "client")]
pub mod ui;

// Re-exports for convenience
pub use crate::errors::StreamingError;
pub use crate::model::{AddResult, PlayDecision, TorrentFile, TorrentStatus};
pub use crate::service::StreamingService;
