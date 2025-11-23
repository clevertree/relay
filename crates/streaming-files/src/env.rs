use std::env;

#[derive(Debug, Clone)]
pub struct QbtConfig {
    pub host: String,
    pub port: u16,
    pub base: String,
    pub user: Option<String>,
    pub pass: Option<String>,
    pub bypass_localhost: bool,
}

#[derive(Debug, Clone)]
pub struct TrConfig {
    pub host: String,
    pub port: u16,
    pub path: String,
    pub user: Option<String>,
    pub pass: Option<String>,
}

#[derive(Debug, Clone)]
pub struct StreamConfigEnv {
    pub download_dir: Option<String>,
    pub qbt: QbtConfig,
    pub tr: TrConfig,
}

fn env_bool(key: &str, default: bool) -> bool {
    match env::var(key) {
        Ok(v) => matches!(v.as_str(), "1" | "true" | "TRUE" | "yes" | "on"),
        Err(_) => default,
    }
}

fn env_u16(key: &str, default: u16) -> u16 {
    env::var(key).ok().and_then(|s| s.parse().ok()).unwrap_or(default)
}

pub fn load_env() -> StreamConfigEnv {
    let qbt = QbtConfig {
        host: env::var("RELAY_QBT_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        port: env_u16("RELAY_QBT_PORT", 8080),
        base: env::var("RELAY_QBT_BASE").unwrap_or_else(|_| "/".to_string()),
        user: env::var("RELAY_QBT_USER").ok(),
        pass: env::var("RELAY_QBT_PASS").ok(),
        bypass_localhost: env_bool("RELAY_QBT_BYPASS_LOCALHOST", true),
    };
    let tr = TrConfig {
        host: env::var("RELAY_TR_HOST").unwrap_or_else(|_| "127.0.0.1".to_string()),
        port: env_u16("RELAY_TR_PORT", 9091),
        path: env::var("RELAY_TR_PATH").unwrap_or_else(|_| "/transmission/rpc".to_string()),
        user: env::var("RELAY_TR_USER").ok(),
        pass: env::var("RELAY_TR_PASS").ok(),
    };
    StreamConfigEnv {
        download_dir: env::var("RELAY_STREAM_DOWNLOAD_DIR").ok(),
        qbt,
        tr,
    }
}
