use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use relay_core::{load_config, save_config, quick_validate_repo, validate_repo, ValidationReport, Config, ConfigPaths, start_git_server, stop_git_server};
use std::fs;
use std::path::{Path, PathBuf};
use std::io::Write;
use std::process::Command;

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
    /// Git hook management
    Hooks {
        #[command(subcommand)]
        cmd: HooksCmd,
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
    /// Validate repository at path
    Validate { path: String, #[arg(long)] json: bool },
    /// List repositories under root
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

#[derive(Subcommand, Debug)]
enum HooksCmd {
    /// Install git hooks into the given repository
    Install { path: String },
    /// Run a validation as hooks would, for testing
    Test { path: String, #[arg(long)] json: bool },
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
        Commands::Hooks { cmd } => handle_hooks(cmd)?,
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

fn handle_host(cmd: HostCmd, paths: ConfigPaths) -> Result<()> {
    match cmd {
        HostCmd::Start { port, root } => {
            // Load config (to get git.port and others)
            let cfg = load(&paths)?;
            let repos_root = std::path::Path::new(&root).join("repos");
            if !repos_root.exists() {
                std::fs::create_dir_all(&repos_root).with_context(|| format!(
                    "Failed to create repos root at {}",
                    repos_root.display()
                ))?;
            }

            println!(
                "Starting host HTTP server on port {} with root {}",
                port, root
            );

            // Start git protocol server using relay-core (feature-gated)
            let git_port = cfg.git.port;
            let handle = start_git_server(git_port, &repos_root)?;
            println!(
                "Git server running on git://localhost:{}/ — serving {}",
                handle.port,
                handle.repos_root.display()
            );

            // TODO: Start HTTP server here (to be implemented in M4).
            println!("HTTP server not yet implemented; press Ctrl+C to stop.");

            // Block until Ctrl+C, then stop git server gracefully
            let mut handle_opt = Some(handle);
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            ctrlc::set_handler(move || {
                let _ = tx.send(());
            }).context("Failed to set Ctrl+C handler")?;
            // Wait for signal
            let _ = rx.recv();
            println!("Shutting down...");
            if let Some(h) = handle_opt.take() {
                let _ = stop_git_server(h);
            }
        }
        HostCmd::Stop => {
            println!("Stopping host server: not implemented yet");
        }
    }
    Ok(())
}

fn handle_repo(cmd: RepoCmd) -> Result<()> {
    match cmd {
        RepoCmd::Validate { path, json } => {
            // Run full validator
            match validate_repo(&path) {
                Ok(report) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&report)?);
                    } else {
                        if report.passed {
                            println!("Validation PASSED for {}", path);
                        } else {
                            eprintln!("Validation FAILED for {}:", path);
                            for err in &report.errors {
                                eprintln!("- [{}] {} — {}", err.code, err.path, err.message);
                            }
                        }
                    }
                    if !report.passed {
                        std::process::exit(1);
                    }
                }
                Err(e) => {
                    eprintln!("Validation error: {}", e);
                    std::process::exit(2);
                }
            }
        }
        RepoCmd::List { root } => {
            // Simple listing of immediate child directories under root as repos
            let root_path = std::path::Path::new(&root);
            if root_path.is_dir() {
                for entry in std::fs::read_dir(root_path)? {
                    let entry = entry?;
                    if entry.file_type()?.is_dir() {
                        println!("{}", entry.file_name().to_string_lossy());
                    }
                }
            } else {
                eprintln!("Not a directory: {}", root);
                std::process::exit(1);
            }
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
        GitCmd::Clone { url, dest } => run_git(&["clone", &url, &dest]),
        GitCmd::Fetch { url, r#ref } => {
            match r#ref {
                Some(r) => run_git(&["fetch", &url, &r]),
                None => run_git(&["fetch", &url]),
            }
        }
        GitCmd::Pull { url, branch } => {
            match branch {
                Some(b) => run_git(&["pull", &url, &b]),
                None => run_git(&["pull", &url]),
            }
        }
        GitCmd::Push { url, branch } => {
            match branch {
                Some(b) => run_git(&["push", &url, &b]),
                None => run_git(&["push", &url]),
            }
        }
        GitCmd::Commit { message } => run_git(&["commit", "-m", &message]),
    }
}

fn run_git(args: &[&str]) -> Result<()> {
    let status = Command::new("git").args(args).status().with_context(|| format!(
        "Failed to invoke system git with args: {:?}", args
    ))?;
    if status.success() {
        Ok(())
    } else {
        let code = status.code().unwrap_or(-1);
        anyhow::bail!("git exited with status {} (args: {:?})", code, args)
    }
}

fn handle_hooks(cmd: HooksCmd) -> Result<()> {
    match cmd {
        HooksCmd::Install { path } => {
            let repo_root = Path::new(&path);
            let git_hooks = repo_root.join(".git").join("hooks");
            if !git_hooks.exists() {
                eprintln!(
                    "Git hooks directory not found at {}. Is this a git repository?",
                    git_hooks.display()
                );
                std::fs::create_dir_all(&git_hooks).with_context(|| format!(
                    "Failed to create hooks directory at {}",
                    git_hooks.display()
                ))?;
            }
            // Pre-commit hook (sh)
            let pre_commit = git_hooks.join("pre-commit");
            let script = make_sh_hook_script(&repo_root);
            fs::write(&pre_commit, script).with_context(|| format!(
                "Failed to write pre-commit at {}",
                pre_commit.display()
            ))?;
            // Pre-receive hook (sh)
            let pre_receive = git_hooks.join("pre-receive");
            let pre_receive_body = make_sh_hook_script(&repo_root);
            fs::write(&pre_receive, pre_receive_body).with_context(|| format!(
                "Failed to write pre-receive at {}",
                pre_receive.display()
            ))?;
            // Try to set executable bits on Unix (no-op on Windows)
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = 0o755;
                fs::set_permissions(&pre_commit, fs::Permissions::from_mode(mode))?;
                fs::set_permissions(&pre_receive, fs::Permissions::from_mode(mode))?;
            }
            println!("Installed hooks to {}", git_hooks.display());
        }
        HooksCmd::Test { path, json } => {
            match validate_repo(&path) {
                Ok(report) => {
                    if json {
                        println!("{}", serde_json::to_string_pretty(&report)?);
                    } else if report.passed {
                        println!("Hooks test: PASSED for {}", path);
                    } else {
                        eprintln!("Hooks test: FAILED for {}:", path);
                        for err in &report.errors {
                            eprintln!("- [{}] {} — {}", err.code, err.path, err.message);
                        }
                    }
                    if !report.passed { std::process::exit(1); }
                }
                Err(e) => {
                    eprintln!("Hook validation error: {}", e);
                    std::process::exit(2);
                }
            }
        }
    }
    Ok(())
}

fn make_sh_hook_script(repo_root: &Path) -> String {
    let abs = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let path_str = abs.to_string_lossy().to_string();
    format!(r#"#!/bin/sh
# Auto-generated by relay hooks install
if command -v relay >/dev/null 2>&1; then
  relay repo validate --path "{path}"
elif command -v relay-cli >/dev/null 2>&1; then
  relay-cli repo validate --path "{path}"
else
  echo 'relay (or relay-cli) not found in PATH' 1>&2
  exit 1
fi
"#, path = path_str)
}
