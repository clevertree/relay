pub mod errors;
pub mod model;
pub mod env;
pub mod config;
pub mod rpc;
pub mod service;
pub mod playback;

#[cfg(feature = "client")]
pub mod ui;

// Re-exports for convenience
pub use crate::errors::StreamingError;
pub use crate::model::{TorrentFile, TorrentStatus, PlayDecision, AddResult};
pub use crate::service::StreamingService;