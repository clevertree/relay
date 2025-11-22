use std::{net::SocketAddr, path::PathBuf, str::FromStr};

use axum::{
    body::Bytes,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
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

    // Middleware to support custom QUERY method as an alias for POST /query/*
    // If a request comes in with method "QUERY" to any path like "/foo/bar",
    // we rewrite it to a POST request targeting "/query/foo/bar" (preserving the query string).
    let app = Router::new()
        .route("/status", post(post_status))
        .route("/openapi.yaml", get(get_openapi_yaml))
        .route("/query/*path", post(post_query))
        .route("/", get(get_root))
        .route("/*path", get(get_file).put(put_file).delete(delete_file))
        .layer(axum::middleware::from_fn(query_alias_middleware))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let bind = std::env::var("RELAY_BIND").unwrap_or_else(|_| "0.0.0.0:8088".into());
    let addr = SocketAddr::from_str(&bind)?;
    info!(%addr, "Relay server listening");
    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
}

// Serve the bundled OpenAPI YAML specification
async fn get_openapi_yaml() -> impl IntoResponse {
    (
        StatusCode::OK,
        [("Content-Type", "application/yaml")],
        relay_lib::assets::OPENAPI_YAML,
    )
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

#[derive(Serialize)]
struct StatusResponse {
    ok: bool,
    #[serde(rename = "repoInitialized")]
    repo_initialized: bool,
    branches: Vec<String>,
    #[serde(rename = "samplePaths")]
    sample_paths: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    rules: Option<serde_json::Value>,
    capabilities: Vec<&'static str>,
}

#[derive(Deserialize)]
struct RulesDoc {
    #[serde(default, rename = "indexFile")]
    index_file: Option<String>,
}

async fn post_status(State(state): State<AppState>) -> impl IntoResponse {
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let branches = list_branches(&repo);
    // Try to read relay.yaml from default branch
    let (rules_json, index_file) = match read_file_from_repo(&state.repo_path, DEFAULT_BRANCH, "relay.yaml") {
        Ok(bytes) => {
            let rules_yaml = String::from_utf8_lossy(&bytes);
            match serde_yaml::from_str::<serde_json::Value>(&rules_yaml) {
                Ok(json_val) => {
                    // Attempt to parse indexFile for samplePaths
                    let idx = serde_yaml::from_str::<RulesDoc>(&rules_yaml).ok().and_then(|d| d.index_file);
                    (Some(json_val), idx.unwrap_or_else(|| "index.md".to_string()))
                }
                Err(_) => (None, "index.md".to_string()),
            }
        }
        Err(_) => (None, "index.md".to_string()),
    };
    let body = StatusResponse {
        ok: true,
        repo_initialized: true,
        branches,
        sample_paths: serde_json::json!({"index": index_file}),
        rules: rules_json,
        capabilities: vec!["git", "torrent", "ipfs", "http"],
    };
    Json(body).into_response()
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
        let (ct, bytes) = directory_response(&repo_path, &tree, &tree, "", "", DEFAULT_BRANCH);
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
        let (ct, bytes) = directory_response(&repo_path, &tree, &tree, "", "text/markdown", DEFAULT_BRANCH);
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
    // Priority: query ?branch= -> header X-Relay-Branch -> default
    if let Some(q) = query {
        if let Some(b) = q.get("branch").filter(|s| !s.is_empty()) {
            return b.to_string();
        }
    }
    headers
        .get(HEADER_BRANCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BRANCH)
        .to_string()
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
            return render_404_markdown(&state.repo_path, &branch, &decoded);
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

    // Empty path or root → directory listing of root
    let rel = decoded.trim_matches('/');
    if rel.is_empty() {
        let accept_hdr = headers
            .get("accept")
            .and_then(|v| v.to_str().ok())
            .unwrap_or("");
        let (ct, body) = directory_response(&state.repo_path, &tree, &tree, rel, accept_hdr, &branch);
        return (StatusCode::OK, [("Content-Type", ct)], body).into_response();
    }

    // Try to resolve path within tree
    let path_obj = std::path::Path::new(rel);
    let entry = match tree.get_path(path_obj) {
        Ok(e) => e,
        Err(_) => {
            return render_404_markdown(&state.repo_path, &branch, rel);
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
                        return (StatusCode::OK, [("Content-Type", "text/markdown")], content.to_vec()).into_response();
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
                        let wrapped = wrap_html_with_assets(title, &html_frag, &branch, &state.repo_path, &base_dir);
                        return (StatusCode::OK, [("Content-Type", "text/html; charset=utf-8")], wrapped).into_response();
                    }
                    }
                    // Non-markdown: serve with detected mime
                    let ct = mime_guess::from_path(rel).first_or_octet_stream().essence_str().to_string();
                    (StatusCode::OK, [("Content-Type", ct)], blob.content().to_vec()).into_response()
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
                let (ct, body) = directory_response(&state.repo_path, &tree, &sub_tree, rel, accept_hdr, &branch);
                (StatusCode::OK, [("Content-Type", ct)], body).into_response()
        }
        _ => render_404_markdown(&state.repo_path, &branch, rel),
    }
}

async fn get_root(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Option<Query<HashMap<String, String>>>,
) -> impl IntoResponse {
    // Explicitly implement root directory listing to avoid extractor mismatch
    let branch = branch_from(&headers, &query.as_ref().map(|q| q.0.clone()));
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
            return render_404_markdown(&state.repo_path, &branch, "");
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
    let (ct, body) = directory_response(&state.repo_path, &tree, &tree, "", accept_hdr, &branch);
    (StatusCode::OK, [("Content-Type", ct)], body).into_response()
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
    match write_file_to_repo(&state.repo_path, &branch, &decoded, &body) {
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
fn wrap_html_with_assets(title: &str, body: &str, branch: &str, repo_path: &PathBuf, base_dir: &str) -> Vec<u8> {
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
    // Do named replacement
    let html = template_html
        .replace("{title}", title)
        .replace("{head}", &head)
        .replace("{body}", body);
    html.into_bytes()
}

// Helper to return directory listing as HTML or markdown depending on Accept header
// root_tree is the tree at repo root (for CSS presence checks), listing_tree is the directory to list
fn directory_response(repo_path: &PathBuf, _root_tree: &git2::Tree, listing_tree: &git2::Tree, base_path: &str, accept_hdr: &str, branch: &str) -> (String, Vec<u8>) {
    let md = render_directory_markdown(listing_tree, base_path);
    if accept_hdr.contains("text/markdown") {
        ("text/markdown".to_string(), md)
    } else {
        let body = String::from_utf8(md_to_html_bytes(&md)).unwrap_or_default();
        ("text/html; charset=utf-8".to_string(), wrap_html_with_assets("Directory", &body, branch, repo_path, base_path))
    }
}

fn render_404_markdown(repo_path: &PathBuf, branch: &str, missing_path: &str) -> Response {
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

    let wrapped = wrap_html_with_assets("Not Found", &body_html, branch, repo_path, &parent_dir);
    (
        StatusCode::NOT_FOUND,
        [("Content-Type", "text/html; charset=utf-8".to_string())],
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
