use std::{net::SocketAddr, path::{Path as FsPath, PathBuf}, str::FromStr};

use axum::{
    body::Bytes,
    extract::{Path as AxPath, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, options},
    Json, Router,
};
use git2::{ObjectType, Oid, Repository, Signature};
use percent_encoding::percent_decode_str as url_decode;
use tokio::net::TcpListener;
use base64::{engine::general_purpose, Engine as _};
use pulldown_cmark::{html, Parser as MdParser};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use tokio::time::{Duration};
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};
use clap::{Parser, Subcommand, Args};

#[derive(Clone)]
struct AppState {
    repo_path: PathBuf,
    // Additional static directories to serve from root before Git/IPFS
    static_paths: Vec<PathBuf>,
}

const HEADER_BRANCH: &str = "X-Relay-Branch";
const HEADER_REPO: &str = "X-Relay-Repo";
const DEFAULT_BRANCH: &str = "main";
// Disallowed extensions for general access; JavaScript is now allowed to be loaded (GET)
// but remains blocked for writes via PUT/DELETE (enforced below and by hooks).
const DISALLOWED: &[&str] = &[".html", ".htm"];

const DEFAULT_IPFS_CACHE_ROOT: &str = "/srv/relay/ipfs-cache";

// IPFS fetch deduplication removed; IPFS resolution is delegated to repo script

#[derive(Parser, Debug)]
#[command(name = "relay-server", version, about = "Relay Server and CLI utilities", propagate_version = true)]
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

    // No IPFS CLI commands; IPFS resolution is delegated to repo script (.relay/get.mjs)

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
    let (repo_path, static_paths, bind_cli): (PathBuf, Vec<PathBuf>, Option<String>) = match cli.command {
        Some(Commands::Serve(sa)) => {
            let rp = sa
                .repo
                .or_else(|| std::env::var("RELAY_REPO_PATH").ok().map(PathBuf::from))
                .unwrap_or_else(|| PathBuf::from("data/repo.git"));
            (rp, sa.static_paths, sa.bind)
        }
        _ => {
            let rp = std::env::var("RELAY_REPO_PATH")
                .map(PathBuf::from)
                .unwrap_or_else(|_| PathBuf::from("data/repo.git"));
            (rp, Vec::new(), None)
        }
    };
    ensure_bare_repo(&repo_path)?;

    let state = AppState { repo_path, static_paths };

    // Build router (breaking changes: removed /status and /query/*; OPTIONS is the discovery endpoint)
    let app = Router::new()
        .route("/openapi.yaml", get(get_openapi_yaml))
        .route("/swagger-ui", get(get_swagger_ui))
        .route("/env", axum::routing::post(post_env))
        .route("/", get(get_root).options(options_capabilities))
        .route(
            "/*path",
            get(get_file)
                .put(put_file)
                .delete(delete_file)
                .options(options_capabilities),
        )
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

// CLI: ipfs-add implementation
async fn ipfs_add_cli(args: &IpfsAddArgs) -> anyhow::Result<()> {
    let dir = &args.dir;
    if !dir.is_dir() {
        anyhow::bail!("Not a directory: {}", dir.display());
    }
    let mut cmd = TokioCommand::new("ipfs");
    cmd.arg("add").arg("-r").arg(dir);
    if let Some(p) = &args.ipfs_path {
        cmd.env("IPFS_PATH", p);
    }
    let out = cmd.output().await?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!("ipfs add failed: {}", stderr);
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    let dir_str = dir.to_string_lossy().to_string();
    let base = dir.file_name().and_then(|s| s.to_str()).unwrap_or("");
    let mut last_cid: Option<String> = None;
    let mut dir_cid: Option<String> = None;
    for line in stdout.lines() {
        let mut it = line.split_whitespace();
        let first = it.next();
        let second = it.next();
        let rest = it.next();
        if first == Some("added") {
            if let Some(cid) = second.map(|s| s.to_string()) {
                last_cid = Some(cid.clone());
                if let Some(path) = rest {
                    if path == dir_str || (!base.is_empty() && path.ends_with(base)) {
                        dir_cid = Some(cid);
                    }
                }
            }
        }
    }
    let cid = dir_cid.or(last_cid).unwrap_or_default();
    if cid.is_empty() {
        anyhow::bail!("could not parse CID from ipfs add output");
    }
    println!("{}", cid);
    Ok(())
}

// Peer tracker removed; no background registration function

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

/// POST /env — returns a JSON object of environment variables whitelisted by prefix
/// Whitelist: keys starting with "RELAY_PUBLIC_" only.
/// Merge order (lowest to highest precedence): .env -> .env.local -> OS env
async fn post_env(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    // Read .env and .env.local from the repo at this branch
    let mut merged: HashMap<String, String> = HashMap::new();
    let from_repo = |name: &str| -> Option<String> {
        read_file_from_repo(&state.repo_path, &branch, name)
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
    };
    if let Some(env_txt) = from_repo(".env") {
        for (k, v) in parse_dotenv(&env_txt) {
            merged.entry(k).or_insert(v);
        }
    }
    if let Some(env_local_txt) = from_repo(".env.local") {
        for (k, v) in parse_dotenv(&env_local_txt) {
            merged.insert(k, v);
        }
    }
    // Overlay OS env
    for (k, v) in std::env::vars() {
        merged.insert(k, v);
    }
    // Whitelist: only RELAY_PUBLIC_*
    let filtered: HashMap<String, String> = merged
        .into_iter()
        .filter(|(k, _)| k.starts_with("RELAY_PUBLIC_"))
        .collect();
    (StatusCode::OK, Json(filtered))
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

// Removed legacy /status endpoint handler

/// OPTIONS handler — discovery: capabilities, branches, repos, current selections
async fn options_capabilities(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // Branch and repo resolution from request context
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = repo_from(
        &state.repo_path,
        &headers,
        &query.as_ref().map(|q| q.0.clone()),
        &branch,
    );

    // Enumerate branches and repos
    let (mut branches, mut repos, mut branch_heads): (
        Vec<String>,
        Vec<String>,
        Vec<(String, String)>,
    ) = match Repository::open_bare(&state.repo_path) {
        Ok(repo) => {
            let branches = list_branches(&repo);
            let repos = list_repos(&state.repo_path, &branch).unwrap_or_default();
            let heads = list_branch_heads(&state.repo_path);
            (branches, repos, heads)
        }
        Err(_) => (Vec::new(), Vec::new(), Vec::new()),
    };

    // Filter by requested branch (if explicitly set via header/query/cookie)
    if let Some(req_branch) = query
        .as_ref()
        .and_then(|q| q.0.get("branch").cloned())
        .or_else(|| {
            headers
                .get(HEADER_BRANCH)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
    {
        if !req_branch.is_empty() {
            branches.retain(|b| b == &req_branch);
            branch_heads.retain(|(b, _)| b == &req_branch);
        }
    }
    // Filter repos list by requested repo (if present); also limit branch heads to those branches where the repo exists
    if let Some(req_repo) = query
        .as_ref()
        .and_then(|q| q.0.get("repo").cloned())
        .or_else(|| {
            headers
                .get(HEADER_REPO)
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string())
        })
    {
        if !req_repo.is_empty() {
            repos.retain(|r| r == &req_repo);
            // Keep only heads for branches where this repo exists
            branch_heads.retain(|(b, _)| {
                if let Ok(list) = list_repos(&state.repo_path, b) {
                    list.iter().any(|r| r == &req_repo)
                } else {
                    false
                }
            });
        }
    }
    let capabilities = vec!["git", "torrent", "ipfs", "http"];
    let allow = "GET, PUT, DELETE, OPTIONS, QUERY";
    let body = serde_json::json!({
        "ok": true,
        "repoInitialized": true,
        "capabilities": capabilities,
        "branches": branches,
        "repos": repos,
        "currentBranch": branch,
        "currentRepo": repo_name.clone().unwrap_or_default(),
        "branchHeads": branch_heads.into_iter().map(|(b,c)| serde_json::json!({"branch": b, "commit": c})).collect::<Vec<_>>(),
        "samplePaths": {"index": "index.md"},
    });
    (
        StatusCode::OK,
        [
            ("Allow", allow.to_string()),
            (HEADER_BRANCH, branch),
            (HEADER_REPO, repo_name.clone().unwrap_or_default()),
        ],
        Json(body),
    )
}

/// List all local branches with their HEAD commit ids
fn list_branch_heads(repo_path: &PathBuf) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if let Ok(repo) = Repository::open_bare(repo_path) {
        if let Ok(mut iter) = repo.branches(None) {
            while let Some(Ok((b, _))) = iter.next() {
                if let Ok(name_opt) = b.name() {
                    if let Some(name) = name_opt {
                        if let Ok(reference) = repo.find_reference(&format!("refs/heads/{}", name))
                        {
                            if let Ok(commit) = reference.peel_to_commit() {
                                out.push((name.to_string(), commit.id().to_string()));
                            }
                        }
                    }
                }
            }
        }
    }
    out
}

// QueryRequest/Response handled entirely by repo script (.relay/query.mjs)

async fn post_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<serde_json::Value>>,
) -> impl IntoResponse {
    // Resolve branch
    let branch = headers
        .get(HEADER_BRANCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BRANCH)
        .to_string();
    let input_json = body.map(|Json(v)| v).unwrap_or(serde_json::json!({}));

    // Load .relay/query.mjs from branch
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
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
    let entry = match tree.get_path(std::path::Path::new(".relay/query.mjs")) {
        Ok(e) => e,
        Err(_) => return (StatusCode::BAD_REQUEST, ".relay/query.mjs not found").into_response(),
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
                        [("Content-Type", "application/json".to_string()), (HEADER_BRANCH, branch)],
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
    fn test_directory_response_html_default() {
        // create a temporary git repo with a README.md at root
        let dir = tempdir().unwrap();
        let repo = Repository::init_bare(dir.path()).unwrap();

        // create an in-memory tree with README.md blob
        let oid = repo
            .blob("# Title\n\nSome content".as_bytes())
            .expect("create blob");
        // we need to create a tree that references the blob. For tests, we'll
        // just build a tree manually using TreeBuilder
        let mut tb = repo.treebuilder(None).unwrap();
        tb.insert("README.md", oid, 0o100644).unwrap();
        let tree_oid = tb.write().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();

        let repo_path = dir.path().to_path_buf();
        let (ct, bytes) = directory_response(&repo_path, &tree, &tree, "", "", DEFAULT_BRANCH, "");
        assert!(ct.starts_with("text/html"), "ct was {}", ct);
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.contains("<h1>Title</h1>") || s.contains("<a href=\"README.md\""));
    }

    #[test]
    fn test_directory_response_markdown_requested() {
        let dir = tempdir().unwrap();
        let repo = Repository::init_bare(dir.path()).unwrap();

        let mut tb = repo.treebuilder(None).unwrap();
        let oid = repo
            .blob("# Title\n\nSome content".as_bytes())
            .expect("create blob");
        tb.insert("README.md", oid, 0o100644).unwrap();
        let tree_oid = tb.write().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();

        let repo_path = dir.path().to_path_buf();
        let (ct, bytes) = directory_response(
            &repo_path,
            &tree,
            &tree,
            "",
            "text/markdown",
            DEFAULT_BRANCH,
            "",
        );
        assert_eq!(ct, "text/markdown");
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.contains("# Title") || s.contains("README.md"));
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
}

fn disallowed(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    DISALLOWED.iter().any(|ext| lower.ends_with(ext))
}

// For write operations we continue to disallow JavaScript in addition to HTML
fn write_disallowed(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.ends_with(".js") || DISALLOWED.iter().any(|ext| lower.ends_with(ext))
}

fn branch_from(headers: &HeaderMap, query: &Option<HashMap<String, String>>) -> String {
    // Priority: query ?branch= -> header X-Relay-Branch -> cookie relay-branch -> default
    if let Some(q) = query {
        if let Some(b) = q.get("branch").filter(|s| !s.is_empty()) {
            return b.to_string();
        }
    }
    if let Some(h) = headers.get(HEADER_BRANCH).and_then(|v| v.to_str().ok()) {
        if !h.is_empty() {
            return h.to_string();
        }
    }
    if let Some(cookie_hdr) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            let mut kv = part.trim().splitn(2, '=');
            let k = kv.next().unwrap_or("").trim();
            let v = kv.next().unwrap_or("");
            if k == "relay-branch" && !v.is_empty() {
                return v.to_string();
            }
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

fn repo_from(
    repo_path: &PathBuf,
    headers: &HeaderMap,
    query: &Option<HashMap<String, String>>,
    branch: &str,
) -> Option<String> {
    // Precedence: query ?repo= -> header X-Relay-Repo -> cookie relay-repo -> env RELAY_DEFAULT_REPO -> first in list_repos -> default empty repo
    if let Some(q) = query {
        if let Some(r) = q.get("repo").and_then(|s| sanitize_repo_name(s)) {
            return Some(r);
        }
    }
    if let Some(h) = headers
        .get(HEADER_REPO)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| sanitize_repo_name(s))
    {
        return Some(h);
    }
    if let Some(cookie_hdr) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            let mut kv = part.trim().splitn(2, '=');
            let k = kv.next().unwrap_or("").trim();
            let v = kv.next().unwrap_or("");
            if k == "relay-repo" {
                if let Some(s) = sanitize_repo_name(v) {
                    return Some(s);
                }
            }
        }
    }
    if let Ok(env_def) = std::env::var("RELAY_DEFAULT_REPO") {
        if let Some(s) = sanitize_repo_name(&env_def) {
            return Some(s);
        }
    }
    if let Ok(list) = list_repos(repo_path, branch) {
        return list.into_iter().next();
    }
    // If no subdirectories found, serve the root as the default repository
    Some("".to_string())
}

fn list_repos(repo_path: &PathBuf, branch: &str) -> anyhow::Result<Vec<String>> {
    let repo = Repository::open_bare(repo_path)?;
    let refname = format!("refs/heads/{}", branch);
    let reference = repo.find_reference(&refname)?;
    let commit = reference.peel_to_commit()?;
    let tree = commit.tree()?;
    let mut out: Vec<String> = Vec::new();
    for entry in tree.iter() {
        if entry.kind() == Some(ObjectType::Tree) {
            if let Some(name) = entry.name() {
                out.push(name.to_string());
            }
        }
    }
    out.sort();
    Ok(out)
}

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
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(
        &state.repo_path,
        &headers,
        &query.as_ref().map(|q| q.0.clone()),
        &branch,
    ) {
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

    // For html/js we skip Git (never serve from repo); otherwise resolve via Git first
    let is_html_js = {
        let l = decoded.to_ascii_lowercase();
        l.ends_with(".html") || l.ends_with(".htm") || l.ends_with(".js")
    };
    let git_result = if is_html_js {
        GitResolveResult::NotFound(decoded.trim_matches('/').to_string())
    } else {
        git_resolve_and_respond(&state.repo_path, &headers, &branch, &repo_name, &decoded)
    };
    match git_result {
        GitResolveResult::Respond(resp) => return resp,
        GitResolveResult::NotFound(rel_missing) => {
            // Git miss: delegate to repo get script (.relay/get.mjs)
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
    // Load .relay/get.mjs from branch
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let refname = format!("refs/heads/{}", branch);
    let commit = match repo
        .find_reference(&refname)
        .and_then(|r| r.peel_to_commit())
    {
        Ok(c) => c,
        Err(_) => return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing),
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(_) => return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing),
    };
    let entry = match tree.get_path(std::path::Path::new(".relay/get.mjs")) {
        Ok(e) => e,
        Err(_) => return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing),
    };
    let blob = match entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
        Ok(b) => b,
        Err(_) => return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing),
    };
    let tmp = std::env::temp_dir().join(format!("relay-get-{}-{}.mjs", branch, commit.id()));
    if let Err(e) = std::fs::write(&tmp, blob.content()) {
        error!(?e, "failed to write get.mjs temp file");
        return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing);
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
            return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing);
        }
    };
    let _ = std::fs::remove_file(&tmp);
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        warn!(%stderr, "get.mjs non-success status");
        return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing);
    }
    let val: serde_json::Value = match serde_json::from_slice(&output.stdout) {
        Ok(v) => v,
        Err(e) => {
            warn!(?e, "get.mjs returned invalid JSON");
            return render_404_markdown(&state.repo_path, branch, repo_name, rel_missing);
        }
    };
    let kind = val.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    match kind {
        "file" => {
            let ct = val
                .get("contentType")
                .and_then(|v| v.as_str())
                .unwrap_or("application/octet-stream");
            let b64 = val
                .get("bodyBase64")
                .and_then(|v| v.as_str())
                .unwrap_or("");
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
                    render_404_markdown(&state.repo_path, branch, repo_name, rel_missing)
                }
            }
        }
        "dir" => {
            (
                StatusCode::OK,
                [
                    ("Content-Type", "application/json".to_string()),
                    (HEADER_BRANCH, branch.to_string()),
                    (HEADER_REPO, repo_name.to_string()),
                ],
                Json(val),
            )
                .into_response()
        }
        _ => render_404_markdown(&state.repo_path, branch, repo_name, rel_missing),
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
                    let resp = (
                        StatusCode::OK,
                        [("Content-Type", ct)],
                        bytes,
                    )
                        .into_response();
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
    repo_path: &PathBuf,
    headers: &HeaderMap,
    branch: &str,
    repo_name: &str,
    decoded: &str,
) -> GitResolveResult {
    let repo = match Repository::open_bare(repo_path) {
        Ok(r) => r,
        Err(e) => {
            error!(?e, "open repo error");
            return GitResolveResult::Respond(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };
    let refname = format!("refs/heads/{}", branch);
    let reference = match repo.find_reference(&refname) {
        Ok(r) => r,
        Err(_) => {
            let resp = render_404_markdown(repo_path, branch, repo_name, decoded);
            return GitResolveResult::Respond(resp);
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

    // Scope under selected repo
    let path_scoped = {
        let p = decoded.trim_matches('/');
        if repo_name.is_empty() {
            p.to_string()
        } else if p.is_empty() {
            repo_name.to_string()
        } else {
            format!("{}/{}", repo_name, p)
        }
    };
    let rel = path_scoped.trim_matches('/');

    // Empty path -> directory listing
    if rel.is_empty() {
        let accept_hdr = headers
            .get("accept")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let (ct, body) =
            directory_response(repo_path, &tree, &tree, rel, accept_hdr, branch, repo_name);
        let resp = (
            StatusCode::OK,
            [
                ("Content-Type", ct),
                (HEADER_BRANCH, branch.to_string()),
                (HEADER_REPO, repo_name.to_string()),
            ],
            body,
        )
            .into_response();
        return GitResolveResult::Respond(resp);
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
                let lower = rel.to_ascii_lowercase();
                let is_md = lower.ends_with(".md") || lower.ends_with(".markdown");
                let accept_hdr = headers
                    .get("accept")
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("");
                let wants_markdown = accept_hdr.contains("text/markdown");
                if is_md {
                    let content = blob.content();
                    if wants_markdown {
                        let resp = (
                            StatusCode::OK,
                            [
                                ("Content-Type", "text/markdown".to_string()),
                                (HEADER_BRANCH, branch.to_string()),
                            ],
                            content.to_vec(),
                        )
                            .into_response();
                        return GitResolveResult::Respond(resp);
                    } else {
                        let html_frag =
                            String::from_utf8(md_to_html_bytes(content)).unwrap_or_default();
                        let base_dir = std::path::Path::new(rel)
                            .parent()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| "".to_string());
                        let title = std::path::Path::new(rel)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("Document");
                        let wrapped = simple_html_page(title, &html_frag, branch, repo_name);
                        let resp = (
                            StatusCode::OK,
                            [
                                ("Content-Type", "text/html; charset=utf-8".to_string()),
                                (HEADER_BRANCH, branch.to_string()),
                                (HEADER_REPO, repo_name.to_string()),
                            ],
                            wrapped,
                        )
                            .into_response();
                        return GitResolveResult::Respond(resp);
                    }
                }
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
            // Defer directory listing logic to repo script (.relay/get.mjs)
            GitResolveResult::NotFound(rel.to_string())
        }
        _ => GitResolveResult::Respond(render_404_markdown(repo_path, branch, repo_name, rel)),
    }
}

// Attempt IPFS fallback (Cache -> On-demand fetch -> Serve). Returns 200/404/503 as per plan.
async fn ipfs_fallback_or_404(
    state: &AppState,
    branch: &str,
    repo_name: &str,
    rel_scoped: &str,
    original_decoded: &str,
) -> Response {
    let started = Instant::now();
    let timeout_total = std::env::var("RELAY_IPFS_TIMEOUT_SECS")
        .ok()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(DEFAULT_IPFS_TIMEOUT_SECS);
    let deadline = started + Duration::from_secs(timeout_total);

    // Determine subpath relative to repo root (exclude repo prefix if present)
    let subpath = if repo_name.is_empty() {
        original_decoded.trim_matches('/').to_string()
    } else {
        let trimmed = original_decoded.trim_matches('/');
        let prefix = format!("{}/", repo_name);
        if let Some(rest) = trimmed.strip_prefix(&prefix) {
            rest.to_string()
        } else {
            trimmed.to_string()
        }
    };

    // Read relay.yaml for ipfs.rootHash and (optional) branches
    let (root_cid_opt, allowed_branch) = read_ipfs_rules(&state.repo_path, branch);
    let root_cid = match root_cid_opt {
        Some(cid) => cid,
        None => {
            debug!(branch=%branch, repo=%repo_name, path=%subpath, "No ipfs.rootHash in relay.yaml — skipping IPFS fallback");
            return render_404_markdown(&state.repo_path, branch, repo_name, rel_scoped);
        }
    };
    if !allowed_branch {
        debug!(branch=%branch, repo=%repo_name, path=%subpath, "Branch not listed in ipfs.branches — skipping IPFS fallback");
        return render_404_markdown(&state.repo_path, branch, repo_name, rel_scoped);
    }

    // Compute cache file path
    let cache_root = std::env::var("RELAY_IPFS_CACHE_ROOT")
        .unwrap_or_else(|_| DEFAULT_IPFS_CACHE_ROOT.to_string());
    let repo_dir = if repo_name.is_empty() { "_" } else { repo_name };
    // Build a relative path from components to avoid issues with platform-specific separators
    let mut rel_components = std::path::PathBuf::new();
    for part in subpath.split('/') {
        if !part.is_empty() {
            rel_components.push(part);
        }
    }
    let cache_path = std::path::Path::new(&cache_root)
        .join(repo_dir)
        .join(branch)
        .join(rel_components);

    // Serve from cache if exists
    if cache_path.is_file() {
        let ct = mime_guess::from_path(&cache_path)
            .first_or_octet_stream()
            .essence_str()
            .to_string();
        match tokio::fs::read(&cache_path).await {
            Ok(bytes) => {
                info!(elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, cache=%cache_path.to_string_lossy(), "IPFS cache hit");
                return (
                    StatusCode::OK,
                    [
                        ("Content-Type", ct),
                        (HEADER_BRANCH, branch.to_string()),
                        (HEADER_REPO, repo_name.to_string()),
                    ],
                    bytes,
                )
                    .into_response();
            }
            Err(e) => {
                warn!(?e, cache=%cache_path.to_string_lossy(), "Failed reading cache file; will try fetch");
            }
        }
    }

    // Ensure parent directory exists
    if let Some(parent) = cache_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    // Check if path exists under CID (using CLI `ipfs` commands)
    let ipfs_path = format!("/ipfs/{}/{}", root_cid, subpath);

    // Deduplicate concurrent fetches for the same file
    let key = cache_path.to_string_lossy().to_string();
    let map = fetch_map();
    let mut should_fetch = false;
    {
        let mut set = map.lock().unwrap();
        if !set.contains(&key) {
            set.insert(key.clone());
            should_fetch = true;
        }
    }

    // Helper to drop the in-progress mark
    struct MarkGuard {
        key: String,
    }
    impl Drop for MarkGuard {
        fn drop(&mut self) {
            let map = fetch_map();
            let mut set = map.lock().unwrap();
            set.remove(&self.key);
        }
    }

    // If someone else is fetching, wait until deadline for the file to appear
    if !should_fetch {
        debug!(repo=%repo_name, branch=%branch, path=%subpath, "Another fetch in progress; waiting for cache file");
        loop {
            if cache_path.is_file() {
                break;
            }
            if Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        if cache_path.is_file() {
            if let Ok(bytes) = tokio::fs::read(&cache_path).await {
                let ct = mime_guess::from_path(&cache_path)
                    .first_or_octet_stream()
                    .essence_str()
                    .to_string();
                info!(elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, cache=%cache_path.to_string_lossy(), "IPFS fetch de-duped — served from cache");
                return (
                    StatusCode::OK,
                    [
                        ("Content-Type", ct),
                        (HEADER_BRANCH, branch.to_string()),
                        (HEADER_REPO, repo_name.to_string()),
                    ],
                    bytes,
                )
                    .into_response();
            }
        }
        // Fall through to 503 timeout below
        warn!(elapsed_ms = %started.elapsed().as_millis(), repo=%repo_name, branch=%branch, path=%subpath, "Waited for peer fetch but file not available before deadline");
        return (StatusCode::SERVICE_UNAVAILABLE, "IPFS fetch timeout").into_response();
    }

    let _guard = MarkGuard { key };

    // Attempt fetch via CLI first: ipfs get /ipfs/<cid>/<subpath> -o <cache_path>
    let mut cmd = TokioCommand::new("ipfs");
    // Use IPFS_PATH to target the local daemon; avoid --api for compatibility
    cmd.arg("get")
        .arg(&ipfs_path)
        .arg("-o")
        .arg(&cache_path)
        .env(
            "IPFS_PATH",
            std::env::var("IPFS_PATH").unwrap_or_else(|_| DEFAULT_IPFS_PATH.to_string()),
        )
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());

    let remaining = deadline.saturating_duration_since(Instant::now());
    match timeout(remaining, cmd.status()).await {
        Ok(Ok(status)) if status.success() => {
            // Serve file
            match tokio::fs::read(&cache_path).await {
                Ok(bytes) => {
                    let ct = mime_guess::from_path(&cache_path)
                        .first_or_octet_stream()
                        .essence_str()
                        .to_string();
                    info!(elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, cache=%cache_path.to_string_lossy(), "IPFS fetch ok");
                    (
                        StatusCode::OK,
                        [
                            ("Content-Type", ct),
                            (HEADER_BRANCH, branch.to_string()),
                            (HEADER_REPO, repo_name.to_string()),
                        ],
                        bytes,
                    )
                        .into_response()
                }
                Err(e) => {
                    error!(?e, cache=%cache_path.to_string_lossy(), "Fetched but failed to read cache file");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Ok(Ok(status)) => {
            warn!(?status, elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, "ipfs get failed");
            // Decide 404 vs 503 by attempting a quick resolve within the remaining time
            let mut res = TokioCommand::new("ipfs");
            res.arg("resolve")
                .arg("-r")
                .arg(&ipfs_path)
                .env(
                    "IPFS_PATH",
                    std::env::var("IPFS_PATH").unwrap_or_else(|_| DEFAULT_IPFS_PATH.to_string()),
                )
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null());
            let rem = deadline.saturating_duration_since(Instant::now());
            match timeout(rem, res.status()).await {
                Ok(Ok(s)) if s.success() => {
                    (StatusCode::SERVICE_UNAVAILABLE, "IPFS fetch failed").into_response()
                }
                Ok(_) => render_404_markdown(&state.repo_path, branch, repo_name, rel_scoped),
                Err(_) => (StatusCode::SERVICE_UNAVAILABLE, "IPFS fetch timeout").into_response(),
            }
        }
        Ok(Err(e)) => {
            error!(?e, elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, "ipfs get error");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                format!("IPFS error: {}", e),
            )
                .into_response()
        }
        Err(_) => {
            // Timeout
            warn!(elapsed_ms = %started.elapsed().as_millis(), cid=%root_cid, repo=%repo_name, branch=%branch, path=%subpath, "IPFS fetch timed out");
            (StatusCode::SERVICE_UNAVAILABLE, "IPFS fetch timeout").into_response()
        }
    }
}

// Read ipfs.rootHash and branches from relay.yaml at the requested branch. Returns (root_cid, branch_allowed)
fn read_ipfs_rules(repo_path: &PathBuf, branch: &str) -> (Option<String>, bool) {
    let bytes = match read_file_from_repo(repo_path, branch, "relay.yaml") {
        Ok(b) => b,
        Err(_) => return (None, true), // no relay.yaml — allow branch but no CID
    };
    let yaml = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(_) => return (None, true),
    };
    let v: serde_json::Value = match serde_yaml::from_str(&yaml) {
        Ok(v) => v,
        Err(_) => return (None, true),
    };
    let ipfs = match v.get("ipfs") {
        Some(x) => x,
        None => return (None, true),
    };
    let cid = ipfs
        .get("rootHash")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string());
    let branches_ok = match ipfs.get("branches") {
        Some(b) => {
            if let Some(arr) = b.as_array() {
                arr.iter().filter_map(|x| x.as_str()).any(|s| s == branch)
            } else {
                true
            }
        }
        None => true,
    };
    (cid, branches_ok)
}

async fn get_root(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // Explicitly implement root directory listing to avoid extractor mismatch
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(
        &state.repo_path,
        &headers,
        &query.as_ref().map(|q| q.0.clone()),
        &branch,
    ) {
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
    info!(%branch, "get_root resolved branch");
    // Defer directory listing logic to .relay/get.mjs
    run_get_script_or_404(&state, &branch, &repo_name, "").await
}

async fn put_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    AxPath(path): AxPath<String>,
    query: Option<Query<HashMap<String, String>>>,
    body: Bytes,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if write_disallowed(&decoded) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Disallowed file type"})),
        )
            .into_response();
    }
    // Allow branch from query string too
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(
        &state.repo_path,
        &headers,
        &query.as_ref().map(|q| q.0.clone()),
        &branch,
    ) {
        Some(r) => r,
        None => {
            // Optionally allow creating a new repo directory on PUT
            if std::env::var("RELAY_ALLOW_CREATE_REPO")
                .ok()
                .map(|v| v == "true" || v == "1")
                .unwrap_or(true)
            {
                // proceed with scoped path even if repo dir doesn't yet exist (tree builder will create)
                String::from("new")
            } else {
                return (
                    StatusCode::NOT_FOUND,
                    Json(serde_json::json!({"error": "Repository not found"})),
                )
                    .into_response();
            }
        }
    };
    let scoped_path = {
        let p = decoded.trim_matches('/');
        if repo_name.is_empty() {
            p.to_string()
        } else if p.is_empty() {
            repo_name.clone()
        } else {
            format!("{}/{}", repo_name, p)
        }
    };
    match write_file_to_repo(&state.repo_path, &branch, &scoped_path, &body) {
        Ok((commit, branch)) => {
            Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded}))
                .into_response()
        }
        Err(e) => {
            error!(?e, "write error");
            let msg = e.to_string();
            if msg.contains("rejected by hooks") {
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
    if write_disallowed(&decoded) {
        return (
            StatusCode::FORBIDDEN,
            Json(serde_json::json!({"error": "Disallowed file type"})),
        )
            .into_response();
    }
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    match delete_file_in_repo(&state.repo_path, &branch, &decoded) {
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

// Helper to return directory listing as HTML or markdown depending on Accept header
// root_tree is the tree at repo root (for CSS presence checks), listing_tree is the directory to list
fn directory_response(
    repo_path: &PathBuf,
    _root_tree: &git2::Tree,
    listing_tree: &git2::Tree,
    base_path: &str,
    accept_hdr: &str,
    branch: &str,
    repo: &str,
) -> (String, Vec<u8>) {
    // Build merged entries from Git and (optional) IPFS dir cache
    let mut entries = git_dir_entries(repo_path, listing_tree, base_path, branch);
    if let (Some(root_cid), true) = read_ipfs_rules(repo_path, branch) {
        match ipfs_dir_entries_cached(repo, branch, base_path, &root_cid) {
            Ok(ipfs_entries) => {
                let existing: HashSet<String> = entries.iter().map(|e| e.name.clone()).collect();
                for e in ipfs_entries {
                    if !existing.contains(&e.name) {
                        entries.push(e);
                    }
                }
                sort_entries(&mut entries);
            }
            Err(e) => {
                debug!(?e, repo=%repo, branch=%branch, dir=%base_path, "IPFS dir cache unavailable — Git-only listing");
                sort_entries(&mut entries);
            }
        }
    } else {
        sort_entries(&mut entries);
    }
    let md = render_directory_markdown_entries(&entries, base_path);
    if accept_hdr.contains("text/markdown") {
        ("text/markdown".to_string(), md)
    } else {
        let body = String::from_utf8(md_to_html_bytes(&md)).unwrap_or_default();
        (
            "text/html; charset=utf-8".to_string(),
            simple_html_page("Directory", &body, branch, repo),
        )
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DirEntry {
    name: String,
    kind: EntryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    date: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
enum EntryKind {
    File,
    Dir,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct DirCacheFile {
    cid: String,
    repo: String,
    branch: String,
    dir: String, // base_path
    generated_at: String,
    entries: Vec<DirEntry>,
}

fn git_dir_entries(
    repo_path: &PathBuf,
    listing_tree: &git2::Tree,
    base_path: &str,
    branch: &str,
) -> Vec<DirEntry> {
    // Sizes for blobs; dates left None for now (can be enhanced using revwalk per path)
    let mut out: Vec<DirEntry> = Vec::new();
    let head_time = head_commit_time(repo_path, branch).map(|secs| secs.to_string());
    for entry in listing_tree.iter() {
        let name = match entry.name() {
            Some(n) => n.to_string(),
            None => continue,
        };
        match entry.kind() {
            Some(git2::ObjectType::Tree) => {
                out.push(DirEntry {
                    name,
                    kind: EntryKind::Dir,
                    size: None,
                    date: head_time.clone(),
                });
            }
            Some(git2::ObjectType::Blob) => {
                let size = Repository::open_bare(repo_path)
                    .and_then(|r| r.find_blob(entry.id()).map(|b| b.size()))
                    .ok()
                    .map(|s| s as u64);
                out.push(DirEntry {
                    name,
                    kind: EntryKind::File,
                    size,
                    date: head_time.clone(),
                });
            }
            _ => {}
        }
    }
    out
}

fn head_commit_time(repo_path: &PathBuf, branch: &str) -> Option<i64> {
    let repo = Repository::open_bare(repo_path).ok()?;
    let refname = format!("refs/heads/{}", branch);
    let reference = repo.find_reference(&refname).ok()?;
    let commit = reference.peel_to_commit().ok()?;
    Some(commit.time().seconds())
}

fn sort_entries(entries: &mut Vec<DirEntry>) {
    entries.sort_by(|a, b| match (&a.kind, &b.kind) {
        (EntryKind::Dir, EntryKind::File) => std::cmp::Ordering::Less,
        (EntryKind::File, EntryKind::Dir) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
}

fn ipfs_dir_entries_cached(
    repo: &str,
    branch: &str,
    base_path: &str,
    cid: &str,
) -> anyhow::Result<Vec<DirEntry>> {
    // Cache under: <cache_root>/<repo|_>/<branch>/.ipfs-dircache/<base_path or _root>.json
    let cache_root = std::env::var("RELAY_IPFS_CACHE_ROOT")
        .unwrap_or_else(|_| DEFAULT_IPFS_CACHE_ROOT.to_string());
    let repo_dir = if repo.is_empty() { "_" } else { repo };
    let dir_key = {
        let bp = base_path.trim_matches('/');
        if bp.is_empty() {
            "_root".to_string()
        } else {
            bp.replace('/', "_")
        }
    };
    let dircache_dir = std::path::Path::new(&cache_root)
        .join(repo_dir)
        .join(branch)
        .join(".ipfs-dircache");
    // Invalidate cache if CID changed: store marker file and remove cache files when mismatched
    let cid_marker = dircache_dir.join("_CID");
    if let Ok(prev_cid) = std::fs::read_to_string(&cid_marker) {
        if prev_cid.trim() != cid {
            let _ = std::fs::create_dir_all(&dircache_dir);
            if let Ok(entries) = std::fs::read_dir(&dircache_dir) {
                for e in entries.flatten() {
                    // keep the marker file, remove others
                    if e.path() != cid_marker {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
            let _ = std::fs::write(&cid_marker, cid.as_bytes());
        }
    } else {
        let _ = std::fs::create_dir_all(&dircache_dir);
        let _ = std::fs::write(&cid_marker, cid.as_bytes());
    }
    let cache_file = dircache_dir.join(format!("{}.json", dir_key));
    // Attempt to read
    if let Ok(bytes) = std::fs::read(&cache_file) {
        if let Ok(dc) = serde_json::from_slice::<DirCacheFile>(&bytes) {
            if dc.cid == cid && dc.dir == base_path {
                return Ok(dc.entries);
            }
        }
    }
    // Build fresh via `ipfs dag get` (preferred) or fallback to `ipfs ls` and store
    let ipfs_path = if base_path.trim_matches('/').is_empty() {
        format!("/ipfs/{}", cid)
    } else {
        format!("/ipfs/{}/{}", cid, base_path.trim_matches('/'))
    };
    // Try object links (JSON)
    let mut entries: Vec<DirEntry> = Vec::new();
    let dag_out = std::process::Command::new("ipfs")
        .arg("object")
        .arg("links")
        .arg(&ipfs_path)
        .arg("--enc=json")
        .env(
            "IPFS_PATH",
            std::env::var("IPFS_PATH").unwrap_or_else(|_| DEFAULT_IPFS_PATH.to_string()),
        )
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .output();
    let use_ls_fallback: bool;
    match dag_out {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&stdout) {
                let links = val.get("Links").or_else(|| val.get("links"));
                if let Some(arr) = links.and_then(|l| l.as_array()) {
                    for link in arr {
                        let name = link
                            .get("Name")
                            .or_else(|| link.get("name"))
                            .and_then(|s| s.as_str())
                            .unwrap_or("");
                        if name.is_empty() {
                            continue;
                        }
                        let size = link
                            .get("Size")
                            .or_else(|| link.get("size"))
                            .and_then(|n| n.as_u64());
                        // Without type info, treat size==0 as dir, else file
                        let is_dir = size == Some(0);
                        entries.push(DirEntry {
                            name: name.to_string(),
                            kind: if is_dir {
                                EntryKind::Dir
                            } else {
                                EntryKind::File
                            },
                            size,
                            date: None,
                        });
                    }
                }
                use_ls_fallback = entries.is_empty();
            } else {
                use_ls_fallback = true;
            }
        }
        _ => {
            use_ls_fallback = true;
        }
    }
    if use_ls_fallback {
        let out = std::process::Command::new("ipfs")
            .arg("ls")
            .arg("--size")
            .arg(&ipfs_path)
            .env(
                "IPFS_PATH",
                std::env::var("IPFS_PATH").unwrap_or_else(|_| DEFAULT_IPFS_PATH.to_string()),
            )
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()?;
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            anyhow::bail!("ipfs ls failed: {}", stderr);
        }
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.lines() {
            let parts: Vec<&str> = line.split_whitespace().collect();
            // Expected: CID Size Name
            if parts.len() >= 3 {
                let name = parts[2].to_string();
                let size = parts.get(1).and_then(|s| s.parse::<u64>().ok());
                let is_dir = name.ends_with('/') || size == Some(0);
                entries.push(DirEntry {
                    name: name.trim_end_matches('/').to_string(),
                    kind: if is_dir {
                        EntryKind::Dir
                    } else {
                        EntryKind::File
                    },
                    size,
                    date: None,
                });
            } else if parts.len() == 2 {
                let name = parts[1].to_string();
                entries.push(DirEntry {
                    name: name.trim_end_matches('/').to_string(),
                    kind: EntryKind::File,
                    size: None,
                    date: None,
                });
            }
        }
    }
    // Save cache
    let _ = std::fs::create_dir_all(&dircache_dir);
    let dc = DirCacheFile {
        cid: cid.to_string(),
        repo: repo.to_string(),
        branch: branch.to_string(),
        dir: base_path.to_string(),
        generated_at: format!(
            "{}",
            match std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH) {
                Ok(d) => d.as_secs(),
                Err(_) => 0,
            }
        ),
        entries: entries.clone(),
    };
    if let Ok(bytes) = serde_json::to_vec_pretty(&dc) {
        let _ = std::fs::write(&cache_file, bytes);
    }
    Ok(entries)
}

fn render_directory_markdown_entries(entries: &Vec<DirEntry>, base_path: &str) -> Vec<u8> {
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
    // Table header
    lines.push(String::from("| Name | Size | Date |"));
    lines.push(String::from("|------|------:|------|"));
    for e in entries {
        let href = if base_path.is_empty() {
            e.name.clone()
        } else {
            format!("{}/{}", base_path.trim_matches('/'), e.name)
        };
        let disp_name = if e.kind == EntryKind::Dir {
            format!("{}/", e.name)
        } else {
            e.name.clone()
        };
        let size_disp = e
            .size
            .map(|n| format!("{}", n))
            .unwrap_or_else(|| "".to_string());
        let date_disp = e.date.clone().unwrap_or_default();
        let link = if e.kind == EntryKind::Dir {
            format!("[{}]({}/)", disp_name, href)
        } else {
            format!("[{}]({})", disp_name, href)
        };
        lines.push(format!("| {} | {} | {} |", link, size_disp, date_disp));
    }
    if entries.is_empty() {
        lines.push(String::from("(empty directory)"));
    }
    lines.join("\n").into_bytes()
}

fn render_404_markdown(
    repo_path: &PathBuf,
    branch: &str,
    repo: &str,
    missing_path: &str,
) -> Response {
    // Determine parent directory of the missing path for theme.css lookup
    let parent_dir = {
        let trimmed = missing_path.trim_matches('/');
        std::path::Path::new(trimmed)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| "".to_string())
    };
    // Try to read /site/404.md from the same branch
    let custom = read_file_from_repo(repo_path, branch, "site/404.md").ok();

    // We'll build the body HTML and the CSS hrefs while keeping repo lifetimes scoped
    let used_custom = custom.is_some();
    let mut body_html: String = match custom {
        Some(ref bytes) => String::from_utf8(md_to_html_bytes(&bytes)).unwrap_or_default(),
        None => String::from_utf8(md_to_html_bytes(
            relay_lib::assets::DEFAULT_404_MD.as_bytes(),
        ))
        .unwrap_or_default(),
    };

    if let Ok(repo) = Repository::open_bare(repo_path) {
        let refname = format!("refs/heads/{}", branch);
        if let Ok(reference) = repo.find_reference(&refname) {
            if let Ok(commit) = reference.peel_to_commit() {
                if let Ok(root) = commit.tree() {
                    // If we used the default 404 content, append a parent directory listing
                    if !used_custom {
                        let tree_to_list = if parent_dir.is_empty() {
                            Some(root)
                        } else {
                            match root.get_path(std::path::Path::new(&parent_dir)) {
                                Ok(e) if e.kind() == Some(ObjectType::Tree) => {
                                    repo.find_tree(e.id()).ok()
                                }
                                _ => Some(root),
                            }
                        };
                        if let Some(t) = tree_to_list {
                            let md = render_directory_markdown(&t, &parent_dir);
                            let dir_html =
                                String::from_utf8(md_to_html_bytes(&md)).unwrap_or_default();
                            body_html.push_str("\n\n");
                            body_html.push_str(&dir_html);
                        }
                    }
                }
            }
        }
    }

    let wrapped = simple_html_page("Not Found", &body_html, branch, repo);
    (
        StatusCode::NOT_FOUND,
        [
            ("Content-Type", "text/html; charset=utf-8".to_string()),
            (HEADER_BRANCH, branch.to_string()),
            (HEADER_REPO, repo.to_string()),
        ],
        wrapped,
    )
        .into_response()
}

// Use bundled default 404 markdown from relay-lib assets

fn write_file_to_repo(
    repo_path: &PathBuf,
    branch: &str,
    path: &str,
    content: &[u8],
) -> anyhow::Result<(String, String)> {
    let repo = Repository::open_bare(repo_path)?;
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

    // Run repo pre-commit script (.relay/pre-commit.mjs) if present in the new commit
    {
        let node_bin = std::env::var("RELAY_NODE_BIN").unwrap_or_else(|_| "node".to_string());
        if let Ok(new_commit_obj) = repo.find_commit(commit_oid) {
            if let Ok(tree) = new_commit_obj.tree() {
                use std::io::Write as _;
                if let Ok(entry) = tree.get_path(std::path::Path::new(".relay/pre-commit.mjs")) {
                    if let Ok(blob) = entry.to_object(&repo).and_then(|o| o.peel_to_blob()) {
                        let tmp_path = std::env::temp_dir()
                            .join(format!("relay-pre-commit-{}-{}.mjs", branch, commit_oid));
                        if let Ok(_) = std::fs::write(&tmp_path, blob.content()) {
                            let mut cmd = std::process::Command::new(node_bin);
                            cmd.arg(&tmp_path)
                                .env("GIT_DIR", repo.path())
                                .env("OLD_COMMIT", parent_commit.as_ref().map(|c| c.id().to_string()).unwrap_or_else(|| String::from("0000000000000000000000000000000000000000")))
                                .env("NEW_COMMIT", commit_oid.to_string())
                                .env("REFNAME", &refname)
                                .env("BRANCH", branch)
                                .stdout(std::process::Stdio::piped())
                                .stderr(std::process::Stdio::piped());
                            match cmd.output() {
                                Ok(output) => {
                                    if !output.status.success() {
                                        let stderr = String::from_utf8_lossy(&output.stderr);
                                        error!(%stderr, "pre-commit.mjs rejected commit");
                                        anyhow::bail!("commit rejected by pre-commit.mjs: {}", stderr.trim());
                                    }
                                }
                                Err(e) => {
                                    anyhow::bail!("failed to execute pre-commit.mjs: {}", e);
                                }
                            }
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
    repo_path: &PathBuf,
    branch: &str,
    path: &str,
) -> Result<(String, String), ReadError> {
    let repo = Repository::open_bare(repo_path).map_err(|e| ReadError::Other(e.into()))?;
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
