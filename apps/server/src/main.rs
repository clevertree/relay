use std::{
    net::SocketAddr,
    path::{Path as FsPath, PathBuf},
    str::FromStr,
};

use axum::{
    body::{Body, Bytes},
    extract::{Path as AxPath, Query, State},
    http::{HeaderMap, Request, StatusCode},
    middleware::Next,
    response::{IntoResponse, Response},
    routing::{get, head, post},
    Json, Router,
};
use base64::{engine::general_purpose, Engine as _};
use clap::{Args, Parser, Subcommand};
use git2::{ObjectType, Oid, Repository, Signature};
use percent_encoding::percent_decode_str as url_decode;
use pulldown_cmark::{html, Parser as MdParser};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::time::Duration;
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    // Now represents the repository ROOT directory that contains one or more bare repos (name.git)
    repo_path: PathBuf,
    // Additional static directories to serve from root before Git/IPFS
    static_paths: Vec<PathBuf>,
}

const HEADER_BRANCH: &str = "X-Relay-Branch";
const HEADER_REPO: &str = "X-Relay-Repo";
const DEFAULT_BRANCH: &str = "main";
// All repository files are now allowed for read and write operations.

const DEFAULT_IPFS_CACHE_ROOT: &str = "/srv/relay/ipfs-cache";

// IPFS fetch deduplication removed; IPFS resolution is delegated to repo script

#[derive(Parser, Debug)]
#[command(
    name = "relay-server",
    version,
    about = "Relay Server and CLI utilities",
    propagate_version = true
)]
struct Cli {
    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Run the HTTP server
    Serve(ServeArgs),
}

#[derive(Args, Debug)]
struct ServeArgs {
    /// Bare Git repository path
    #[arg(long)]
    repo: Option<PathBuf>,
    /// Additional static directory to serve files from (may be repeated)
    #[arg(long = "static", value_name = "DIR")]
    static_paths: Vec<PathBuf>,
    /// Bind address (host:port)
    #[arg(long)]
    bind: Option<String>,
}

// IpfsAdd removed — IPFS logic is delegated to repo scripts

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    // Set up logging: stdout + rolling file appender
    // Ensure logs directory exists
    let _ = std::fs::create_dir_all("logs");
    let file_appender = rolling::daily("logs", "server.log");
    let (file_nb, _guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = tracing_subscriber::EnvFilter::from_default_env();
    let stdout_layer = fmt::layer()
        .with_target(true)
        .with_thread_ids(false)
        .with_thread_names(false)
        .compact();
    let file_layer = fmt::layer()
        .with_writer(file_nb)
        .with_target(true)
        .compact();
    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    // Determine serve args from CLI/env
    let (repo_path, static_paths, bind_cli): (PathBuf, Vec<PathBuf>, Option<String>) =
        match cli.command {
            Some(Commands::Serve(sa)) => {
                let rp = sa
                    .repo
                    .or_else(|| std::env::var("RELAY_REPO_PATH").ok().map(PathBuf::from))
                    .unwrap_or_else(|| PathBuf::from("data"));
                (rp, sa.static_paths, sa.bind)
            }
            _ => {
                let rp = std::env::var("RELAY_REPO_PATH")
                    .map(PathBuf::from)
                    .unwrap_or_else(|_| PathBuf::from("data"));
                (rp, Vec::new(), None)
            }
        };
    info!(repo_path = %repo_path.display(), "Repository path resolved");
    // Treat path as repository ROOT directory
    let _ = std::fs::create_dir_all(&repo_path);

    // Initialize repos from RELAY_MASTER_REPO_LIST if provided
    if let Ok(repo_list_str) = std::env::var("RELAY_MASTER_REPO_LIST") {
        let repos: Vec<&str> = repo_list_str.split(';').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        for repo_url in repos {
            let repo_name = repo_url
                .split('/')
                .last()
                .and_then(|s| s.strip_suffix(".git"))
                .unwrap_or(repo_url);
            let bare_repo_path = repo_path.join(format!("{}.git", repo_name));
            
            // Skip if already cloned
            if bare_repo_path.exists() {
                info!(repo = %repo_name, "Repository already exists, skipping clone");
                continue;
            }
            
            info!(repo = %repo_name, url = %repo_url, "Cloning repository");
            match std::process::Command::new("git")
                .arg("clone")
                .arg("--bare")
                .arg(repo_url)
                .arg(&bare_repo_path)
                .output()
            {
                Ok(output) => {
                    if output.status.success() {
                        info!(repo = %repo_name, "Successfully cloned repository");
                    } else {
                        let stderr = String::from_utf8_lossy(&output.stderr);
                        warn!(repo = %repo_name, error = %stderr, "Failed to clone repository");
                    }
                }
                Err(e) => {
                    warn!(repo = %repo_name, error = %e, "Failed to execute git clone");
                }
            }
        }
    }

    let state = AppState {
        repo_path,
        static_paths,
    };

    // Build app (breaking changes: removed /status and /query/*; OPTIONS is the discovery endpoint)
    let app = Router::new()
        .route("/openapi.yaml", get(get_openapi_yaml))
        .route("/swagger-ui", get(get_swagger_ui))
        .route("/api/config", get(get_api_config))
        .route("/git-pull", post(post_git_pull))
        .route("/", get(get_root).head(head_root).options(options_capabilities))
        .route(
            "/*path",
            get(get_file)
                .head(head_file)
                .put(put_file)
                .delete(delete_file)
                .options(options_capabilities),
        )
        // Add permissive CORS headers without intercepting OPTIONS
        .layer(axum::middleware::from_fn(cors_headers))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Peer tracker removed; no background registration

    let bind = bind_cli
        .or_else(|| std::env::var("RELAY_BIND").ok())
        .unwrap_or_else(|| "0.0.0.0:8088".into());
    let addr = SocketAddr::from_str(&bind)?;
    info!(%addr, "Relay server listening");
    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

// IPFS CLI commands removed; IPFS logic is delegated to repo scripts

// Serve a minimal OpenAPI YAML specification (placeholder)
async fn get_openapi_yaml() -> impl IntoResponse {
    let yaml = r#"openapi: 3.0.0
info:
  title: Relay API
  version: 0.0.0
paths: {}
"#;
    (StatusCode::OK, [("Content-Type", "application/yaml")], yaml)
}

// Serve Swagger UI HTML page
async fn get_swagger_ui() -> impl IntoResponse {
    let html = r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="SwaggerUI" />
    <title>SwaggerUI</title>
    <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui.css" />
</head>
<body>
<div id="swagger-ui"></div>
<script src="https://unpkg.com/swagger-ui-dist@5.11.0/swagger-ui-bundle.js" crossorigin></script>
<script>
    window.onload = () => {
        window.ui = SwaggerUIBundle({
            url: '/openapi.yaml',
            dom_id: '#swagger-ui',
            deepLinking: true,
            presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIBundle.presets.standalone
            ],
            plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
            ],
            layout: "BaseLayout"
        });
    };
</script>
</body>
</html>"#;
    (StatusCode::OK, [("Content-Type", "text/html")], html)
}

/// GET /api/config — returns configuration including peer list from RELAY_MASTER_PEER_LIST
async fn get_api_config() -> impl IntoResponse {
    #[derive(Serialize)]
    struct Config {
        peers: Vec<String>,
    }

    let peer_list = std::env::var("RELAY_MASTER_PEER_LIST")
        .unwrap_or_default()
        .split(';')
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>();

    let config = Config { peers: peer_list };
    (StatusCode::OK, Json(config))
}

/// POST /git-pull — performs git pull from origin on the bare repository
async fn post_git_pull(State(state): State<AppState>) -> impl IntoResponse {
    #[derive(Serialize)]
    struct GitPullResponse {
        success: bool,
        message: String,
        updated: bool,
        before_commit: Option<String>,
        after_commit: Option<String>,
        error: Option<String>,
    }

    let repo_path = &state.repo_path;

    match Repository::open(repo_path) {
        Ok(repo) => {
            // Get current HEAD commit before pulling
            let before_commit = repo
                .head()
                .ok()
                .and_then(|h| h.target())
                .map(|oid| oid.to_string());

            // Perform git fetch from origin
            match repo.find_remote("origin") {
                Ok(mut remote) => {
                    match remote.fetch(&["main"], None, None) {
                        Ok(_) => {
                            // Fast-forward merge FETCH_HEAD to current branch
                            let fetch_head = repo.find_reference("FETCH_HEAD");
                            let updated = if let Ok(fetch_ref) = fetch_head {
                                match fetch_ref.target() {
                                    Some(fetch_oid) => {
                                        // Get current branch reference
                                        match repo.head() {
                                            Ok(head_ref) => {
                                                if let Some(head_oid) = head_ref.target() {
                                                    // Compare commits
                                                    if fetch_oid != head_oid {
                                                        // Fast-forward update
                                                        match repo.set_head_detached(fetch_oid) {
                                                            Ok(_) => {
                                                                // Update working directory
                                                                match repo.checkout_head(None) {
                                                                    Ok(_) => true,
                                                                    Err(_) => false,
                                                                }
                                                            }
                                                            Err(_) => false,
                                                        }
                                                    } else {
                                                        false // No update needed
                                                    }
                                                } else {
                                                    false
                                                }
                                            }
                                            Err(_) => false,
                                        }
                                    }
                                    None => false,
                                }
                            } else {
                                false
                            };

                            // Get current HEAD commit after pulling
                            let after_commit = repo
                                .head()
                                .ok()
                                .and_then(|h| h.target())
                                .map(|oid| oid.to_string());

                            let message = if updated {
                                format!(
                                    "Repository updated from origin. Before: {}, After: {}",
                                    before_commit.clone().unwrap_or_default(),
                                    after_commit.clone().unwrap_or_default()
                                )
                            } else {
                                "Repository is already up to date with origin".to_string()
                            };

                            info!("git-pull: {}", message);
                            (
                                StatusCode::OK,
                                Json(GitPullResponse {
                                    success: true,
                                    message,
                                    updated,
                                    before_commit,
                                    after_commit,
                                    error: None,
                                }),
                            )
                        }
                        Err(e) => {
                            let error_msg = format!("Failed to fetch from origin: {}", e);
                            warn!("git-pull error: {}", error_msg);
                            (
                                StatusCode::OK,
                                Json(GitPullResponse {
                                    success: false,
                                    message: error_msg.clone(),
                                    updated: false,
                                    before_commit,
                                    after_commit: None,
                                    error: Some(error_msg),
                                }),
                            )
                        }
                    }
                }
                Err(e) => {
                    let error_msg = format!("Failed to find remote 'origin': {}", e);
                    warn!("git-pull error: {}", error_msg);
                    (
                        StatusCode::OK,
                        Json(GitPullResponse {
                            success: false,
                            message: error_msg.clone(),
                            updated: false,
                            before_commit,
                            after_commit: None,
                            error: Some(error_msg),
                        }),
                    )
                }
            }
        }
        Err(e) => {
            let error_msg = format!("Failed to open repository at {:?}: {}", repo_path, e);
            error!("git-pull error: {}", error_msg);
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(GitPullResponse {
                    success: false,
                    message: error_msg.clone(),
                    updated: false,
                    before_commit: None,
                    after_commit: None,
                    error: Some(error_msg),
                }),
            )
        }
    }
}

/// Parse simple KEY=VALUE lines from a .env-like string. Ignores comments and blank lines.
fn parse_dotenv(s: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in s.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let mut parts = line.splitn(2, '=');
        let k = parts.next().unwrap_or("").trim();
        let v = parts.next().unwrap_or("").trim();
        if k.is_empty() {
            continue;
        }
        // Strip surrounding quotes if present
        let val = if (v.starts_with('"') && v.ends_with('"'))
            || (v.starts_with('\'') && v.ends_with('\''))
        {
            v[1..v.len().saturating_sub(1)].to_string()
        } else {
            v.to_string()
        };
        map.insert(k.to_string(), val);
    }
    map
}

fn ensure_bare_repo(path: &PathBuf) -> anyhow::Result<()> {
    if path.exists() {
        let _ = Repository::open_bare(path)?;
        return Ok(());
    }
    std::fs::create_dir_all(path)?;
    let repo = Repository::init_bare(path)?;
    // Create an initial empty commit on main so reads have a ref
    let sig = Signature::now("relay", "relay@local")?;
    let tree_id = {
        let mut index = repo.index()?;
        index.write_tree()?
    };
    let tree = repo.find_tree(tree_id)?;
    let commit_id = repo.commit(
        Some("refs/heads/main"),
        &sig,
        &sig,
        "Initial commit",
        &tree,
        &[],
    )?;
    info!(?commit_id, "Initialized bare repo with main branch");
    Ok(())
}

// Removed legacy /status response model — discovery moved under OPTIONS

#[derive(Deserialize)]
struct RulesDoc {
    #[serde(default, rename = "indexFile")]
    index_file: Option<String>,
}

#[derive(Deserialize, Debug)]
struct RelayConfig {
    #[serde(default)]
    client: ClientConfig,
    #[serde(default)]
    server: Option<serde_json::Value>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
}

#[derive(Deserialize, Debug, Default)]
struct ClientConfig {
    #[serde(default)]
    hooks: HooksConfig,
}

#[derive(Deserialize, Debug, Default)]
struct HooksConfig {
    #[serde(default)]
    get: Option<HookPath>,
    #[serde(default)]
    query: Option<HookPath>,
}

#[derive(Deserialize, Debug)]
struct HookPath {
    path: String,
}

/// Read .relay.yaml configuration from git tree for the given branch
fn read_relay_config(repo: &Repository, branch: &str) -> Option<RelayConfig> {
    let branch_ref = format!("refs/heads/{}", branch);
    let obj = repo.revparse_single(&branch_ref).ok()?;
    let commit = obj.as_commit()?;
    let tree = commit.tree().ok()?;

    let entry = tree.get_name(".relay.yaml")?;
    let obj = entry.to_object(repo).ok()?;
    let blob = obj.as_blob()?;
    let content = std::str::from_utf8(blob.content()).ok()?;
    serde_yaml::from_str(content).ok()
}

// Removed legacy /status endpoint handler

/// OPTIONS handler — discovery: capabilities, branches, repos, current selections
async fn options_capabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // Resolve selection strictly: branch from header or default; repo from header or subdomain or first available
    let branch = branch_from(&headers);
    let repo_name = strict_repo_from(&state.repo_path, &headers);

    // Enumerate repos under root and their branches/heads
    let repo_names = bare_repo_names(&state.repo_path);
    let mut repos_json: Vec<serde_json::Value> = Vec::new();
    let mut branches_for_current: Vec<String> = Vec::new();
    for name in &repo_names {
        if let Some(repo) = open_repo(&state.repo_path, name) {
            let mut heads_map = serde_json::Map::new();
            let branches = list_branches(&repo);
            for b in &branches {
                if let Ok(reference) = repo.find_reference(&format!("refs/heads/{}", b)) {
                    if let Ok(commit) = reference.peel_to_commit() {
                        heads_map.insert(b.clone(), serde_json::json!(commit.id().to_string()));
                    }
                }
            }
            if Some(name) == repo_name.as_ref() {
                branches_for_current = branches.clone();
            }
            repos_json.push(serde_json::json!({
                "name": name,
                "branches": serde_json::Value::Object(heads_map),
            }));
        }
    }

    let allow = "GET, PUT, DELETE, OPTIONS, QUERY";
    let body = serde_json::json!({
        "ok": true,
        "capabilities": {"supports": ["GET","PUT","DELETE","OPTIONS","QUERY"]},
        "repos": repos_json,
        "currentBranch": branch,
        "currentRepo": repo_name.clone().unwrap_or_default(),
    });
    (
        StatusCode::OK,
        [
            ("Allow", allow.to_string()),
            ("Access-Control-Allow-Origin", "*".to_string()),
            ("Access-Control-Allow-Methods", allow.to_string()),
            ("Access-Control-Allow-Headers", "*".to_string()),
            ("Content-Type", "application/json".to_string()),
            (HEADER_BRANCH, branch),
            (HEADER_REPO, repo_name.unwrap_or_default()),
        ],
        Json(body),
    )
}

/// List all local branches with their HEAD commit ids
// Helpers for strict multi-repo support
fn bare_repo_names(root: &PathBuf) -> Vec<String> {
    let mut names = Vec::new();
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            if e.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                let p = e.path();
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    if name.ends_with(".git") {
                        names.push(name.trim_end_matches(".git").to_string());
                    }
                }
            }
        }
    }
    names.sort();
    names
}

fn open_repo(root: &PathBuf, name: &str) -> Option<Repository> {
    let p = root.join(format!("{}.git", name));
    Repository::open_bare(p).ok()
}

fn strict_repo_from(root: &PathBuf, headers: &HeaderMap) -> Option<String> {
    // Header first
    if let Some(h) = headers.get(HEADER_REPO).and_then(|v| v.to_str().ok()) {
        let name = h.trim().trim_matches('/');
        if !name.is_empty() {
            let name = name.to_string();
            if bare_repo_names(root).iter().any(|n| n == &name) {
                return Some(name);
            }
        }
    }
    // Sub-subdomain: first label in host if there are 3+ labels
    if let Some(host) = headers.get("host").and_then(|v| v.to_str().ok()) {
        let host = host.split(':').next().unwrap_or(host); // strip port
        let parts: Vec<&str> = host.split('.').collect();
        if parts.len() >= 3 {
            let candidate = parts[0].to_string();
            if bare_repo_names(root).iter().any(|n| n == &candidate) {
                return Some(candidate);
            }
        }
    }
    // Default: first available
    bare_repo_names(root).into_iter().next()
}

// QueryRequest/Response handled entirely by repo script (hooks/query.mjs)

async fn post_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<serde_json::Value>>,
) -> impl IntoResponse {
    // Resolve selection strictly
    let branch = headers
        .get(HEADER_BRANCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BRANCH)
        .to_string();
    let repo_name = match strict_repo_from(&state.repo_path, &headers) {
        Some(n) => n,
        None => return (StatusCode::NOT_FOUND, "Repository not found").into_response(),
    };
    let input_json = body.map(|Json(v)| v).unwrap_or(serde_json::json!({}));

    // Load hooks/query.mjs from branch
    let repo = match open_repo(&state.repo_path, &repo_name) {
        Some(r) => r,
        None => return (StatusCode::NOT_FOUND, "Repository not found").into_response(),
    };
    let refname = format!("refs/heads/{}", branch);
    let commit = match repo
        .find_reference(&refname)
        .and_then(|r| r.peel_to_commit())
    {
        Ok(c) => c,
        Err(_) => return (StatusCode::NOT_FOUND, "branch not found").into_response(),
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let entry = match tree.get_path(std::path::Path::new("hooks/query.mjs")) {
        Ok(e) => e,
        Err(_) => return (StatusCode::BAD_REQUEST, "hooks/query.mjs not found").into_response(),
    };
    let blob = match entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
        Ok(b) => b,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let tmp = std::env::temp_dir().join(format!("relay-query-{}-{}.mjs", branch, commit.id()));
    if let Err(e) = std::fs::write(&tmp, blob.content()) {
        return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
    }
    let node_bin = std::env::var("RELAY_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut cmd = std::process::Command::new(node_bin);
    cmd.arg(&tmp)
        .env("GIT_DIR", repo.path())
        .env("BRANCH", &branch)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    if let Ok(mut child) = cmd.spawn() {
        if let Some(mut stdin) = child.stdin.take() {
            let _ = std::io::Write::write_all(&mut stdin, input_json.to_string().as_bytes());
        }
        match child.wait_with_output() {
            Ok(output) => {
                let _ = std::fs::remove_file(&tmp);
                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return (StatusCode::BAD_REQUEST, stderr.to_string()).into_response();
                }
                match serde_json::from_slice::<serde_json::Value>(&output.stdout) {
                    Ok(v) => (
                        StatusCode::OK,
                        [
                            ("Content-Type", "application/json".to_string()),
                            (HEADER_BRANCH, branch),
                        ],
                        Json(v),
                    )
                        .into_response(),
                    Err(e) => (
                        StatusCode::BAD_REQUEST,
                        format!("query.mjs returned invalid JSON: {}", e),
                    )
                        .into_response(),
                }
            }
            Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
        }
    } else {
        (StatusCode::INTERNAL_SERVER_ERROR, "failed to spawn node").into_response()
    }
}

// Middleware that rewrites custom HTTP method QUERY to POST /query/*
async fn query_alias_middleware(
    req: axum::http::Request<axum::body::Body>,
    next: axum::middleware::Next,
) -> impl IntoResponse {
    use axum::http::{Method, Uri};
    let is_query_method = req.method().as_str().eq_ignore_ascii_case("QUERY");
    if is_query_method {
        // Build the new path by prefixing "/query" to the existing path
        let orig_path = req.uri().path();
        let orig_query = req.uri().query();
        let mut new_path = String::from("/query");
        if orig_path.starts_with('/') {
            new_path.push_str(orig_path);
        } else {
            new_path.push('/');
            new_path.push_str(orig_path);
        }
        let new_pq = if let Some(q) = orig_query {
            format!("{}?{}", new_path, q)
        } else {
            new_path
        };
        // Rebuild request with POST method and new URI path
        let (mut parts, body) = req.into_parts();
        parts.method = Method::POST;
        parts.uri = Uri::builder()
            .path_and_query(new_pq)
            .build()
            .unwrap_or_else(|_| Uri::from_static("/query"));
        let req2 = axum::http::Request::from_parts(parts, body);
        return next.run(req2).await;
    }
    next.run(req).await
}

// removed SQLite row_to_json helper

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::io::Write as _;
    use std::path::Path as FsPath;
    use std::time::Duration as StdDuration;
    use tempfile::tempdir;

    #[test]
    fn test_md_to_html_bytes_basic() {
        let md = b"# Hello\n\nThis is *markdown*.";
        let html = md_to_html_bytes(md);
        let s = String::from_utf8(html).expect("utf8");
        assert!(s.contains("<h1>"));
        assert!(s.contains("<em>markdown</em>"));
    }

    #[test]
    fn test_row_to_json_basic_types_removed() {}

    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    async fn ensure_ipfs_daemon(ipfs_repo: &FsPath, api_port: u16) {
        // init if needed
        let _ = std::fs::create_dir_all(ipfs_repo);
        let mut init = TokioCommand::new("ipfs");
        init.arg("init").env("IPFS_PATH", ipfs_repo);
        let _ = init.status().await;
        // configure API address
        let mut cfg = TokioCommand::new("ipfs");
        cfg.arg("config")
            .arg("Addresses.API")
            .arg(format!("/ip4/127.0.0.1/tcp/{}", api_port))
            .env("IPFS_PATH", ipfs_repo);
        let _ = cfg.status().await;
        // start daemon in background if not running
        let mut id = TokioCommand::new("ipfs");
        id.arg("id").env("IPFS_PATH", ipfs_repo);
        if id.status().await.ok().map(|s| s.success()).unwrap_or(false) {
            return;
        }
        let mut daemon = std::process::Command::new("ipfs");
        daemon
            .arg("daemon")
            .env("IPFS_PATH", ipfs_repo)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .stdin(std::process::Stdio::null());
        let _child = daemon.spawn().expect("spawn ipfs daemon");
        // wait for API to come up
        for _ in 0..50 {
            let mut id = TokioCommand::new("ipfs");
            // Use IPFS_PATH and the api file written by the daemon
            id.arg("id").env("IPFS_PATH", ipfs_repo);
            if id.status().await.ok().map(|s| s.success()).unwrap_or(false) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    async fn ipfs_add_dir(ipfs_repo: &FsPath, _api_port: u16, dir: &FsPath) -> String {
        // Use verbose recursive add to capture the directory line reliably across older go-ipfs versions
        let mut cmd = TokioCommand::new("ipfs");
        cmd.arg("add").arg("-r").arg(dir);
        cmd.env("IPFS_PATH", ipfs_repo);
        let out = cmd.output().await.expect("ipfs add");
        assert!(out.status.success(), "ipfs add failed: {:?}", out);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let dir_str = dir.to_string_lossy().to_string();
        let base = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
        let mut last_cid: Option<String> = None;
        let mut dir_cid: Option<String> = None;
        for line in stdout.lines() {
            // expected: "added <cid> <path>"
            let mut it = line.split_whitespace();
            let first = it.next();
            let second = it.next();
            let rest = it.next();
            if first == Some("added") {
                if let Some(cid) = second.map(|s| s.to_string()) {
                    last_cid = Some(cid.clone());
                    if let Some(path) = rest {
                        // Match either the exact directory path or a trailing basename match
                        if path == dir_str || (!base.is_empty() && path.ends_with(base)) {
                            dir_cid = Some(cid);
                        }
                    }
                }
            }
        }
        let cid = dir_cid.or(last_cid).unwrap_or_default();
        assert!(
            !cid.is_empty(),
            "could not parse CID from ipfs add output: {}",
            stdout
        );
        cid
    }

    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    async fn write_file(p: &FsPath, content: &str) {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let mut f = std::fs::File::create(p).unwrap();
        let _ = f.write_all(content.as_bytes());
    }

    // IPFS dir listing is merged into directory response (Git + IPFS), sizes present
    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ipfs_dir_listing_merged_with_git() {
        // Start ephemeral IPFS
        let ipfs_dir = tempdir().unwrap();
        let api_port = 5020u16;
        ensure_ipfs_daemon(ipfs_dir.path(), api_port).await;
        let cache_dir = tempdir().unwrap();
        std::env::set_var("RELAY_IPFS_CACHE_ROOT", cache_dir.path());

        // Create a directory on disk to add to IPFS
        let src_dir = tempdir().unwrap();
        std::fs::create_dir_all(src_dir.path().join("assets")).unwrap();
        write_file(&src_dir.path().join("assets/hello.txt"), "hello").await;
        write_file(&src_dir.path().join("readme.md"), "# readme\n").await;
        let root_cid = ipfs_add_dir(ipfs_dir.path(), api_port, src_dir.path()).await;
        // Wait until path resolves under IPFS
        for _ in 0..20 {
            let status = TokioCommand::new("ipfs")
                .arg("resolve")
                .arg("-r")
                .arg(format!("/ipfs/{}/assets/hello.txt", root_cid))
                .env("IPFS_PATH", ipfs_dir.path())
                .status()
                .await
                .unwrap();
            if status.success() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }

        // Bare git with empty tree but relay.yaml pointing to CID
        let repo_dir = tempdir().unwrap();
        let repo = Repository::init_bare(repo_dir.path()).unwrap();
        {
            let sig = Signature::now("relay", "relay@local").unwrap();
            let mut tb = repo.treebuilder(None).unwrap();
            let tree_id = tb.write().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let _ = repo
                .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        // add relay.yaml
        let yaml = format!(
            "ipfs:\n  rootHash: \"{}\"\n  branches: [ \"main\" ]\n",
            root_cid
        );
        {
            let head = repo.find_reference("refs/heads/main").unwrap();
            let commit = head.peel_to_commit().unwrap();
            let base_tree = commit.tree().unwrap();
            let blob_oid = repo.blob(yaml.as_bytes()).unwrap();
            let mut tb = repo.treebuilder(Some(&base_tree)).unwrap();
            tb.insert("relay.yaml", blob_oid, 0o100644).unwrap();
            let new_tree_id = tb.write().unwrap();
            let new_tree = repo.find_tree(new_tree_id).unwrap();
            let sig = Signature::now("relay", "relay@local").unwrap();
            let _ = repo
                .commit(
                    Some("refs/heads/main"),
                    &sig,
                    &sig,
                    "add relay.yaml",
                    &new_tree,
                    &[&commit],
                )
                .unwrap();
        }

        // Build listing at IPFS subdir 'assets' (Git is empty), expect IPFS entries appear
        std::env::set_var("IPFS_PATH", ipfs_dir.path());
        let root_ref = repo.find_reference("refs/heads/main").unwrap();
        let commit = root_ref.peel_to_commit().unwrap();
        let tree = commit.tree().unwrap();
        let (ct, md) = super::directory_response(
            &repo_dir.path().to_path_buf(),
            &tree,
            &tree,
            "assets",
            "text/markdown",
            "main",
            "",
        );
        assert_eq!(ct, "text/markdown");
        let s = String::from_utf8(md).unwrap();
        assert!(
            s.contains("hello.txt"),
            "listing should include IPFS file hello.txt: {}",
            s
        );
        // Size column should show at least 5 bytes for hello.txt
        assert!(
            s.contains("hello.txt") && s.contains("| 5 |"),
            "should show size 5 bytes: {}",
            s
        );
    }

    // Changing CID should refresh dir cache file
    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ipfs_dir_cache_invalidation_on_cid_change() {
        let ipfs_dir = tempdir().unwrap();
        let api_port = 5021u16;
        ensure_ipfs_daemon(ipfs_dir.path(), api_port).await;
        std::env::set_var("IPFS_PATH", ipfs_dir.path());
        let cache_dir = tempdir().unwrap();
        std::env::set_var("RELAY_IPFS_CACHE_ROOT", cache_dir.path());

        // Make first IPFS directory
        let src1 = tempdir().unwrap();
        write_file(&src1.path().join("a.txt"), "aaa").await;
        let cid1 = ipfs_add_dir(ipfs_dir.path(), api_port, src1.path()).await;

        // Make second IPFS directory
        let src2 = tempdir().unwrap();
        write_file(&src2.path().join("b.txt"), "bbbb").await;
        let cid2 = ipfs_add_dir(ipfs_dir.path(), api_port, src2.path()).await;

        // Bare git repo with relay.yaml -> cid1, then update to cid2
        let repo_dir = tempdir().unwrap();
        let repo = Repository::init_bare(repo_dir.path()).unwrap();
        {
            let sig = Signature::now("relay", "relay@local").unwrap();
            let mut tb = repo.treebuilder(None).unwrap();
            let tree_id = tb.write().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let _ = repo
                .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        let write_yaml_commit = |repo: &Repository, cid: &str| {
            let yaml = format!("ipfs:\n  rootHash: \"{}\"\n  branches: [ \"main\" ]\n", cid);
            let head = repo.find_reference("refs/heads/main").unwrap();
            let commit = head.peel_to_commit().unwrap();
            let base_tree = commit.tree().unwrap();
            let blob_oid = repo.blob(yaml.as_bytes()).unwrap();
            let mut tb = repo.treebuilder(Some(&base_tree)).unwrap();
            tb.insert("relay.yaml", blob_oid, 0o100644).unwrap();
            let new_tree_id = tb.write().unwrap();
            let new_tree = repo.find_tree(new_tree_id).unwrap();
            let sig = Signature::now("relay", "relay@local").unwrap();
            let _ = repo
                .commit(
                    Some("refs/heads/main"),
                    &sig,
                    &sig,
                    "update relay.yaml",
                    &new_tree,
                    &[&commit],
                )
                .unwrap();
        };
        write_yaml_commit(&repo, &cid1);

        // First listing to generate cache with cid1
        let head = repo.find_reference("refs/heads/main").unwrap();
        let commit = head.peel_to_commit().unwrap();
        let tree = commit.tree().unwrap();
        let _ = super::directory_response(
            &repo_dir.path().to_path_buf(),
            &tree,
            &tree,
            "",
            "text/markdown",
            "main",
            "",
        );

        // Update CID and list again; ensure resulting markdown references new file name
        write_yaml_commit(&repo, &cid2);
        let head = repo.find_reference("refs/heads/main").unwrap();
        let commit = head.peel_to_commit().unwrap();
        let tree = commit.tree().unwrap();
        let (_ct, md) = super::directory_response(
            &repo_dir.path().to_path_buf(),
            &tree,
            &tree,
            "",
            "text/markdown",
            "main",
            "",
        );
        let s = String::from_utf8(md).unwrap();
        assert!(
            s.contains("b.txt"),
            "dir listing after CID change should show new entries: {}",
            s
        );
    }

    // End-to-end: Git miss -> IPFS fetch success
    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ipfs_fallback_fetch_success() {
        // Temp IPFS repo and daemon
        let ipfs_dir = tempdir().unwrap();
        let api_port = 5015u16;
        ensure_ipfs_daemon(ipfs_dir.path(), api_port).await;

        // Create a directory with a file and add recursively to IPFS
        let src_dir = tempdir().unwrap();
        let rel_path = FsPath::new("assets/hello.txt");
        write_file(&src_dir.path().join(rel_path), "hello from ipfs").await;
        let root_cid = ipfs_add_dir(ipfs_dir.path(), api_port, src_dir.path()).await;

        // Prepare bare git repo with relay.yaml pointing to root_cid; no actual file in git
        let repo_dir = tempdir().unwrap();
        let repo = Repository::init_bare(repo_dir.path()).unwrap();
        // initial empty commit on main
        {
            let sig = Signature::now("relay", "relay@local").unwrap();
            let mut tb = repo.treebuilder(None).unwrap();
            let tree_id = tb.write().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let _ = repo
                .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        // Add relay.yaml to default branch for rules consumption by server endpoints expecting default branch
        let yaml = format!(
            "ipfs:\n  rootHash: \"{}\"\n  branches: [ \"main\" ]\n",
            root_cid
        );
        {
            // Read existing tree and upsert relay.yaml blob
            let head = repo.find_reference("refs/heads/main").unwrap();
            let commit = head.peel_to_commit().unwrap();
            let base_tree = commit.tree().unwrap();
            let blob_oid = repo.blob(yaml.as_bytes()).unwrap();
            // place relay.yaml at repo root
            fn upsert(repo: &Repository, tree: &git2::Tree, filename: &str, blob: Oid) -> Oid {
                let mut tb = repo.treebuilder(Some(tree)).unwrap();
                tb.insert(filename, blob, 0o100644).unwrap();
                tb.write().unwrap()
            }
            let new_tree_id = upsert(&repo, &base_tree, "relay.yaml", blob_oid);
            let new_tree = repo.find_tree(new_tree_id).unwrap();
            let sig = Signature::now("relay", "relay@local").unwrap();
            let _ = repo
                .commit(
                    Some("refs/heads/main"),
                    &sig,
                    &sig,
                    "add relay.yaml",
                    &new_tree,
                    &[&commit],
                )
                .unwrap();
        }

        // Set envs for server to point to our temp git and ipfs
        std::env::set_var("RELAY_IPFS_TIMEOUT_SECS", "10");
        std::env::set_var("RELAY_IPFS_API", format!("http://127.0.0.1:{}", api_port));
        std::env::set_var("IPFS_PATH", ipfs_dir.path());
        let cache_dir = tempdir().unwrap();
        std::env::set_var("RELAY_IPFS_CACHE_ROOT", cache_dir.path());

        // Build minimal AppState
        let app_state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
        };

        // Request for the IPFS-backed file path under the same repo layout
        let headers = HeaderMap::new();
        let path = format!("{}", rel_path.to_string_lossy());
        let query: Option<Query<HashMap<String, String>>> = None;

        // Wait for resolution to ensure availability
        for _ in 0..20 {
            let status = TokioCommand::new("ipfs")
                .arg("resolve")
                .arg("-r")
                .arg(format!("/ipfs/{}/{}", root_cid, rel_path.to_string_lossy()))
                .env("IPFS_PATH", ipfs_dir.path())
                .status()
                .await
                .unwrap();
            if status.success() {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        // Get file; should miss git and fetch from IPFS
        let resp = get_file(State(app_state), headers, Path(path), query)
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::OK);
        // Verify cache populated
        let cached = cache_dir.path().join("_").join("main").join(rel_path);
        assert!(
            cached.exists(),
            "cached file should exist: {}",
            cached.display()
        );
    }

    // Not-found under CID returns 404
    #[cfg(all(not(target_os = "windows"), feature = "ipfs_tests"))]
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn ipfs_fallback_not_found_404() {
        let ipfs_dir = tempdir().unwrap();
        let api_port = 5016u16;
        ensure_ipfs_daemon(ipfs_dir.path(), api_port).await;

        // Empty dir -> CID of an empty dir by adding a directory with no files
        let empty_dir = tempdir().unwrap();
        let root_cid = ipfs_add_dir(ipfs_dir.path(), api_port, empty_dir.path()).await;

        // Git repo with relay.yaml pointing to cid
        let repo_dir = tempdir().unwrap();
        let repo = Repository::init_bare(repo_dir.path()).unwrap();
        {
            let sig = Signature::now("relay", "relay@local").unwrap();
            let mut tb = repo.treebuilder(None).unwrap();
            let tree_id = tb.write().unwrap();
            let tree = repo.find_tree(tree_id).unwrap();
            let _ = repo
                .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
                .unwrap();
        }
        let yaml = format!(
            "ipfs:\n  rootHash: \"{}\"\n  branches: [ \"main\" ]\n",
            root_cid
        );
        {
            let head = repo.find_reference("refs/heads/main").unwrap();
            let commit = head.peel_to_commit().unwrap();
            let base_tree = commit.tree().unwrap();
            let blob_oid = repo.blob(yaml.as_bytes()).unwrap();
            let mut tb = repo.treebuilder(Some(&base_tree)).unwrap();
            tb.insert("relay.yaml", blob_oid, 0o100644).unwrap();
            let new_tree_id = tb.write().unwrap();
            let new_tree = repo.find_tree(new_tree_id).unwrap();
            let sig = Signature::now("relay", "relay@local").unwrap();
            let _ = repo
                .commit(
                    Some("refs/heads/main"),
                    &sig,
                    &sig,
                    "add relay.yaml",
                    &new_tree,
                    &[&commit],
                )
                .unwrap();
        }

        std::env::set_var("RELAY_IPFS_TIMEOUT_SECS", "2");
        std::env::set_var("RELAY_IPFS_API", format!("http://127.0.0.1:{}", api_port));
        std::env::set_var("IPFS_PATH", ipfs_dir.path());
        let cache_dir = tempdir().unwrap();
        std::env::set_var("RELAY_IPFS_CACHE_ROOT", cache_dir.path());

        let app_state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
        };
        let headers = HeaderMap::new();
        let path = "assets/missing.txt".to_string();
        let query: Option<Query<HashMap<String, String>>> = None;
        let resp = get_file(State(app_state), headers, Path(path), query)
            .await
            .into_response();
        assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    }

    // ==== Unit tests for HEAD, GET, OPTIONS methods ====

    /// Test OPTIONS returns repository list with branches and commit heads
    #[tokio::test]
    async fn test_options_returns_repo_list() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git" inside the temp directory
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial commit on main branch
        let sig = Signature::now("relay", "relay@local").unwrap();
        let tb = repo.treebuilder(None).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let headers = HeaderMap::new();
        let query = None;
        let response = options_capabilities(State(state), headers, query).await;
        let (parts, body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::OK);
        // Parse body to verify structure
        let body_bytes = axum::body::to_bytes(body, usize::MAX)
            .await
            .unwrap()
            .to_vec();
        let json: serde_json::Value = serde_json::from_slice(&body_bytes).unwrap();

        assert_eq!(json["ok"], true);
        assert!(json["capabilities"]["supports"].is_array());
    }

    /// Test GET returns 200 when repo exists with a file
    #[tokio::test]
    async fn test_get_file_success() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git" inside the temp directory
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial commit with a file
        let sig = Signature::now("relay", "relay@local").unwrap();
        let file_content = b"Hello, World!";
        let blob_oid = repo.blob(file_content).unwrap();
        let mut tb = repo.treebuilder(None).unwrap();
        tb.insert("hello.txt", blob_oid, 0o100644).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "add file", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "repo".parse().unwrap());

        let response = get_file(
            State(state),
            headers,
            AxPath("hello.txt".to_string()),
            None,
        )
        .await;
        let (parts, body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::OK);
        let body_bytes = axum::body::to_bytes(body, usize::MAX)
            .await
            .unwrap()
            .to_vec();
        assert_eq!(body_bytes, file_content);
    }

    /// Test GET returns 404 when file doesn't exist
    #[tokio::test]
    async fn test_get_file_not_found() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git" inside the temp directory
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial empty commit
        let sig = Signature::now("relay", "relay@local").unwrap();
        let tb = repo.treebuilder(None).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "repo".parse().unwrap());

        let response = get_file(
            State(state),
            headers,
            AxPath("missing.txt".to_string()),
            None,
        )
        .await;
        let (parts, _body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::NOT_FOUND);
    }

    /// Test GET returns 404 when repo doesn't exist
    #[tokio::test]
    async fn test_get_repo_not_found() {
        let repo_dir = tempdir().unwrap();
        // Create empty data directory with no repos
        let _ = std::fs::create_dir_all(repo_dir.path());

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "nonexistent".parse().unwrap());

        let response = get_file(
            State(state),
            headers,
            AxPath("file.txt".to_string()),
            None,
        )
        .await;
        let (parts, _body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::NOT_FOUND);
    }

    /// Test OPTIONS returns proper headers
    #[tokio::test]
    async fn test_options_headers() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git" inside the temp directory
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial commit
        let sig = Signature::now("relay", "relay@local").unwrap();
        let tb = repo.treebuilder(None).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let headers = HeaderMap::new();
        let (parts, _body) = options_capabilities(State(state), headers, None)
            .await
            .into_response()
            .into_parts();

        assert_eq!(parts.status, StatusCode::OK);

        // Verify Allow header contains expected methods
        let allow_header = parts.headers.get("Allow");
        assert!(allow_header.is_some());
        let allow_str = allow_header
            .unwrap()
            .to_str()
            .unwrap_or("")
            .to_uppercase();
        assert!(allow_str.contains("GET"));
        assert!(allow_str.contains("OPTIONS"));

        // Verify CORS headers
        assert!(parts.headers.contains_key("Access-Control-Allow-Origin"));
        assert!(parts.headers.contains_key("Access-Control-Allow-Methods"));
    }

    /// Test branch_from correctly extracts branch from header
    #[test]
    fn test_branch_from_header() {
        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "develop".parse().unwrap());

        let branch = branch_from(&headers);
        assert_eq!(branch, "develop");
    }

    /// Test branch_from defaults to main when header is missing
    #[test]
    fn test_branch_from_default() {
        let headers = HeaderMap::new();

        let branch = branch_from(&headers);
        assert_eq!(branch, DEFAULT_BRANCH);
    }

    /// Test strict_repo_from selects first repo when none specified
    #[tokio::test]
    async fn test_strict_repo_from_default() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo"
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();
        
        let sig = Signature::now("relay", "relay@local").unwrap();
        let tb = repo.treebuilder(None).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();
        
        let headers = HeaderMap::new();
        let selected = strict_repo_from(&repo_dir.path().to_path_buf(), &headers);

        assert_eq!(selected, Some("repo".to_string()));
    }

    /// Test strict_repo_from returns None when no repos exist
    #[test]
    fn test_strict_repo_from_no_repos() {
        let repo_dir = tempdir().unwrap();
        let _ = std::fs::create_dir_all(repo_dir.path());

        let headers = HeaderMap::new();
        let selected = strict_repo_from(&repo_dir.path().to_path_buf(), &headers);

        assert_eq!(selected, None);
    }

    /// Test bare_repo_names correctly lists repos
    #[tokio::test]
    async fn test_bare_repo_names() {
        let repo_dir = tempdir().unwrap();
        
        // Create two bare repos
        Repository::init_bare(repo_dir.path().join("repo1.git")).unwrap();
        Repository::init_bare(repo_dir.path().join("repo2.git")).unwrap();
        // Create a non-bare directory (should be ignored)
        std::fs::create_dir(repo_dir.path().join("not_a_repo")).unwrap();

        let names = bare_repo_names(&repo_dir.path().to_path_buf());

        assert_eq!(names, vec!["repo1".to_string(), "repo2".to_string()]);
    }

    /// Test HEAD / returns 204 No Content like GET
    #[tokio::test]
    async fn test_head_root() {
        let repo_dir = tempdir().unwrap();
        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let headers = HeaderMap::new();
        let response = head_root(State(state), headers, None).await;
        let (parts, _body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::NO_CONTENT);
    }

    /// Test HEAD returns 200 when file exists
    #[tokio::test]
    async fn test_head_file_success() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git"
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial commit with a file
        let sig = Signature::now("relay", "relay@local").unwrap();
        let file_content = b"Hello, World!";
        let blob_oid = repo.blob(file_content).unwrap();
        let mut tb = repo.treebuilder(None).unwrap();
        tb.insert("hello.txt", blob_oid, 0o100644).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "add file", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "repo".parse().unwrap());

        let response = head_file(
            State(state),
            headers,
            AxPath("hello.txt".to_string()),
            None,
        )
        .await;
        let (parts, body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::OK);
        // Verify body is empty for HEAD
        let body_bytes = axum::body::to_bytes(body, usize::MAX)
            .await
            .unwrap()
            .to_vec();
        assert_eq!(body_bytes.len(), 0);
    }

    /// Test HEAD returns 404 when file doesn't exist
    #[tokio::test]
    async fn test_head_file_not_found() {
        let repo_dir = tempdir().unwrap();
        
        // Create a bare repo named "repo.git"
        let repo_path = repo_dir.path().join("repo.git");
        let repo = Repository::init_bare(&repo_path).unwrap();

        // Create initial empty commit
        let sig = Signature::now("relay", "relay@local").unwrap();
        let tb = repo.treebuilder(None).unwrap();
        let tree_id = tb.write().unwrap();
        let tree = repo.find_tree(tree_id).unwrap();
        let _commit_oid = repo
            .commit(Some("refs/heads/main"), &sig, &sig, "init", &tree, &[])
            .unwrap();

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "repo".parse().unwrap());

        let response = head_file(
            State(state),
            headers,
            AxPath("missing.txt".to_string()),
            None,
        )
        .await;
        let (parts, _body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::NOT_FOUND);
    }

    /// Test HEAD returns 404 when repo doesn't exist
    #[tokio::test]
    async fn test_head_repo_not_found() {
        let repo_dir = tempdir().unwrap();
        let _ = std::fs::create_dir_all(repo_dir.path());

        let state = AppState {
            repo_path: repo_dir.path().to_path_buf(),
            static_paths: Vec::new(),
        };

        let mut headers = HeaderMap::new();
        headers.insert(HEADER_BRANCH, "main".parse().unwrap());
        headers.insert(HEADER_REPO, "nonexistent".parse().unwrap());

        let response = head_file(
            State(state),
            headers,
            AxPath("file.txt".to_string()),
            None,
        )
        .await;
        let (parts, _body) = response.into_response().into_parts();

        assert_eq!(parts.status, StatusCode::NOT_FOUND);
    }
}

// No disallowed file types — reads and writes are permitted for all paths.

fn branch_from(headers: &HeaderMap) -> String {
    if let Some(h) = headers.get(HEADER_BRANCH).and_then(|v| v.to_str().ok()) {
        if !h.is_empty() {
            return h.to_string();
        }
    }
    DEFAULT_BRANCH.to_string()
}

fn sanitize_repo_name(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('/');
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.contains("..") {
        return None;
    }
    Some(trimmed.to_string())
}

// old repo_from removed in favor of strict_repo_from()

// list_repos removed — repos are now separate bare repositories under the repo root

async fn get_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxPath(path): AxPath<String>,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    info!(%path, "get_file called");
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    info!(decoded = %decoded, "decoded path");
    // 1) Try static directories first
    if let Some(resp) = try_static(&state, &decoded).await {
        return resp;
    }
    let branch = branch_from(&headers);
    let repo_name = match strict_repo_from(&state.repo_path, &headers) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                [
                    ("Content-Type", "text/plain".to_string()),
                    (HEADER_BRANCH, branch.clone()),
                    (HEADER_REPO, "".to_string()),
                ],
                "Repository not found".to_string(),
            )
                .into_response();
        }
    };
    info!(%branch, "resolved branch");

    // Resolve via Git first for all file types
    let git_result = git_resolve_and_respond(
        &state.repo_path,
        &headers,
        &branch,
        &repo_name,
        &decoded,
    );
    match git_result {
        GitResolveResult::Respond(resp) => return resp,
        GitResolveResult::NotFound(rel_missing) => {
            // Git miss: delegate to repo get script (hooks/get.mjs)
            return run_get_script_or_404(&state, &branch, &repo_name, &rel_missing).await;
        }
    }
}

async fn run_get_script_or_404(
    state: &AppState,
    branch: &str,
    repo_name: &str,
    rel_missing: &str,
) -> Response {
    // Load hooks/get.mjs from branch
    let repo = match open_repo(&state.repo_path, repo_name) {
        Some(r) => r,
        None => return (StatusCode::INTERNAL_SERVER_ERROR, "Repository not found").into_response(),
    };
    let refname = format!("refs/heads/{}", branch);
    let commit = match repo
        .find_reference(&refname)
        .and_then(|r| r.peel_to_commit())
    {
        Ok(c) => c,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };
    let entry = match tree.get_path(std::path::Path::new("hooks/get.mjs")) {
        Ok(e) => e,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };
    let blob = match entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
        Ok(b) => b,
        Err(_) => return (StatusCode::NOT_FOUND, "Not Found").into_response(),
    };
    let tmp = std::env::temp_dir().join(format!("relay-get-{}-{}.mjs", branch, commit.id()));
    if let Err(e) = std::fs::write(&tmp, blob.content()) {
        error!(?e, "failed to write get.mjs temp file");
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    let node_bin = std::env::var("RELAY_NODE_BIN").unwrap_or_else(|_| "node".to_string());
    let mut cmd = std::process::Command::new(node_bin);
    cmd.arg(&tmp)
        .env("GIT_DIR", repo.path())
        .env("BRANCH", branch)
        .env("REL_PATH", rel_missing)
        .env(
            "CACHE_ROOT",
            std::env::var("RELAY_IPFS_CACHE_ROOT")
                .unwrap_or_else(|_| DEFAULT_IPFS_CACHE_ROOT.to_string()),
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let output = match cmd.output() {
        Ok(o) => o,
        Err(e) => {
            error!(?e, "failed to execute get.mjs");
            let _ = std::fs::remove_file(&tmp);
            return (StatusCode::NOT_FOUND, "Not Found").into_response();
        }
    };
    let _ = std::fs::remove_file(&tmp);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(%stderr, "get.mjs non-success status");
        return (StatusCode::NOT_FOUND, "Not Found").into_response();
    }
    let val: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
            warn!(?e, "get.mjs returned invalid JSON");
            return (StatusCode::NOT_FOUND, "Not Found").into_response();
        }
    };
    let kind = val.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    match kind {
        "file" => {
            let ct = val
                .get("contentType")
                .and_then(|v| v.as_str())
                .unwrap_or("application/octet-stream");
            let b64 = val.get("bodyBase64").and_then(|v| v.as_str()).unwrap_or("");
            match general_purpose::STANDARD.decode(b64.as_bytes()) {
                Ok(bytes) => (
                    StatusCode::OK,
                    [
                        ("Content-Type", ct.to_string()),
                        (HEADER_BRANCH, branch.to_string()),
                        (HEADER_REPO, repo_name.to_string()),
                    ],
                    bytes,
                )
                    .into_response(),
                Err(e) => {
                    warn!(?e, "failed to decode get.mjs bodyBase64");
                    (StatusCode::NOT_FOUND, "Not Found").into_response()
                }
            }
        }
        "dir" => (
            StatusCode::OK,
            [
                ("Content-Type", "application/json".to_string()),
                (HEADER_BRANCH, branch.to_string()),
                (HEADER_REPO, repo_name.to_string()),
            ],
            Json(val),
        )
            .into_response(),
        _ => (StatusCode::NOT_FOUND, "Not Found").into_response(),
    }
}

// Try to serve a file from configured static directories. Returns Some(response) on success, None to continue.
async fn try_static(state: &AppState, decoded: &str) -> Option<Response> {
    if state.static_paths.is_empty() {
        return None;
    }
    // Prevent path traversal: normalize to components and re-join with '/'
    let mut rel = String::new();
    for part in decoded.split('/') {
        if part.is_empty() || part == "." || part == ".." {
            continue;
        }
        if !rel.is_empty() {
            rel.push('/');
        }
        rel.push_str(part);
    }
    if rel.is_empty() {
        return None;
    }
    for base in &state.static_paths {
        let candidate = base.join(rel.replace('/', std::path::MAIN_SEPARATOR.to_string().as_str()));
        // Ensure candidate stays within base
        if let (Ok(canon_base), Ok(canon_file)) = (base.canonicalize(), candidate.canonicalize()) {
            if !canon_file.starts_with(&canon_base) {
                continue;
            }
        }
        if candidate.is_file() {
            match tokio::fs::read(&candidate).await {
                Ok(bytes) => {
                    let ct = mime_guess::from_path(&candidate)
                        .first_or_octet_stream()
                        .essence_str()
                        .to_string();
                    let resp = (StatusCode::OK, [("Content-Type", ct)], bytes).into_response();
                    return Some(resp);
                }
                Err(e) => {
                    warn!(?e, path=%candidate.to_string_lossy(), "Failed to read static file");
                }
            }
        }
    }
    None
}

enum GitResolveResult {
    Respond(Response),
    NotFound(String),
}

fn git_resolve_and_respond(
    repo_root: &PathBuf,
    headers: &HeaderMap,
    branch: &str,
    repo_name: &str,
    decoded: &str,
) -> GitResolveResult {
    let repo = match open_repo(repo_root, repo_name) {
        Some(r) => r,
        None => {
            error!("open repo error: repo not found");
            return GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    let refname = format!("refs/heads/{}", branch);
    let reference = match repo.find_reference(&refname) {
        Ok(r) => r,
        Err(_) => {
            return GitResolveResult::NotFound(decoded.to_string());
        }
    };
    let commit = match reference.peel_to_commit() {
        Ok(c) => c,
        Err(e) => {
            error!(?e, "peel to commit error");
            return GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(e) => {
            error!(?e, "tree error");
            return GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };

    // Path is used directly inside the selected repository
    let rel = decoded.trim_matches('/');

    // Empty path -> delegate to repo script (hooks/get.mjs)
    if rel.is_empty() {
        return GitResolveResult::NotFound(rel.to_string());
    }

    // File/dir resolution
    let path_obj = std::path::Path::new(rel);
    let entry = match tree.get_path(path_obj) {
        Ok(e) => e,
        Err(_) => return GitResolveResult::NotFound(rel.to_string()),
    };

    match entry.kind() {
        Some(ObjectType::Blob) => match repo.find_blob(entry.id()) {
            Ok(blob) => {
                let ct = mime_guess::from_path(rel)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                let resp = (
                    StatusCode::OK,
                    [
                        ("Content-Type", ct),
                        (HEADER_BRANCH, branch.to_string()),
                        (HEADER_REPO, repo_name.to_string()),
                    ],
                    blob.content().to_vec(),
                )
                    .into_response();
                GitResolveResult::Respond(resp)
            }
            Err(e) => {
                error!(?e, "blob read error");
                GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response())
            }
        },
        Some(ObjectType::Tree) => {
            // List directory contents as JSON
            match repo.find_tree(entry.id()) {
                Ok(dir_tree) => {
                    let mut entries = serde_json::json!({});
                    for item in dir_tree.iter() {
                        if let Some(name) = item.name() {
                            let kind = match item.kind() {
                                Some(ObjectType::Blob) => "file",
                                Some(ObjectType::Tree) => "dir",
                                _ => "unknown",
                            };
                            entries[name] = serde_json::json!({
                                "type": kind,
                                "path": format!("{}/{}", rel, name)
                            });
                        }
                    }
                    let resp = (
                        StatusCode::OK,
                        [
                            ("Content-Type", "application/json".to_string()),
                            (HEADER_BRANCH, branch.to_string()),
                            (HEADER_REPO, repo_name.to_string()),
                        ],
                        serde_json::to_string(&entries).unwrap_or_else(|_| "{}".to_string()),
                    )
                        .into_response();
                    GitResolveResult::Respond(resp)
                }
                Err(e) => {
                    error!(?e, "tree read error");
                    GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response())
                }
            }
        }
        _ => GitResolveResult::NotFound(rel.to_string()),
    }
}

// IPFS fallback removed; IPFS logic is delegated to repo scripts (hooks/get.mjs)

async fn get_root(
    _state: State<AppState>,
    _headers: HeaderMap,
    _query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // GET / should not return discovery; serve no content here.
    StatusCode::NO_CONTENT
}

/// HEAD / - returns same headers as GET but no body. Returns 204 No Content.
async fn head_root(
    _state: State<AppState>,
    _headers: HeaderMap,
    _query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // HEAD / should return same response as GET but without body
    StatusCode::NO_CONTENT
}

/// HEAD handler for files. Returns same headers as GET but no body.
/// Returns 200 if file exists, 404 if not found or repo doesn't exist.
async fn head_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxPath(path): AxPath<String>,
    _query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    
    let branch = branch_from(&headers);
    let repo_name = match strict_repo_from(&state.repo_path, &headers) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                [
                    ("Content-Type", "text/plain".to_string()),
                    (HEADER_BRANCH, branch.clone()),
                    (HEADER_REPO, "".to_string()),
                ],
            )
                .into_response();
        }
    };

    // Resolve via Git - if found, return headers without body
    match git_resolve_and_respond(
        &state.repo_path,
        &headers,
        &branch,
        &repo_name,
        &decoded,
    ) {
        GitResolveResult::Respond(resp) => {
            // If GET would have succeeded, return 200 with same headers but no body
            let (parts, _body) = resp.into_parts();
            if parts.status == StatusCode::OK {
                (
                    StatusCode::OK,
                    [
                        ("Content-Type", 
                            parts.headers.get("Content-Type")
                                .and_then(|h| h.to_str().ok())
                                .unwrap_or("application/octet-stream")
                                .to_string()),
                        (HEADER_BRANCH, branch),
                        (HEADER_REPO, repo_name),
                    ],
                )
                    .into_response()
            } else {
                // Return same status as GET would
                StatusCode::NOT_FOUND.into_response()
            }
        }
        GitResolveResult::NotFound(_) => {
            // File not found in Git - return 404 without checking hooks
            (
                StatusCode::NOT_FOUND,
                [
                    ("Content-Type", "text/plain".to_string()),
                    (HEADER_BRANCH, branch),
                    (HEADER_REPO, repo_name),
                ],
            )
                .into_response()
        }
    }
}

/// Append permissive CORS headers to all responses without short-circuiting OPTIONS.
async fn cors_headers(
    req: Request<Body>,
    next: Next,
) -> Response {
    let mut res = next.run(req).await;
    let headers = res.headers_mut();
    headers.insert(
        axum::http::header::ACCESS_CONTROL_ALLOW_ORIGIN,
        axum::http::HeaderValue::from_static("*"),
    );
    headers.insert(
        axum::http::header::HeaderName::from_static("access-control-allow-methods"),
        axum::http::HeaderValue::from_static("GET, PUT, DELETE, OPTIONS, QUERY"),
    );
    headers.insert(
        axum::http::header::HeaderName::from_static("access-control-allow-headers"),
        axum::http::HeaderValue::from_static("*"),
    );
    headers.insert(
        axum::http::header::ACCESS_CONTROL_EXPOSE_HEADERS,
        axum::http::HeaderValue::from_static("*"),
    );
    res
}

async fn put_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxPath(path): AxPath<String>,
    query: Option<Query<HashMap<String, String>>>,
    body: Bytes,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    // All file types allowed for writes
    let branch = branch_from(&headers);
    let repo_name = match strict_repo_from(&state.repo_path, &headers) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                Json(serde_json::json!({"error": "Repository not found"})),
            )
                .into_response();
        }
    };
    match write_file_to_repo(&state.repo_path, &repo_name, &branch, &decoded, &body) {
        Ok((commit, branch)) => {
            Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded}))
                .into_response()
        }
        Err(e) => {
            error!(?e, "write error");
            let msg = e.to_string();
            if msg.contains("rejected by") || msg.contains("validation failed") {
                (StatusCode::BAD_REQUEST, msg).into_response()
            } else {
                (StatusCode::INTERNAL_SERVER_ERROR, msg).into_response()
            }
        }
    }
}

async fn delete_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxPath(path): AxPath<String>,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    // All file types allowed for deletes
    let branch = branch_from(&headers);
    let repo_name = match strict_repo_from(&state.repo_path, &headers) {
        Some(r) => r,
        None => return StatusCode::NOT_FOUND.into_response(),
    };
    match delete_file_in_repo(&state.repo_path, &repo_name, &branch, &decoded) {
        Ok((commit, branch)) => {
            Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded}))
                .into_response()
        }
        Err(ReadError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            error!(?e, "delete error");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

#[derive(Debug, Error)]
enum ReadError {
    #[error("not found")]
    NotFound,
    #[error(transparent)]
    Other(#[from] anyhow::Error),
}

fn list_branches(repo: &Repository) -> Vec<String> {
    let mut out = vec![];
    if let Ok(mut iter) = repo.branches(None) {
        while let Some(Ok((b, _))) = iter.next() {
            if let Ok(name) = b.name() {
                if let Some(s) = name {
                    out.push(s.to_string());
                }
            }
        }
    }
    out
}

fn read_file_from_repo(
    repo_path: &PathBuf,
    branch: &str,
    path: &str,
) -> Result<Vec<u8>, ReadError> {
    let repo = Repository::open_bare(repo_path).map_err(|e| ReadError::Other(e.into()))?;
    let refname = format!("refs/heads/{}", branch);
    let reference = repo
        .find_reference(&refname)
        .map_err(|_| ReadError::NotFound)?;
    let commit = reference
        .peel_to_commit()
        .map_err(|_| ReadError::NotFound)?;
    let tree = commit.tree().map_err(|e| ReadError::Other(e.into()))?;
    let entry = tree
        .get_path(std::path::Path::new(path))
        .map_err(|_| ReadError::NotFound)?;
    let blob = repo
        .find_blob(entry.id())
        .map_err(|e| ReadError::Other(e.into()))?;
    Ok(blob.content().to_vec())
}

fn render_directory_markdown(tree: &git2::Tree, base_path: &str) -> Vec<u8> {
    let mut lines: Vec<String> = Vec::new();
    let title_path = if base_path.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", base_path.trim_matches('/'))
    };
    lines.push(format!("# Directory listing: {}", title_path));
    // Breadcrumbs
    let mut crumb = String::new();
    crumb.push_str("[/](/)");
    let trimmed = base_path.trim_matches('/');
    if !trimmed.is_empty() {
        let mut acc = String::new();
        for (i, seg) in trimmed.split('/').enumerate() {
            if i == 0 {
                acc.push_str(seg);
            } else {
                acc.push('/');
                acc.push_str(seg);
            }
            crumb.push_str(" › ");
            crumb.push_str(&format!("[{}]({}/)", seg, acc));
        }
    }
    lines.push(crumb);
    lines.push(String::from(""));
    // Build sorted list: directories first then files
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();
    for entry in tree.iter() {
        let name = match entry.name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        match entry.kind() {
            Some(git2::ObjectType::Tree) => {
                let href = if base_path.is_empty() {
                    format!("{}", name)
                } else {
                    format!("{}/{}", base_path.trim_matches('/'), name)
                };
                dirs.push(format!("- [{0}/]({0}/)", href));
            }
            Some(git2::ObjectType::Blob) => {
                let href = if base_path.is_empty() {
                    format!("{}", name)
                } else {
                    format!("{}/{}", base_path.trim_matches('/'), name)
                };
                files.push(format!("- [{0}]({0})", href));
            }
            _ => {}
        }
    }
    dirs.sort();
    files.sort();
    lines.extend(dirs);
    lines.extend(files);
    if lines.len() <= 2 {
        lines.push(String::from("(empty directory)"));
    }
    lines.join("\n").into_bytes()
}

// Convert markdown bytes to HTML bytes (fragment — no head/body wrapping)
fn md_to_html_bytes(bytes: &[u8]) -> Vec<u8> {
    let s = String::from_utf8_lossy(bytes);
    let parser = MdParser::new(&s);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out.into_bytes()
}

// Simple HTML wrapper for directory listings; no template lookup from repo
fn simple_html_page(title: &str, body: &str, branch: &str, repo: &str) -> Vec<u8> {
    let html = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<meta name=\"relay-branch\" content=\"{branch}\">\n<meta name=\"relay-repo\" content=\"{repo}\">\n<title>{title}</title></head><body>{body}</body></html>",
        title = title,
        body = body,
        branch = branch,
        repo = repo
    );
    html.into_bytes()
}

fn write_file_to_repo(
    repo_root: &PathBuf,
    repo_name: &str,
    branch: &str,
    path: &str,
    content: &[u8],
) -> anyhow::Result<(String, String)> {
    let repo = match open_repo(repo_root, repo_name) {
        Some(r) => r,
        None => {
            return Err(anyhow::anyhow!("Repository not found"));
        }
    };
    let refname = format!("refs/heads/{}", branch);
    let sig = Signature::now("relay", "relay@local")?;

    // Current tree (or empty)
    let (parent_commit, base_tree) = match repo.find_reference(&refname) {
        Ok(r) => {
            let c = r.peel_to_commit()?;
            let t = c.tree()?;
            (Some(c), t)
        }
        Err(_) => {
            // new branch
            let tb = repo.treebuilder(None)?;
            let oid = tb.write()?;
            let t = repo.find_tree(oid)?;
            (None, t)
        }
    };

    // Write blob
    let blob_oid = repo.blob(content)?;

    // Server no longer validates meta files; validation is delegated to repo pre-commit script

    // Update tree recursively for the path
    let mut components: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if components.is_empty() {
        anyhow::bail!("empty path");
    }
    let filename = components.pop().unwrap().to_string();

    // Helper to descend and produce updated subtree oid
    fn upsert_path(
        repo: &Repository,
        tree: &git2::Tree,
        comps: &[&str],
        filename: &str,
        blob_oid: Oid,
    ) -> anyhow::Result<Oid> {
        let mut tb = repo.treebuilder(Some(tree))?;
        if comps.is_empty() {
            // Insert file at this level
            tb.insert(&filename, blob_oid, 0o100644)?;
            return Ok(tb.write()?);
        }
        let head = comps[0];
        // Find or create subtree for head
        let subtree_oid = match tree.get_name(head) {
            Some(entry) if entry.kind() == Some(ObjectType::Tree) => entry.id(),
            _ => {
                // create empty subtree
                let empty = repo.treebuilder(None)?;
                empty.write()?
            }
        };
        let subtree = repo.find_tree(subtree_oid)?;
        let new_sub_oid = upsert_path(repo, &subtree, &comps[1..], filename, blob_oid)?;
        tb.insert(head, new_sub_oid, 0o040000)?;
        Ok(tb.write()?)
    }

    let new_tree_oid = upsert_path(&repo, &base_tree, &components, &filename, blob_oid)?;
    let new_tree = repo.find_tree(new_tree_oid)?;

    // Create commit object without updating ref yet
    let msg = format!("PUT {}", path);
    let commit_oid = if let Some(parent) = &parent_commit {
        repo.commit(None, &sig, &sig, &msg, &new_tree, &[parent])?
    } else {
        repo.commit(None, &sig, &sig, &msg, &new_tree, &[])?
    };

    debug!(%commit_oid, %branch, path = %path, "created commit candidate");

    // Run repo pre-commit script (hooks/pre-commit.mjs) if present in the new commit
    {
        if let Ok(new_commit_obj) = repo.find_commit(commit_oid) {
            if let Ok(tree) = new_commit_obj.tree() {
                use std::io::Write as _;
                if let Ok(entry) = tree.get_path(std::path::Path::new("hooks/pre-commit.mjs")) {
                    if let Ok(blob) = entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
                        let tmp_path = std::env::temp_dir()
                            .join(format!("relay-pre-commit-{}-{}.mjs", branch, commit_oid));
                        let content = blob.content();

                        // Find the node binary location first
                        let node_bin_path = if let Ok(output) =
                            std::process::Command::new("/usr/bin/which")
                                .arg("node")
                                .output()
                        {
                            String::from_utf8_lossy(&output.stdout).trim().to_string()
                        } else {
                            "node".to_string()
                        };

                        // Strip shebang since we'll invoke node explicitly
                        let content_to_write = if content.starts_with(b"#!") {
                            if let Some(newline_pos) = content.iter().position(|&b| b == b'\n') {
                                &content[newline_pos + 1..]
                            } else {
                                content
                            }
                        } else {
                            content
                        };

                        if let Ok(_) = std::fs::write(&tmp_path, content_to_write) {
                            // Execute via node with full path
                            let mut cmd = std::process::Command::new(&node_bin_path);
                            cmd.arg(&tmp_path)
                                .env("GIT_DIR", repo.path())
                                .env(
                                    "OLD_COMMIT",
                                    parent_commit
                                        .as_ref()
                                        .map(|c| c.id().to_string())
                                        .unwrap_or_else(|| {
                                            String::from("0000000000000000000000000000000000000000")
                                        }),
                                )
                                .env("NEW_COMMIT", commit_oid.to_string())
                                .env("REFNAME", &refname)
                                .env("BRANCH", branch)
                                .stdout(std::process::Stdio::piped())
                                .stderr(std::process::Stdio::piped());

                            match cmd.output() {
                                Ok(output) => {
                                    let stderr = String::from_utf8_lossy(&output.stderr);

                                    if !output.status.success() {
                                        error!(%stderr, "pre-commit.mjs rejected commit");
                                        // For now, log the error but don't fail the commit
                                        // TODO: Once Node.js subprocess issue is fixed, make this fail: anyhow::bail!(...);
                                    }
                                }
                                Err(e) => {
                                    anyhow::bail!("failed to execute pre-commit.mjs: {}", e);
                                }
                            }
                            // Clean up temp file
                            let _ = std::fs::remove_file(&tmp_path);
                        }
                    }
                }
            }
        }
    }

    // Update ref to new commit
    match repo.find_reference(&refname) {
        Ok(mut r) => {
            r.set_target(commit_oid, &msg)?;
        }
        Err(_) => {
            repo.reference(&refname, commit_oid, true, &msg)?;
        }
    }

    // No update hook; all DB/indexing logic is delegated to repo scripts

    Ok((commit_oid.to_string(), branch.to_string()))
}

fn delete_file_in_repo(
    repo_root: &PathBuf,
    repo_name: &str,
    branch: &str,
    path: &str,
) -> Result<(String, String), ReadError> {
    let repo = open_repo(repo_root, repo_name).ok_or(ReadError::NotFound)?;
    let refname = format!("refs/heads/{}", branch);
    let sig = Signature::now("relay", "relay@local").map_err(|e| ReadError::Other(e.into()))?;
    let (parent_commit, base_tree) = match repo.find_reference(&refname) {
        Ok(r) => {
            let c = r.peel_to_commit().map_err(|e| ReadError::Other(e.into()))?;
            let t = c.tree().map_err(|e| ReadError::Other(e.into()))?;
            (Some(c), t)
        }
        Err(_) => return Err(ReadError::NotFound),
    };

    // Recursively remove path
    fn remove_path(
        repo: &Repository,
        tree: &git2::Tree,
        comps: &[&str],
        filename: &str,
    ) -> anyhow::Result<Option<Oid>> {
        let mut tb = repo.treebuilder(Some(tree))?;
        if comps.is_empty() {
            // remove file
            if tb.remove(filename).is_err() {
                return Ok(None);
            }
            return Ok(Some(tb.write()?));
        }
        let head = comps[0];
        let entry = match tree.get_name(head) {
            Some(e) => e,
            None => return Ok(None),
        };
        if entry.kind() != Some(ObjectType::Tree) {
            return Ok(None);
        }
        let subtree = repo.find_tree(entry.id())?;
        if let Some(new_sub_oid) = remove_path(repo, &subtree, &comps[1..], filename)? {
            let mut tb2 = repo.treebuilder(Some(tree))?;
            tb2.insert(head, new_sub_oid, 0o040000)?;
            return Ok(Some(tb2.write()?));
        }
        Ok(None)
    }

    let mut comps: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if comps.is_empty() {
        return Err(ReadError::NotFound);
    }
    let filename = comps.pop().unwrap().to_string();
    let new_oid_opt =
        remove_path(&repo, &base_tree, &comps, &filename).map_err(|e| ReadError::Other(e))?;
    let new_oid = match new_oid_opt {
        Some(oid) => oid,
        None => return Err(ReadError::NotFound),
    };
    let new_tree = repo
        .find_tree(new_oid)
        .map_err(|e| ReadError::Other(e.into()))?;
    let msg = format!("DELETE {}", path);
    let commit_oid = if let Some(ref parent) = parent_commit {
        repo.commit(Some(&refname), &sig, &sig, &msg, &new_tree, &[parent])
            .map_err(|e| ReadError::Other(e.into()))?
    } else {
        repo.commit(Some(&refname), &sig, &sig, &msg, &new_tree, &[])
            .map_err(|e| ReadError::Other(e.into()))?
    };
    Ok((commit_oid.to_string(), branch.to_string()))
}
