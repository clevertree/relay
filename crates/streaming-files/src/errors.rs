use thiserror::Error;

#[derive(Debug, Error)]
pub enum StreamingError {
    #[error("configuration error: {0}")]
    Config(String),
    #[error("rpc unavailable: {0}")]
    RpcUnavailable(String),
    #[error("authentication required or invalid for RPC: {0}")]
    Auth(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("unsupported: {0}")]
    Unsupported(String),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde error: {0}")]
    Serde(#[from] serde_json::Error),
}

pub type Result<T, E = StreamingError> = std::result::Result<T, E>;
