use std::{net::SocketAddr, path::PathBuf, str::FromStr};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, options},
    Json, Router,
};
use tokio::net::TcpListener;
use git2::{Oid, Repository, Signature, ObjectType};
use percent_encoding::percent_decode_str as url_decode;
// base64 no longer needed after removing SQLite row mapping
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info};
use pulldown_cmark::{html, Parser};
use std::collections::HashMap;
use tower_http::trace::TraceLayer;
use tracing_appender::rolling;
use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt};

#[derive(Clone)]
struct AppState {
    repo_path: PathBuf,
}

const HEADER_BRANCH: &str = "X-Relay-Branch";
const HEADER_REPO: &str = "X-Relay-Repo";
const DEFAULT_BRANCH: &str = "main";
// Disallowed extensions for general access; JavaScript is now allowed to be loaded (GET)
// but remains blocked for writes via PUT/DELETE (enforced below and by hooks).
const DISALLOWED: &[&str] = &[".html", ".htm"];

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Set up logging: stdout + rolling file appender
    // Ensure logs directory exists
    let _ = std::fs::create_dir_all("logs");
    let file_appender = rolling::daily("logs", "server.log");
    let (file_nb, _guard) = tracing_appender::non_blocking(file_appender);
    let env_filter = tracing_subscriber::EnvFilter::from_default_env();
    let stdout_layer = fmt::layer().with_target(true).with_thread_ids(false).with_thread_names(false).compact();
    let file_layer = fmt::layer().with_writer(file_nb).with_target(true).compact();
    tracing_subscriber::registry()
        .with(env_filter)
        .with(stdout_layer)
        .with(file_layer)
        .init();

    let repo_path = std::env::var("RELAY_REPO_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data/repo.git"));
    ensure_bare_repo(&repo_path)?;

    let state = AppState { repo_path };

    // Build router (breaking changes: removed /status and /query/*; OPTIONS is the discovery endpoint)
    let app = Router::new()
        .route("/openapi.yaml", get(get_openapi_yaml))
        .route("/swagger-ui", get(get_swagger_ui))
        .route("/env", axum::routing::post(post_env))
        .route("/", get(get_root).options(options_capabilities))
        .route("/*path", get(get_file).put(put_file).delete(delete_file).options(options_capabilities))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    // Start background tracker registration task if env is configured
    start_tracker_registration().await;

    let bind = std::env::var("RELAY_BIND").unwrap_or_else(|_| "0.0.0.0:8088".into());
    let addr = SocketAddr::from_str(&bind)?;
    info!(%addr, "Relay server listening");
    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

/// Spawn a background task that periodically registers this server's socket and repos to the tracker.
async fn start_tracker_registration() {
    let tracker_url = std::env::var("RELAY_TRACKER_URL").ok();
    let socket_url = std::env::var("RELAY_SOCKET_URL").ok();
    if tracker_url.is_none() || socket_url.is_none() {
        info!("tracker registration disabled (RELAY_TRACKER_URL or RELAY_SOCKET_URL not set)");
        return;
    }
    let tracker = tracker_url.unwrap();
    let socket = socket_url.unwrap();
    let repo_path = std::env::var("RELAY_REPO_PATH").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("data/repo.git"));
    let branch_env = std::env::var("RELAY_REGISTER_BRANCH").unwrap_or_else(|_| DEFAULT_BRANCH.to_string());
    // Allow static repo list override via env (comma-separated)
    let repos_env = std::env::var("RELAY_REPOS").ok();

    tokio::spawn(async move {
        let client = reqwest::Client::new();
        loop {
            let repos_list: Vec<String> = if let Some(env_list) = &repos_env {
                env_list
                    .split(',')
                    .map(|s| s.trim().trim_matches('/').to_string())
                    .filter(|s| !s.is_empty())
                    .collect()
            } else {
                // Discover by reading top-level directories on selected branch
                match list_repos(&repo_path, &branch_env) {
                    Ok(v) => v,
                    Err(_) => Vec::new(),
                }
            };
            // Build branches array with commit heads for each branch, optionally expand per repo
            let heads = list_branch_heads(&repo_path)
                .into_iter()
                .map(|(branch, commit)| serde_json::json!({"branch": branch, "commit": commit}))
                .collect::<Vec<_>>();
            // Expand heads per repo to include repo name for tracker schema
            let mut branches_per_repo: Vec<serde_json::Value> = Vec::new();
            for r in &repos_list {
                for h in &heads {
                    let mut obj = h.clone();
                    if let Some(map) = obj.as_object_mut() {
                        map.insert("repo".to_string(), serde_json::Value::String(r.clone()));
                    }
                    branches_per_repo.push(obj);
                }
            }
            let body = serde_json::json!({ "socket": socket, "repos": repos_list, "branches": branches_per_repo });
            let url = format!("{}/api/peers/upsert", tracker.trim_end_matches('/'));
            match client.post(&url).json(&body).send().await {
                Ok(resp) => {
                    if resp.status().is_success() {
                        info!(%socket, tracker = %tracker, "registered with tracker");
                    } else {
                        let code = resp.status();
                        let text = resp.text().await.unwrap_or_default();
                        error!(%socket, %code, %text, "tracker registration failed");
                    }
                }
                Err(e) => {
                    error!(error = %e, "tracker registration request error");
                }
            }
            // Sleep 5 minutes
            tokio::time::sleep(std::time::Duration::from_secs(300)).await;
        }
    });
}

// Serve the bundled OpenAPI YAML specification
async fn get_openapi_yaml() -> impl IntoResponse {
    (
        StatusCode::OK,
        [("Content-Type", "application/yaml")],
        relay_lib::assets::OPENAPI_YAML,
    )
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
    (
        StatusCode::OK,
        [("Content-Type", "text/html")],
        html,
    )
}

/// Parse simple KEY=VALUE lines from a .env-like string. Ignores comments and blank lines.
fn parse_dotenv(s: &str) -> std::collections::HashMap<String, String> {
    let mut map = std::collections::HashMap::new();
    for line in s.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }
        let mut parts = line.splitn(2, '=');
        let k = parts.next().unwrap_or("").trim();
        let v = parts.next().unwrap_or("").trim();
        if k.is_empty() { continue; }
        // Strip surrounding quotes if present
        let val = if (v.starts_with('"') && v.ends_with('"')) || (v.starts_with('\'') && v.ends_with('\'')) {
            v[1..v.len().saturating_sub(1)].to_string()
        } else { v.to_string() };
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
        read_file_from_repo(&state.repo_path, &branch, name).ok().and_then(|b| String::from_utf8(b).ok())
    };
    if let Some(env_txt) = from_repo(".env") {
        for (k, v) in parse_dotenv(&env_txt) { merged.entry(k).or_insert(v); }
    }
    if let Some(env_local_txt) = from_repo(".env.local") {
        for (k, v) in parse_dotenv(&env_local_txt) { merged.insert(k, v); }
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
        let _ = Repository::open_bare(path) ?;
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
    let repo_name = repo_from(&state.repo_path, &headers, &query.as_ref().map(|q| q.0.clone()), &branch);

    // Enumerate branches and repos
    let (mut branches, mut repos, mut branch_heads): (Vec<String>, Vec<String>, Vec<(String, String)>) = match Repository::open_bare(&state.repo_path) {
        Ok(repo) => {
            let branches = list_branches(&repo);
            let repos = list_repos(&state.repo_path, &branch).unwrap_or_default();
            let heads = list_branch_heads(&state.repo_path);
            (branches, repos, heads)
        }
        Err(_) => (Vec::new(), Vec::new(), Vec::new()),
    };

    // Filter by requested branch (if explicitly set via header/query/cookie)
    if let Some(req_branch) = query.as_ref().and_then(|q| q.0.get("branch").cloned()).or_else(|| headers.get(HEADER_BRANCH).and_then(|v| v.to_str().ok()).map(|s| s.to_string())) {
        if !req_branch.is_empty() {
            branches.retain(|b| b == &req_branch);
            branch_heads.retain(|(b, _)| b == &req_branch);
        }
    }
    // Filter repos list by requested repo (if present); also limit branch heads to those branches where the repo exists
    if let Some(req_repo) = query.as_ref().and_then(|q| q.0.get("repo").cloned()).or_else(|| headers.get(HEADER_REPO).and_then(|v| v.to_str().ok()).map(|s| s.to_string())) {
        if !req_repo.is_empty() {
            repos.retain(|r| r == &req_repo);
            // Keep only heads for branches where this repo exists
            branch_heads.retain(|(b, _)| {
                if let Ok(list) = list_repos(&state.repo_path, b) { list.iter().any(|r| r == &req_repo) } else { false }
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
        [("Allow", allow.to_string()), (HEADER_BRANCH, branch), (HEADER_REPO, repo_name.clone().unwrap_or_default())],
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
                        if let Ok(reference) = repo.find_reference(&format!("refs/heads/{}", name)) {
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

#[derive(Deserialize)]
struct QueryRequest {
    #[serde(default)]
    page: Option<u32>,
    #[serde(default, rename = "pageSize")]
    page_size: Option<u32>,
    #[serde(default)]
    filter: Option<serde_json::Value>,
    #[serde(default)]
    sort: Option<Vec<relay_lib::db::SortSpec>>, // optional override
    #[serde(default)]
    params: Option<serde_json::Value>, // legacy alias for filter
}

#[derive(Serialize)]
struct QueryResponse {
    items: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<i64>,
    page: usize,
    #[serde(rename = "pageSize")]
    page_size: usize,
    branch: String,
}

async fn post_query(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Option<Json<serde_json::Value>>,
) -> impl IntoResponse {
    use relay_lib::db::{Db, DbSpec, QueryParams};
    // Resolve branch (allow 'all')
    let branch = headers
        .get(HEADER_BRANCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BRANCH)
        .to_string();
    let req: QueryRequest = match body {
        Some(Json(v)) => serde_json::from_value(v).unwrap_or(QueryRequest { page: Some(0), page_size: Some(25), filter: None, sort: None, params: None }),
        None => QueryRequest { page: Some(0), page_size: Some(25), filter: None, sort: None, params: None },
    };

    // Open repo and read rules (for db spec)
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let rules_bytes = match read_file_from_repo(&state.repo_path, DEFAULT_BRANCH, "relay.yaml") {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "relay.yaml not found on default branch").into_response(),
    };
    let rules_yaml = String::from_utf8_lossy(&rules_bytes);
    let rules_val: serde_json::Value = match serde_yaml::from_str::<serde_json::Value>(&rules_yaml) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("invalid relay.yaml: {e}")).into_response(),
    };
    let db_val = match rules_val.get("db") {
        Some(v) => v.clone(),
        None => return (StatusCode::BAD_REQUEST, "rules.db not defined").into_response(),
    };
    let spec: DbSpec = match serde_json::from_value(db_val) {
        Ok(s) => s,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("invalid rules.db spec: {e}")).into_response(),
    };
    if spec.engine.to_lowercase() != "polodb" {
        return (StatusCode::BAD_REQUEST, format!("unsupported db.engine: {}", spec.engine)).into_response();
    }
    // Resolve DB path: env RELAY_DB_PATH or default under repo git dir
    let db_path = std::env::var("RELAY_DB_PATH").unwrap_or_else(|_| {
        repo.path().join("relay_index.polodb").to_string_lossy().to_string()
    });
    let db = match Db::open(&db_path) { Ok(d) => d, Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("DB open failed: {e}")).into_response() };
    if let Err(e) = db.ensure_indexes(&spec) {
        return (StatusCode::INTERNAL_SERVER_ERROR, format!("ensure indexes failed: {e}")).into_response();
    }
    // Build query params
    let mut qp = QueryParams::default();
    qp.page = req.page;
    qp.page_size = req.page_size;
    qp.sort = req.sort.clone();
    qp.filter = if let Some(f) = req.filter { Some(f) } else { req.params };
    let qr = match db.query(&spec, Some(&branch), &qp) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("query failed: {e}")).into_response(),
    };
    let resp = QueryResponse {
        items: serde_json::Value::Array(qr.items),
        total: Some(qr.total as i64),
        page: qr.page as usize,
        page_size: qr.page_size as usize,
        branch,
    };
    (StatusCode::OK, Json(resp)).into_response()
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
        let new_pq = if let Some(q) = orig_query { format!("{}?{}", new_path, q) } else { new_path };
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
    use git2::Repository;
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
        let (ct, bytes) = directory_response(&repo_path, &tree, &tree, "", "text/markdown", DEFAULT_BRANCH, "");
        assert_eq!(ct, "text/markdown");
        let s = String::from_utf8(bytes).unwrap();
        assert!(s.contains("# Title") || s.contains("README.md"));
    }
    
    #[test]
    fn test_row_to_json_basic_types_removed() {}
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
        if !h.is_empty() { return h.to_string(); }
    }
    if let Some(cookie_hdr) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            let mut kv = part.trim().splitn(2, '=');
            let k = kv.next().unwrap_or("").trim();
            let v = kv.next().unwrap_or("");
            if k == "relay-branch" && !v.is_empty() { return v.to_string(); }
        }
    }
    DEFAULT_BRANCH.to_string()
}

fn sanitize_repo_name(name: &str) -> Option<String> {
    let trimmed = name.trim().trim_matches('/');
    if trimmed.is_empty() { return None; }
    if trimmed.contains("..") { return None; }
    Some(trimmed.to_string())
}

fn repo_from(repo_path: &PathBuf, headers: &HeaderMap, query: &Option<HashMap<String, String>>, branch: &str) -> Option<String> {
    // Precedence: query ?repo= -> header X-Relay-Repo -> cookie relay-repo -> env RELAY_DEFAULT_REPO -> first in list_repos
    if let Some(q) = query {
        if let Some(r) = q.get("repo").and_then(|s| sanitize_repo_name(s)) { return Some(r); }
    }
    if let Some(h) = headers.get(HEADER_REPO).and_then(|v| v.to_str().ok()).and_then(|s| sanitize_repo_name(s)) {
        return Some(h);
    }
    if let Some(cookie_hdr) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in cookie_hdr.split(';') {
            let mut kv = part.trim().splitn(2, '=');
            let k = kv.next().unwrap_or("").trim();
            let v = kv.next().unwrap_or("");
            if k == "relay-repo" {
                if let Some(s) = sanitize_repo_name(v) { return Some(s); }
            }
        }
    }
    if let Ok(env_def) = std::env::var("RELAY_DEFAULT_REPO") {
        if let Some(s) = sanitize_repo_name(&env_def) { return Some(s); }
    }
    if let Ok(list) = list_repos(repo_path, branch) { return list.into_iter().next(); }
    None
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
            if let Some(name) = entry.name() { out.push(name.to_string()); }
        }
    }
    out.sort();
    Ok(out)
}

async fn get_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    query: Option<Query<HashMap<String, String>>>,
)-> impl IntoResponse {
    info!(%path, "get_file called");
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    info!(decoded = %decoded, "decoded path");
    if disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, "Disallowed file type").into_response();
    }
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(&state.repo_path, &headers, &query.as_ref().map(|q| q.0.clone()), &branch) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                [("Content-Type", "text/plain".to_string()), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, "".to_string())],
                "Repository not found".to_string(),
            ).into_response();
        }
    };
    info!(%branch, "resolved branch");

    // Open repo and branch
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => {
            error!(?e, "open repo error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let refname = format!("refs/heads/{}", branch);
    let reference = match repo.find_reference(&refname) {
        Ok(r) => r,
        Err(_) => {
            return render_404_markdown(&state.repo_path, &branch, &repo_name, &decoded);
        }
    };
    let commit = match reference.peel_to_commit() {
        Ok(c) => c,
        Err(e) => {
            error!(?e, "peel to commit error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(e) => {
            error!(?e, "tree error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };

    // Scope under selected repo
    let path_scoped = {
        let p = decoded.trim_matches('/');
        if p.is_empty() { repo_name.clone() } else { format!("{}/{}", repo_name, p) }
    };
    // Empty path for repo root?
    let rel = path_scoped.trim_matches('/');
    if rel.is_empty() {
        let accept_hdr = headers
            .get("accept")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let (ct, body) = directory_response(&state.repo_path, &tree, &tree, rel, accept_hdr, &branch, &repo_name);
        return (
            StatusCode::OK,
            [("Content-Type", ct), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, repo_name.clone())],
            body,
        )
            .into_response();
    }

    // Try to resolve path within tree
    let path_obj = std::path::Path::new(rel);
    let entry = match tree.get_path(path_obj) {
        Ok(e) => e,
        Err(_) => {
            return render_404_markdown(&state.repo_path, &branch, &repo_name, rel);
        }
    };
    match entry.kind() {
        Some(ObjectType::Blob) => {
            match repo.find_blob(entry.id()) {
                Ok(blob) => {
                    // If file looks like markdown (.md, .markdown), decide whether to
                    // serve raw markdown or render to HTML depending on Accept header.
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
                        // Serve raw markdown
                        return (
                            StatusCode::OK,
                            [("Content-Type", "text/markdown".to_string()), (HEADER_BRANCH, branch.clone())],
                            content.to_vec(),
                        )
                            .into_response();
                    } else {
                        // Render to HTML, wrap with CSS links and global JS module based on directory theme and site globals
                        let html_frag = String::from_utf8(md_to_html_bytes(content)).unwrap_or_default();
                        let base_dir = std::path::Path::new(rel)
                            .parent()
                            .map(|p| p.to_string_lossy().to_string())
                            .unwrap_or_else(|| "".to_string());
                        // let css = css_hrefs_for(&tree, &base_dir, &branch);
                        // let js = js_hrefs_for(&tree, &branch);
                        let title = std::path::Path::new(rel).file_name().and_then(|s| s.to_str()).unwrap_or("Document");
                        let wrapped = wrap_html_with_assets(title, &html_frag, &branch, &repo_name, &state.repo_path, &base_dir);
                        return (
                            StatusCode::OK,
                            [("Content-Type", "text/html; charset=utf-8".to_string()), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, repo_name.clone())],
                            wrapped,
                        )
                            .into_response();
                    }
                    }
                    // Non-markdown: serve with detected mime
                    let ct = mime_guess::from_path(rel).first_or_octet_stream().essence_str().to_string();
                    (StatusCode::OK, [("Content-Type", ct), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, repo_name.clone())], blob.content().to_vec()).into_response()
                }
                Err(e) => {
                    error!(?e, "blob read error");
                    StatusCode::INTERNAL_SERVER_ERROR.into_response()
                }
            }
        }
        Some(ObjectType::Tree) => {
            // Directory listing
            let sub_tree = match repo.find_tree(entry.id()) {
                Ok(t) => t,
                Err(e) => {
                    error!(?e, "subtree error");
                    return StatusCode::INTERNAL_SERVER_ERROR.into_response();
                }
            };
            let accept_hdr = headers
                .get("accept")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
                let (ct, body) = directory_response(&state.repo_path, &tree, &sub_tree, rel, accept_hdr, &branch, &repo_name);
                (StatusCode::OK, [("Content-Type", ct), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, repo_name.clone())], body).into_response()
        }
        _ => render_404_markdown(&state.repo_path, &branch, &repo_name, rel),
    }
}

async fn get_root(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // Explicitly implement root directory listing to avoid extractor mismatch
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(&state.repo_path, &headers, &query.as_ref().map(|q| q.0.clone()), &branch) {
        Some(r) => r,
        None => {
            return (
                StatusCode::NOT_FOUND,
                [("Content-Type", "text/plain".to_string()), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, "".to_string())],
                "Repository not found".to_string(),
            ).into_response();
        }
    };
    info!(%branch, "get_root resolved branch");
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => {
            error!(?e, "open repo error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let refname = format!("refs/heads/{}", branch);
    let reference = match repo.find_reference(&refname) {
        Ok(r) => r,
        Err(_) => {
            return render_404_markdown(&state.repo_path, &branch, &repo_name, "");
        }
    };
    let commit = match reference.peel_to_commit() {
        Ok(c) => c,
        Err(e) => {
            error!(?e, "peel to commit error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let tree = match commit.tree() {
        Ok(t) => t,
        Err(e) => {
            error!(?e, "tree error");
            return StatusCode::INTERNAL_SERVER_ERROR.into_response();
        }
    };
    let accept_hdr = headers
        .get("accept")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let (ct, body) = directory_response(&state.repo_path, &tree, &tree, &repo_name, accept_hdr, &branch, &repo_name);
    (StatusCode::OK, [("Content-Type", ct), (HEADER_BRANCH, branch.clone()), (HEADER_REPO, repo_name.clone())], body).into_response()
}

async fn put_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    query: Option<Query<HashMap<String, String>>>,
    body: Bytes,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if write_disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Disallowed file type"}))).into_response();
    }
    // Allow branch from query string too
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    let repo_name = match repo_from(&state.repo_path, &headers, &query.as_ref().map(|q| q.0.clone()), &branch) {
        Some(r) => r,
        None => {
            // Optionally allow creating a new repo directory on PUT
            if std::env::var("RELAY_ALLOW_CREATE_REPO").ok().map(|v| v == "true" || v == "1").unwrap_or(true) {
                // proceed with scoped path even if repo dir doesn't yet exist (tree builder will create)
                String::from("new")
            } else {
                return (StatusCode::NOT_FOUND, Json(serde_json::json!({"error": "Repository not found"}))).into_response();
            }
        }
    };
    let scoped_path = {
        let p = decoded.trim_matches('/');
        if p.is_empty() { repo_name.clone() } else { format!("{}/{}", repo_name, p) }
    };
    match write_file_to_repo(&state.repo_path, &branch, &scoped_path, &body) {
        Ok((commit, branch)) => Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded})).into_response(),
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
    Path(path): Path<String>,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if write_disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Disallowed file type"}))).into_response();
    }
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
    match delete_file_in_repo(&state.repo_path, &branch, &decoded) {
        Ok((commit, branch)) => Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded})).into_response(),
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
            if let Ok(name) = b.name() { if let Some(s) = name { out.push(s.to_string()); } }
        }
    }
    out
}

fn read_file_from_repo(repo_path: &PathBuf, branch: &str, path: &str) -> Result<Vec<u8>, ReadError> {
    let repo = Repository::open_bare(repo_path).map_err(|e| ReadError::Other(e.into()))?;
    let refname = format!("refs/heads/{}", branch);
    let reference = repo.find_reference(&refname).map_err(|_| ReadError::NotFound)?;
    let commit = reference.peel_to_commit().map_err(|_| ReadError::NotFound)?;
    let tree = commit.tree().map_err(|e| ReadError::Other(e.into()))?;
    let entry = tree.get_path(std::path::Path::new(path)).map_err(|_| ReadError::NotFound)?;
    let blob = repo.find_blob(entry.id()).map_err(|e| ReadError::Other(e.into()))?;
    Ok(blob.content().to_vec())
}

fn render_directory_markdown(tree: &git2::Tree, base_path: &str) -> Vec<u8> {
    let mut lines: Vec<String> = Vec::new();
    let title_path = if base_path.is_empty() { "/".to_string() } else { format!("/{}", base_path.trim_matches('/')) };
    lines.push(format!("# Directory listing: {}", title_path));
    // Breadcrumbs
    let mut crumb = String::new();
    crumb.push_str("[/](/)");
    let trimmed = base_path.trim_matches('/');
    if !trimmed.is_empty() {
        let mut acc = String::new();
        for (i, seg) in trimmed.split('/').enumerate() {
            if i == 0 { acc.push_str(seg); } else { acc.push('/'); acc.push_str(seg); }
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
        let name = match entry.name() { Some(n) => n.to_string(), None => continue };
        match entry.kind() {
            Some(git2::ObjectType::Tree) => {
                let href = if base_path.is_empty() { format!("{}", name) } else { format!("{}/{}", base_path.trim_matches('/'), name) };
                dirs.push(format!("- [{0}/]({0}/)", href));
            }
            Some(git2::ObjectType::Blob) => {
                let href = if base_path.is_empty() { format!("{}", name) } else { format!("{}/{}", base_path.trim_matches('/'), name) };
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
    let parser = Parser::new(&s);
    let mut out = String::new();
    html::push_html(&mut out, parser);
    out.into_bytes()
}


// Wrap an HTML fragment using a template resolved from the repo (or bundled fallback)
// Template lookup order:
// 1) Env RELAY_REPO_PATH_TEMPLATE_HTML (filename, default "template.html") in the same directory as the requested asset
// 2) Walk parent directories up to repo root looking for the filename
// 3) Fallback to bundled relay-lib/assets/template.html
// Variables replaced by name: {title}, {head}, {body}
fn wrap_html_with_assets(title: &str, body: &str, branch: &str, repo: &str, repo_path: &PathBuf, base_dir: &str) -> Vec<u8> {
    fn join_rel(base: &str, name: &str) -> String {
        if base.is_empty() { name.to_string() } else { format!("{}/{}", base.trim_matches('/'), name) }
    }
    // Determine template file name
    let tmpl_name = std::env::var("RELAY_REPO_PATH_TEMPLATE_HTML").unwrap_or_else(|_| "template.html".to_string());
    // Try to read template from same dir then ascend
    let mut current = base_dir.trim_matches('/').to_string();
    let template_html: String = loop {
        let candidate_rel = join_rel(&current, &tmpl_name);
        match read_file_from_repo(repo_path, branch, &candidate_rel) {
            Ok(bytes) => {
                break String::from_utf8(bytes).unwrap_or_else(|_| relay_lib::assets::TEMPLATE_HTML.to_string());
            }
            Err(_) => {
                // Ascend
                if current.is_empty() {
                    // Try at repo root explicitly with just the filename
                    if let Ok(bytes) = read_file_from_repo(repo_path, branch, &tmpl_name) {
                        break String::from_utf8(bytes).unwrap_or_else(|_| relay_lib::assets::TEMPLATE_HTML.to_string());
                    }
                    break relay_lib::assets::TEMPLATE_HTML.to_string();
                } else {
                    if let Some(parent) = std::path::Path::new(&current).parent() {
                        current = parent.to_string_lossy().to_string();
                    } else {
                        current.clear();
                    }
                }
            }
        }
    };
    // Compose head: meta + branch marker; callers can extend later if needed
    let mut head = String::new();
    head.push_str("<meta charset=\"utf-8\">\n");
    head.push_str(&format!("<meta name=\"relay-branch\" content=\"{}\">\n", branch));
    head.push_str(&format!("<meta name=\"relay-repo\" content=\"{}\">\n", repo));
    // Do named replacement
    let html = template_html
        .replace("{title}", title)
        .replace("{head}", &head)
        .replace("{body}", body);
    html.into_bytes()
}

// Helper to return directory listing as HTML or markdown depending on Accept header
// root_tree is the tree at repo root (for CSS presence checks), listing_tree is the directory to list
fn directory_response(repo_path: &PathBuf, _root_tree: &git2::Tree, listing_tree: &git2::Tree, base_path: &str, accept_hdr: &str, branch: &str, repo: &str) -> (String, Vec<u8>) {
    let md = render_directory_markdown(listing_tree, base_path);
    if accept_hdr.contains("text/markdown") {
        ("text/markdown".to_string(), md)
    } else {
        let body = String::from_utf8(md_to_html_bytes(&md)).unwrap_or_default();
        ("text/html; charset=utf-8".to_string(), wrap_html_with_assets("Directory", &body, branch, repo, repo_path, base_path))
    }
}

fn render_404_markdown(repo_path: &PathBuf, branch: &str, repo: &str, missing_path: &str) -> Response {
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
        None => String::from_utf8(md_to_html_bytes(relay_lib::assets::DEFAULT_404_MD.as_bytes())).unwrap_or_default(),
    };

    if let Ok(repo) = Repository::open_bare(repo_path) {
        let refname = format!("refs/heads/{}", branch);
        if let Ok(reference) = repo.find_reference(&refname) {
            if let Ok(commit) = reference.peel_to_commit() {
                if let Ok(root) = commit.tree() {
                    // If we used the default 404 content, append a parent directory listing
                    if !used_custom {
                        let tree_to_list = if parent_dir.is_empty() { Some(root) } else {
                            match root.get_path(std::path::Path::new(&parent_dir)) {
                                Ok(e) if e.kind() == Some(ObjectType::Tree) => repo.find_tree(e.id()).ok(),
                                _ => Some(root),
                            }
                        };
                        if let Some(t) = tree_to_list {
                            let md = render_directory_markdown(&t, &parent_dir);
                            let dir_html = String::from_utf8(md_to_html_bytes(&md)).unwrap_or_default();
                            body_html.push_str("\n\n");
                            body_html.push_str(&dir_html);
                        }
                    }
                }
            }
        }
    }

    let wrapped = wrap_html_with_assets("Not Found", &body_html, branch, repo, repo_path, &parent_dir);
    (
        StatusCode::NOT_FOUND,
        [("Content-Type", "text/html; charset=utf-8".to_string()), (HEADER_BRANCH, branch.to_string()), (HEADER_REPO, repo.to_string())],
        wrapped,
    )
    .into_response()
}

// Use bundled default 404 markdown from relay-lib assets

fn write_file_to_repo(repo_path: &PathBuf, branch: &str, path: &str, content: &[u8]) -> anyhow::Result<(String, String)> {
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

    // If this is a meta.json being written, validate against rules.metaSchema from default branch relay.yaml
    if path.ends_with("meta.json") {
        // Attempt to read relay.yaml from default branch
        if let Ok(bytes) = read_file_from_repo(repo_path, DEFAULT_BRANCH, "relay.yaml") {
            if let Ok(rules_yaml) = String::from_utf8(bytes) {
                if let Ok(rules_val) = serde_yaml::from_str::<serde_json::Value>(&rules_yaml) {
                    if let Some(meta_schema) = rules_val.get("metaSchema") {
                        // Compile schema and validate
                        // Leak to satisfy jsonschema static lifetime requirement
                        let leaked_schema: &'static serde_json::Value = Box::leak(Box::new(meta_schema.clone()));
                        let compiled = jsonschema::JSONSchema::compile(leaked_schema)
                            .map_err(|e| anyhow::anyhow!("invalid metaSchema in relay.yaml: {}", e))?;
                        let meta_json: serde_json::Value = serde_json::from_slice(content)
                            .map_err(|e| anyhow::anyhow!("meta.json is not valid JSON: {}", e))?;
                        if !compiled.is_valid(&meta_json) {
                            let mut msgs: Vec<String> = Vec::new();
                            if let Err(errors) = compiled.validate(&meta_json) {
                                for e in errors {
                                    msgs.push(format!("{} at {}", e, e.instance_path));
                                }
                            }
                            return Err(anyhow::anyhow!("meta.json failed schema validation: {}", msgs.join("; ")));
                        }
                    }
                }
            }
        }
    }

    // Update tree recursively for the path
    let mut components: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if components.is_empty() { anyhow::bail!("empty path"); }
    let filename = components.pop().unwrap().to_string();

    // Helper to descend and produce updated subtree oid
    fn upsert_path(repo: &Repository, tree: &git2::Tree, comps: &[&str], filename: &str, blob_oid: Oid) -> anyhow::Result<Oid> {
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

    // Run pre-receive hook via relay-hooks binary
    // Provide stdin: "<old> <new> <ref>\n"
    let old_oid = parent_commit.as_ref().map(|c| c.id()).unwrap_or_else(|| Oid::zero());
    let hook_input = format!("{} {} {}\n", old_oid, commit_oid, &refname);
    let hook_bin = std::env::var("RELAY_HOOKS_BIN").unwrap_or_else(|_| "relay-hooks".to_string());
    let mut cmd = std::process::Command::new(hook_bin);
    cmd.arg("--hook").arg("pre-receive")
        .env("GIT_DIR", repo.path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| anyhow::anyhow!("failed to spawn relay-hooks: {}", e))?;
    if let Some(mut stdin) = child.stdin.take() { use std::io::Write; let _ = stdin.write_all(hook_input.as_bytes()); }
    let output = child.wait_with_output().map_err(|e| anyhow::anyhow!("failed waiting for relay-hooks: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!(%stderr, status = ?output.status, "pre-receive hook rejected commit");
        anyhow::bail!("commit rejected by hooks: {}", stderr.trim());
    }

    // Update ref to new commit
    match repo.find_reference(&refname) {
        Ok(mut r) => { r.set_target(commit_oid, &msg)?; },
        Err(_) => { repo.reference(&refname, commit_oid, true, &msg)?; }
    }

    // Optional: run update hook (best-effort)
    let _ = std::process::Command::new(std::env::var("RELAY_HOOKS_BIN").unwrap_or_else(|_| "relay-hooks".to_string()))
        .arg("--hook").arg("update")
        .env("GIT_DIR", repo.path())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status();

    Ok((commit_oid.to_string(), branch.to_string()))
}

fn delete_file_in_repo(repo_path: &PathBuf, branch: &str, path: &str) -> Result<(String, String), ReadError> {
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
    fn remove_path(repo: &Repository, tree: &git2::Tree, comps: &[&str], filename: &str) -> anyhow::Result<Option<Oid>> {
        let mut tb = repo.treebuilder(Some(tree))?;
        if comps.is_empty() {
            // remove file
            if tb.remove(filename).is_err() { return Ok(None); }
            return Ok(Some(tb.write()?));
        }
        let head = comps[0];
        let entry = match tree.get_name(head) { Some(e) => e, None => return Ok(None) };
        if entry.kind() != Some(ObjectType::Tree) { return Ok(None); }
        let subtree = repo.find_tree(entry.id())?;
        if let Some(new_sub_oid) = remove_path(repo, &subtree, &comps[1..], filename)? {
            let mut tb2 = repo.treebuilder(Some(tree))?;
            tb2.insert(head, new_sub_oid, 0o040000)?;
            return Ok(Some(tb2.write()?));
        }
        Ok(None)
    }

    let mut comps: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if comps.is_empty() { return Err(ReadError::NotFound); }
    let filename = comps.pop().unwrap().to_string();
    let new_oid_opt = remove_path(&repo, &base_tree, &comps, &filename).map_err(|e| ReadError::Other(e))?;
    let new_oid = match new_oid_opt { Some(oid) => oid, None => return Err(ReadError::NotFound) };
    let new_tree = repo.find_tree(new_oid).map_err(|e| ReadError::Other(e.into()))?;
    let msg = format!("DELETE {}", path);
    let commit_oid = if let Some(ref parent) = parent_commit {
        repo
            .commit(Some(&refname), &sig, &sig, &msg, &new_tree, &[parent])
            .map_err(|e| ReadError::Other(e.into()))?
    } else {
        repo
            .commit(Some(&refname), &sig, &sig, &msg, &new_tree, &[])
            .map_err(|e| ReadError::Other(e.into()))?
    };
    Ok((commit_oid.to_string(), branch.to_string()))
}
