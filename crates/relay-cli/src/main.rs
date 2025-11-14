use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use relay_core::{load_config, save_config, validate_repo, ValidationReport, Config, ConfigPaths};
use std::fs;
use std::path::{Path, PathBuf};
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
    /// Git operations via system Git
    Git {
        #[command(subcommand)]
        cmd: GitCmd,
    },
    /// System git-daemon control
    GitDaemon {
        #[command(subcommand)]
        cmd: GitDaemonCmd,
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
    /// Start the host server (HTTP stub) and spawn system git daemon for repos
    Start {
        #[arg(long, default_value_t = 8080)]
        port: u16,
        #[arg(long, default_value = "./host")]
        root: String,
        /// Override git daemon port (defaults to config git.port)
        #[arg(long)]
        git_port: Option<u16>,
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
    /// List remote refs using the relay git protocol client (M3.1)
    LsRemote { url: String },
    /// Clone from peer/url (uses system git for now)
    Clone { url: String, dest: String },
    /// Fetch from peer/url (uses system git for now)
    Fetch { url: String, r#ref: Option<String> },
    /// Pull branch (uses system git for now)
    Pull { url: String, branch: Option<String> },
    /// Push branch (uses system git for now)
    Push { url: String, branch: Option<String> },
    /// Convenience commit wrapper (uses system git)
    Commit { #[arg(short, long)] message: String },
}

#[derive(Subcommand, Debug)]
enum GitDaemonCmd {
    /// Start system git-daemon to serve repositories
    Start {
        /// Base path for repositories (if not provided, uses host/repos under data_path or current dir)
        #[arg(long)]
        base_path: Option<String>,
        /// Port to listen on (defaults to config git.port)
        #[arg(long)]
        port: Option<u16>,
        /// Allow pushes (receive-pack). Unsafe without auth; default false
        #[arg(long, default_value_t = false)]
        enable_receive_pack: bool,
        /// Export all repositories without git-daemon-export-ok files
        #[arg(long, default_value_t = true)]
        export_all: bool,
    },
    /// Stop git-daemon (best-effort; only if started in this session)
    Stop,
}

#[derive(Subcommand, Debug)]
enum HooksCmd {
    /// Install git hooks into the given repository
    Install { path: String },
    /// Validate incoming updates from stdin as a Git pre-receive hook would
    PreReceive { 
        /// Path to the target repository (bare or non-bare)
        path: String,
        /// Validate only this ref (defaults to refs/heads/main)
        #[arg(long)]
        ref_filter: Option<String>,
        /// Emit JSON report to stdout
        #[arg(long)]
        json: bool,
    },
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
        Commands::GitDaemon { cmd } => handle_git_daemon(cmd, cfg_paths)?,
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
                "git.shallow_default" => cfg.git.shallow_default.to_string(),
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
                "git.shallow_default" => {
                    let v = value.to_ascii_lowercase();
                    cfg.git.shallow_default = matches!(v.as_str(), "true" | "1" | "yes");
                }
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
        HostCmd::Start { port, root, git_port } => {
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
                "Starting host (HTTP stub) on port {} with root {}",
                port, root
            );

            // Start system git daemon to serve repos over git://
            // Requirements: Git must be installed and on PATH.
            let git_port = git_port.unwrap_or(cfg.git.port);
            let base_path = std::fs::canonicalize(&repos_root).unwrap_or(repos_root.clone());
            println!(
                "Starting git daemon on git://0.0.0.0:{}/ (base-path = {})",
                git_port,
                base_path.display()
            );
            let mut git_child = Command::new("git")
                .arg("daemon")
                .arg(format!("--base-path={}", base_path.display()))
                .arg("--export-all")
                .arg("--reuseaddr")
                .arg("--informative-errors")
                .arg("--listen=0.0.0.0")
                .arg(format!("--port={}", git_port))
                .arg("--verbose")
                .current_dir(&base_path)
                .spawn()
                .with_context(|| "Failed to start git daemon. Is Git installed and on PATH?")?;

            // TODO: Start HTTP server here (to be implemented in M4).
            println!("HTTP server not yet implemented; press Ctrl+C to stop.");

            // Block until Ctrl+C, then stop git daemon gracefully
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            ctrlc::set_handler(move || {
                let _ = tx.send(());
            }).context("Failed to set Ctrl+C handler")?;
            // Wait for signal
            let _ = rx.recv();
            println!("Shutting down...");
            // Terminate git daemon
            match git_child.kill() {
                Ok(_) => { let _ = git_child.wait(); },
                Err(e) => eprintln!("Failed to stop git daemon: {}", e),
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

fn handle_git_daemon(cmd: GitDaemonCmd, paths: ConfigPaths) -> Result<()> {
    match cmd {
        GitDaemonCmd::Start { base_path, port, enable_receive_pack, export_all } => {
            let cfg = load(&paths)?;
            // Determine base path
            let base_path = if let Some(bp) = base_path {
                PathBuf::from(bp)
            } else {
                // Prefer ./host/repos if exists, else cfg.data_path/host/repos
                let cwd_host_repos = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
                    .join("host").join("repos");
                if cwd_host_repos.exists() { cwd_host_repos } else { PathBuf::from(cfg.data_path.clone()).join("repos") }
            };
            if !base_path.exists() {
                std::fs::create_dir_all(&base_path).with_context(|| format!(
                    "Failed to create base path at {}",
                    base_path.display()
                ))?;
            }
            let port = port.unwrap_or(cfg.git.port);
            let base_path_abs = std::fs::canonicalize(&base_path).unwrap_or(base_path.clone());
            println!(
                "Starting git daemon on git://0.0.0.0:{}/ (base-path = {})",
                port,
                base_path_abs.display()
            );
            let mut cmd = Command::new("git");
            cmd.arg("daemon")
                .arg(format!("--base-path={}", base_path_abs.display()))
                .arg("--reuseaddr")
                .arg("--informative-errors")
                .arg("--listen=0.0.0.0")
                .arg(format!("--port={}", port))
                .arg("--verbose")
                .current_dir(&base_path_abs);
            if export_all { cmd.arg("--export-all"); }
            if enable_receive_pack { cmd.arg("--enable=receive-pack"); }
            let mut child = cmd.spawn().with_context(|| "Failed to start git daemon. Is Git installed and on PATH?")?;

            // Block until Ctrl+C, then stop
            let (tx, rx) = std::sync::mpsc::channel::<()>();
            ctrlc::set_handler(move || { let _ = tx.send(()); })?;
            println!("git-daemon running. Press Ctrl+C to stop.");
            let _ = rx.recv();
            println!("Stopping git-daemon...");
            match child.kill() {
                Ok(_) => { let _ = child.wait(); },
                Err(e) => eprintln!("Failed to stop git-daemon: {}", e),
            }
        }
        GitDaemonCmd::Stop => {
            eprintln!("Stop is only supported for foreground processes started in this session. Use your OS tools to stop background git-daemon if any.");
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
        GitCmd::LsRemote { url } => git_ls_remote(&url),
        GitCmd::Clone { url, dest } => {
            // Respect shallow/full default from shared config
            let cfg = relay_core::load_config(None).unwrap_or_default();
            if cfg.git.shallow_default {
                run_git(&["clone", "--depth", "1", &url, &dest])
            } else {
                run_git(&["clone", &url, &dest])
            }
        },
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

fn git_ls_remote(url: &str) -> Result<()> {
    // Delegate to system git for robustness and protocol correctness
    run_git(&["ls-remote", url])
}

fn run_git(args: &[&str]) -> Result<()> {
    let output = Command::new("git").args(args).output().with_context(|| format!(
        "Failed to invoke system git with args: {:?}", args
    ))?;
    if output.status.success() {
        // forward stdout for convenience
        if !output.stdout.is_empty() {
            print!("{}", String::from_utf8_lossy(&output.stdout));
        }
        Ok(())
    } else {
        let code = output.status.code().unwrap_or(-1);
        let stderr_s = String::from_utf8_lossy(&output.stderr);
        let stdout_s = String::from_utf8_lossy(&output.stdout);
        anyhow::bail!(
            "git exited with status {} (args: {:?})\nstdout:\n{}\nstderr:\n{}",
            code, args, stdout_s, stderr_s
        )
    }
}

fn handle_hooks(cmd: HooksCmd) -> Result<()> {
    match cmd {
        HooksCmd::Install { path } => {
            let repo_root = Path::new(&path);
            let git_dir = repo_root.join(".git");
            let hooks_dir = if git_dir.is_dir() {
                git_dir.join("hooks")
            } else {
                // Bare repo: hooks live directly under repo_root/hooks
                repo_root.join("hooks")
            };
            if !hooks_dir.exists() {
                std::fs::create_dir_all(&hooks_dir).with_context(|| format!(
                    "Failed to create hooks directory at {}",
                    hooks_dir.display()
                ))?;
            }
            // Pre-commit hook (only for non-bare repos)
            if git_dir.is_dir() {
                let pre_commit = hooks_dir.join("pre-commit");
                let script = make_pre_commit_sh_script(&repo_root);
                fs::write(&pre_commit, script).with_context(|| format!(
                    "Failed to write pre-commit at {}",
                    pre_commit.display()
                ))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    let mode = 0o755;
                    fs::set_permissions(&pre_commit, fs::Permissions::from_mode(mode))?;
                }
            }
            // Pre-receive hook (works for bare and non-bare)
            let pre_receive = hooks_dir.join("pre-receive");
            let pre_receive_body = make_pre_receive_sh_script(&repo_root);
            fs::write(&pre_receive, pre_receive_body).with_context(|| format!(
                "Failed to write pre-receive at {}",
                pre_receive.display()
            ))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = 0o755;
                fs::set_permissions(&pre_receive, fs::Permissions::from_mode(mode))?;
            }
            println!("Installed hooks to {}", hooks_dir.display());
        }
        HooksCmd::PreReceive { path, ref_filter, json } => {
            use std::io::{self, Read};
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            let updates = parse_pre_receive_input(&input);
            let filter = ref_filter.unwrap_or_else(|| "refs/heads/main".to_string());
            let updates = filter_updates(&updates, &filter);

            let mut any_fail = false;
            let mut reports: Vec<(String, String, ValidationReport)> = Vec::new();
            for (_old, new_oid, rname) in updates {
                if is_all_zero_oid(&new_oid) { continue; }
                match validate_commit_tree(&path, &new_oid) {
                    Ok(report) => {
                        if !report.passed { any_fail = true; }
                        reports.push((rname.clone(), new_oid.clone(), report));
                    }
                    Err(e) => {
                        eprintln!("Validation error for {} @ {}: {}", rname, new_oid, e);
                        std::process::exit(2);
                    }
                }
            }
            if json {
                // Emit aggregated JSON
                #[derive(serde::Serialize)]
                struct Item { r#ref: String, oid: String, report: ValidationReport }
                let payload: Vec<Item> = reports.into_iter().map(|(r, o, rep)| Item{ r#ref: r, oid: o, report: rep }).collect();
                println!("{}", serde_json::to_string_pretty(&payload)?);
            } else {
                for (r, o, rep) in &reports {
                    if rep.passed {
                        println!("[OK] {} @ {}", r, o);
                    } else {
                        eprintln!("[FAIL] {} @ {}:", r, o);
                        for err in &rep.errors {
                            eprintln!("- [{}] {} — {}", err.code, err.path, err.message);
                        }
                    }
                }
            }
            if any_fail { std::process::exit(1); }
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

fn make_pre_commit_sh_script(repo_root: &Path) -> String {
    let abs = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let path_str = abs.to_string_lossy().to_string();
    format!(r#"#!/bin/sh
# Auto-generated by relay hooks install (pre-commit)
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

fn make_pre_receive_sh_script(repo_root: &Path) -> String {
    let abs = fs::canonicalize(repo_root).unwrap_or_else(|_| repo_root.to_path_buf());
    let path_str = abs.to_string_lossy().to_string();
    // Detect bare vs non-bare at runtime in the script for robustness
    format!(r#"#!/bin/sh
# Auto-generated by relay hooks install (pre-receive)
REPO_DIR="{path}"
if [ ! -d "$REPO_DIR/.git" ]; then
  # bare repo
  REPO_DIR="$REPO_DIR"
fi
if command -v relay >/dev/null 2>&1; then
  relay hooks pre-receive "$REPO_DIR" --ref-filter refs/heads/main
elif command -v relay-cli >/dev/null 2>&1; then
  relay-cli hooks pre-receive "$REPO_DIR" --ref-filter refs/heads/main
else
  echo 'relay (or relay-cli) not found in PATH' 1>&2
  exit 1
fi
"#, path = path_str)
}

fn is_all_zero_oid(s: &str) -> bool {
    let t = s.trim();
    t.len() == 40 && t.chars().all(|c| c == '0')
}

fn validate_commit_tree(repo_path: &str, oid: &str) -> Result<ValidationReport> {
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};
    // Create a unique temporary directory
    let ts = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis();
    let tmp = std::env::temp_dir().join(format!("relay-validate-{}-{}", &oid[..7], ts));
    fs::create_dir_all(&tmp).with_context(|| format!("Failed to create temp dir at {}", tmp.display()))?;

    // Determine git-dir: bare vs non-bare
    let repo = Path::new(repo_path);
    let git_dir = if repo.join(".git").is_dir() { repo.join(".git") } else { repo.to_path_buf() };

    // Checkout the tree into the temp work-tree
    let status = Command::new("git")
        .arg(format!("--git-dir={}", git_dir.display()))
        .arg(format!("--work-tree={}", tmp.display()))
        .arg("checkout")
        .arg("-f")
        .arg(oid)
        .arg("--")
        .arg(".")
        .status()
        .with_context(|| "Failed to invoke git to materialize commit for validation")?;
    if !status.success() {
        let _ = std::fs::remove_dir_all(&tmp);
        anyhow::bail!("git checkout failed for {}", oid);
    }

    // Run validator
    let report = validate_repo(tmp.to_string_lossy().as_ref());

    // Cleanup temp dir
    let _ = std::fs::remove_dir_all(&tmp);

    report
}


#[cfg(test)]
mod pre_receive_tests {
    use super::*;

    #[test]
    fn parse_single_line() {
        let s = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/main\n";
        let out = parse_pre_receive_input(s);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].0.len(), 40);
        assert_eq!(out[0].1.len(), 40);
        assert_eq!(out[0].2, "refs/heads/main");
    }

    #[test]
    fn filter_only_main() {
        let s = "0000000000000000000000000000000000000000 cccccccccccccccccccccccccccccccccccccccc refs/heads/dev\n
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb refs/heads/main\n";
        let parsed = parse_pre_receive_input(s);
        let filtered = filter_updates(&parsed, "refs/heads/main");
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].2, "refs/heads/main");
    }
}

fn parse_pre_receive_input(input: &str) -> Vec<(String, String, String)> {
    let mut out = Vec::new();
    for line in input.lines() {
        let lt = line.trim();
        if lt.is_empty() { continue; }
        let parts: Vec<&str> = lt.split_whitespace().collect();
        if parts.len() != 3 { continue; }
        out.push((parts[0].to_string(), parts[1].to_string(), parts[2].to_string()));
    }
    out
}

fn filter_updates(updates: &[(String, String, String)], ref_filter: &str) -> Vec<(String, String, String)> {
    updates
        .iter()
        .filter(|(_o, _n, r)| r.as_str() == ref_filter)
        .cloned()
        .collect()
}
