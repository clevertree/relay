use anyhow::Result;
use clap::{Parser, Subcommand};
use relay_core::{load_config, save_config, Config, ConfigPaths};
use std::path::PathBuf;

#[derive(Parser, Debug)]
#[command(name = "relay")] 
#[command(about = "Relay CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,

    /// Use a custom config file path instead of the default ~/.relay/config.toml
    #[arg(long)]
    config: Option<PathBuf>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Read or modify configuration values
    Config {
        #[command(subcommand)]
        cmd: ConfigCmd,
    },
    /// Host mode commands
    Host {
        #[command(subcommand)]
        cmd: HostCmd,
    },
    /// Repository utilities
    Repo {
        #[command(subcommand)]
        cmd: RepoCmd,
    },
    /// IPFS operations (stub)
    Ipfs {
        #[command(subcommand)]
        cmd: IpfsCmd,
    },
    /// Git operations via mygit (stub)
    Git {
        #[command(subcommand)]
        cmd: GitCmd,
    },
}

#[derive(Subcommand, Debug)]
enum ConfigCmd {
    /// Get a config value by key (e.g., master_endpoint)
    Get { key: String },
    /// Set a config value by key
    Set { key: String, value: String },
    /// Show the entire config
    Show,
}

#[derive(Subcommand, Debug)]
enum HostCmd {
    /// Start the host server (HTTP + git protocol if available)
    Start {
        #[arg(long, default_value_t = 8080)]
        port: u16,
        #[arg(long, default_value = "./host")]
        root: String,
    },
    /// Stop the host server (if implemented as a background service)
    Stop,
}

#[derive(Subcommand, Debug)]
enum RepoCmd {
    /// Validate repository at path (stub)
    Validate { path: String },
    /// List repositories under root (stub)
    List { root: String },
}

#[derive(Subcommand, Debug)]
enum IpfsCmd {
    /// Add a file or directory to IPFS (stub)
    Add { path: String },
    /// Get a hash from IPFS to output directory (stub)
    Get { hash: String, #[arg(long)] out: Option<String> },
}

#[derive(Subcommand, Debug)]
enum GitCmd {
    /// Clone from peer/url to local path (stub)
    Clone { url: String, dest: String },
    /// Fetch from peer/url (stub)
    Fetch { url: String, r#ref: Option<String> },
    /// Pull branch (stub)
    Pull { url: String, branch: Option<String> },
    /// Push branch (stub)
    Push { url: String, branch: Option<String> },
    /// Convenience commit wrapper (stub)
    Commit { #[arg(short, long)] message: String },
}

fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();

    let cfg_paths = match cli.config {
        Some(p) => ConfigPaths { config_path: p },
        None => ConfigPaths::default(),
    };

    match cli.command {
        Commands::Config { cmd } => handle_config(cmd, cfg_paths)?,
        Commands::Host { cmd } => handle_host(cmd, cfg_paths)?,
        Commands::Repo { cmd } => handle_repo(cmd)?,
        Commands::Ipfs { cmd } => handle_ipfs(cmd)?,
        Commands::Git { cmd } => handle_git(cmd)?,
    }
    Ok(())
}

fn load(paths: &ConfigPaths) -> Result<Config> {
    load_config(Some(paths))
}

fn save(cfg: &Config, paths: &ConfigPaths) -> Result<()> {
    save_config(cfg, Some(paths))
}

fn handle_config(cmd: ConfigCmd, paths: ConfigPaths) -> Result<()> {
    match cmd {
        ConfigCmd::Get { key } => {
            let cfg = load(&paths)?;
            let val = match key.as_str() {
                "master_endpoint" => cfg.master_endpoint,
                "data_path" => cfg.data_path,
                "http.port" => cfg.http.port.to_string(),
                "git.port" => cfg.git.port.to_string(),
                "features.web_only" => cfg.features.web_only.to_string(),
                _ => {
                    eprintln!("Unknown key: {}", key);
                    return Ok(());
                }
            };
            println!("{}", val);
        }
        ConfigCmd::Set { key, value } => {
            let mut cfg = load(&paths)?;
            match key.as_str() {
                "master_endpoint" => cfg.master_endpoint = value,
                "data_path" => cfg.data_path = value,
                "http.port" => cfg.http.port = value.parse().unwrap_or(cfg.http.port),
                "git.port" => cfg.git.port = value.parse().unwrap_or(cfg.git.port),
                "features.web_only" => cfg.features.web_only = matches!(value.as_str(), "true" | "1" | "yes"),
                _ => {
                    eprintln!("Unknown key: {}", key);
                    return Ok(());
                }
            }
            save(&cfg, &paths)?;
            println!("OK");
        }
        ConfigCmd::Show => {
            let cfg = load(&paths)?;
            println!("{}", toml::to_string_pretty(&cfg)?);
        }
    }
    Ok(())
}

fn handle_host(cmd: HostCmd, _paths: ConfigPaths) -> Result<()> {
    match cmd {
        HostCmd::Start { port, root } => {
            println!(
                "[stub] Starting host HTTP server on port {} with root {} (and git server on {} if enabled)",
                port, root, 9418
            );
            // TODO: call into relay_core http + git servers.
        }
        HostCmd::Stop => {
            println!("[stub] Stopping host server (not implemented yet)");
        }
    }
    Ok(())
}

fn handle_repo(cmd: RepoCmd) -> Result<()> {
    match cmd {
        RepoCmd::Validate { path } => {
            println!("[stub] Validating repo at {}", path);
        }
        RepoCmd::List { root } => {
            println!("[stub] Listing repos under {}", root);
        }
    }
    Ok(())
}

fn handle_ipfs(cmd: IpfsCmd) -> Result<()> {
    match cmd {
        IpfsCmd::Add { path } => println!("[stub] IPFS add {}", path),
        IpfsCmd::Get { hash, out } => println!("[stub] IPFS get {} -> {:?}", hash, out),
    }
    Ok(())
}

fn handle_git(cmd: GitCmd) -> Result<()> {
    match cmd {
        GitCmd::Clone { url, dest } => println!("[stub] git clone {} {}", url, dest),
        GitCmd::Fetch { url, r#ref } => println!("[stub] git fetch {} {:?}", url, r#ref),
        GitCmd::Pull { url, branch } => println!("[stub] git pull {} {:?}", url, branch),
        GitCmd::Push { url, branch } => println!("[stub] git push {} {:?}", url, branch),
        GitCmd::Commit { message } => println!("[stub] git commit -m {}", message),
    }
    Ok(())
}
