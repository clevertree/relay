use anyhow::{Context, Result};
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub master_endpoint: String,
    pub data_path: String,
    pub http: HttpConfig,
    pub git: GitConfig,
    pub features: FeaturesConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HttpConfig {
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConfig {
    pub port: u16,
    #[serde(default = "default_git_shallow_default")]
    pub shallow_default: bool,
}

fn default_git_shallow_default() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FeaturesConfig {
    pub web_only: bool,
}

impl Default for Config {
    fn default() -> Self {
        let default_data_path = default_data_path_string();
        Self {
            master_endpoint: "https://node1.relaynet.online".to_string(),
            data_path: default_data_path,
            http: HttpConfig { port: 8080 },
            git: GitConfig {
                port: 9418,
                shallow_default: true,
            },
            features: FeaturesConfig { web_only: false },
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConfigPaths {
    pub config_path: PathBuf,
}

fn default_config_path() -> PathBuf {
    if let Some(base) = BaseDirs::new() {
        let home = base.home_dir();
        return home.join(".relay").join("config.toml");
    }
    PathBuf::from(".relay/config.toml")
}

fn default_data_path_string() -> String {
    if let Some(base) = BaseDirs::new() {
        let home = base.home_dir();
        return home
            .join(".relay")
            .join("host")
            .to_string_lossy()
            .into_owned();
    }
    ".relay/host".to_string()
}

impl Default for ConfigPaths {
    fn default() -> Self {
        Self {
            config_path: default_config_path(),
        }
    }
}

fn apply_env_overrides(cfg: &mut Config) {
    if let Ok(v) = env::var("RELAY_MASTER_ENDPOINT") {
        if !v.is_empty() {
            cfg.master_endpoint = v;
        }
    }
    if let Ok(v) = env::var("RELAY_DATA_PATH") {
        if !v.is_empty() {
            cfg.data_path = v;
        }
    }
    if let Ok(v) = env::var("RELAY_HTTP_PORT") {
        if let Ok(p) = v.parse::<u16>() {
            cfg.http.port = p;
        }
    }
    if let Ok(v) = env::var("RELAY_GIT_PORT") {
        if let Ok(p) = v.parse::<u16>() {
            cfg.git.port = p;
        }
    }
    if let Ok(v) = env::var("RELAY_GIT_SHALLOW_DEFAULT") {
        let vlow = v.to_ascii_lowercase();
        cfg.git.shallow_default = matches!(vlow.as_str(), "1" | "true" | "yes");
    }
    if let Ok(v) = env::var("RELAY_WEB_ONLY") {
        let vlow = v.to_ascii_lowercase();
        cfg.features.web_only = matches!(vlow.as_str(), "1" | "true" | "yes");
    }
}

pub fn load_config(paths: Option<&ConfigPaths>) -> Result<Config> {
    let paths = paths.cloned().unwrap_or_default();
    if !paths.config_path.exists() {
        // Ensure parent exists
        if let Some(parent) = paths.config_path.parent() {
            fs::create_dir_all(parent).with_context(|| {
                format!("Failed to create config directory: {}", parent.display())
            })?;
        }
        let mut cfg = Config::default();
        apply_env_overrides(&mut cfg);
        save_config(&cfg, Some(&paths))?;
        return Ok(cfg);
    }

    let content = fs::read_to_string(&paths.config_path).with_context(|| {
        format!(
            "Failed to read config file at {}",
            paths.config_path.display()
        )
    })?;
    let mut cfg: Config =
        toml::from_str(&content).with_context(|| "Failed to parse TOML config")?;
    apply_env_overrides(&mut cfg);
    Ok(cfg)
}

pub fn save_config(cfg: &Config, paths: Option<&ConfigPaths>) -> Result<()> {
    let paths = paths.cloned().unwrap_or_default();
    if let Some(parent) = paths.config_path.parent() {
        fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create config directory: {}", parent.display()))?;
    }
    let toml_str = toml::to_string_pretty(cfg).with_context(|| "Failed to serialize config")?;
    fs::write(&paths.config_path, toml_str).with_context(|| {
        format!(
            "Failed to write config file at {}",
            paths.config_path.display()
        )
    })?;
    Ok(())
}

pub fn with_custom_path<P: AsRef<Path>>(path: P) -> ConfigPaths {
    ConfigPaths {
        config_path: path.as_ref().to_path_buf(),
    }
}
