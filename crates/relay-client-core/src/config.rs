use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppConfig {
    /// Semicolon-separated list of peer hosts.
    pub master_peers: Vec<String>,
}

impl AppConfig {
    pub fn from_env() -> Result<Self> {
        let peers = std::env::var("RELAY_MASTER_PEER_LIST").unwrap_or_default();
        let master_peers = peers
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect::<Vec<_>>();
        Ok(Self { master_peers })
    }
}
