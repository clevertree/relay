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
use base64::Engine;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{debug, error, info};
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
const DISALLOWED: &[&str] = &[".html", ".htm", ".js"];

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

    let app = Router::new()
        .route("/status", post(post_status))
        .route("/query/*path", post(post_query))
        .route("/", get(get_root))
        .route("/*path", get(get_file).put(put_file).delete(delete_file))
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let bind = std::env::var("RELAY_BIND").unwrap_or_else(|_| "0.0.0.0:8088".into());
    let addr = SocketAddr::from_str(&bind)?;
    info!(%addr, "Relay server listening");
    let listener = TcpListener::bind(&addr).await?;
    axum::serve(listener, app.into_make_service()).await?;
    Ok(())
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
    // Try to read rules.yaml from default branch
    let (rules_json, index_file) = match read_file_from_repo(&state.repo_path, DEFAULT_BRANCH, "rules.yaml") {
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

#[allow(dead_code)]
#[derive(Deserialize)]
struct QueryRequest {
    #[serde(default)]
    page: Option<usize>,
    #[serde(default, rename = "pageSize")]
    page_size: Option<usize>,
    #[serde(default)]
    params: Option<serde_json::Value>,
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
    // Defaults
    let branch = headers
        .get(HEADER_BRANCH)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(DEFAULT_BRANCH)
        .to_string();
    let req: QueryRequest = match body {
        Some(Json(v)) => serde_json::from_value(v).unwrap_or(QueryRequest { page: Some(0), page_size: Some(25), params: None }),
        None => QueryRequest { page: Some(0), page_size: Some(25), params: None },
    };
    let page = req.page.unwrap_or(0);
    let page_size = req.page_size.unwrap_or(25);

    // Open repo and read rules
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let rules_bytes = match read_file_from_repo(&state.repo_path, DEFAULT_BRANCH, "rules.yaml") {
        Ok(b) => b,
        Err(_) => return (StatusCode::BAD_REQUEST, "rules.yaml not found on default branch").into_response(),
    };
    let rules_yaml = String::from_utf8_lossy(&rules_bytes);
    let rules_val: serde_json::Value = match serde_yaml::from_str::<serde_json::Value>(&rules_yaml) {
        Ok(v) => v,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("invalid rules.yaml: {e}")).into_response(),
    };
    let db = match rules_val.get("db") {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "rules.db not defined").into_response(),
    };
    let qp = match db.get("queryPolicy") {
        Some(v) => v,
        None => return (StatusCode::BAD_REQUEST, "rules.db.queryPolicy not defined").into_response(),
    };
    let stmt = match qp.get("statement").and_then(|v| v.as_str()) {
        Some(s) => s.to_string(),
        None => return (StatusCode::BAD_REQUEST, "rules.db.queryPolicy.statement missing").into_response(),
    };
    let count_stmt = qp.get("countStatement").and_then(|v| v.as_str()).map(|s| s.to_string());
    let page_size_param = qp.get("pageSizeParam").and_then(|v| v.as_str()).unwrap_or(":limit");
    let page_offset_param = qp.get("pageOffsetParam").and_then(|v| v.as_str()).unwrap_or(":offset");

    // Open SQLite database located alongside the bare repo
    let db_path = repo.path().join("relay_index.sqlite");
    let conn = match rusqlite::Connection::open(db_path) {
        Ok(c) => c,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("open DB failed: {e}")).into_response(),
    };

    // Build named parameters
    // Build positional SQL by replacing named parameters with ?1, ?2, ?3
    let branch_param = branch.clone();
    let limit_i64: i64 = page_size as i64;
    let offset_i64: i64 = (page * page_size) as i64;
    let mut sql_pos = stmt.clone();
    // Replace all occurrences; order: :branch -> ?1, limit -> ?2, offset -> ?3
    sql_pos = sql_pos.replace(":branch", "?1");
    sql_pos = sql_pos.replace(page_size_param, "?2");
    sql_pos = sql_pos.replace(page_offset_param, "?3");

    // Prepare statement and execute
    let mut stmt_main = match conn.prepare(&sql_pos) {
        Ok(s) => s,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("prepare failed: {e}")).into_response(),
    };

    // Execute and collect rows as JSON (positional params)
    let rows_iter = match stmt_main.query(rusqlite::params![branch_param, limit_i64, offset_i64]) {
        Ok(r) => r,
        Err(e) => return (StatusCode::BAD_REQUEST, format!("query failed: {e}")).into_response(),
    };

    let mut cursor = rows_iter;
    let mut items_arr: Vec<serde_json::Value> = Vec::new();
    while let Ok(Some(row)) = cursor.next() {
        match row_to_json(row) {
            Ok(v) => items_arr.push(v),
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, format!("row mapping failed: {e}")).into_response(),
        }
    }

    // Count if provided
    let mut total_opt: Option<i64> = None;
    if let Some(cs) = count_stmt {
        let count_sql = cs.replace(":branch", "?1");
        match conn.prepare(&count_sql).and_then(|mut st| st.query_row(rusqlite::params![branch_param], |r| r.get::<_, i64>(0))) {
            Ok(total) => total_opt = Some(total),
            Err(e) => return (StatusCode::BAD_REQUEST, format!("count failed: {e}")).into_response(),
        }
    }

    let resp = QueryResponse {
        items: serde_json::Value::Array(items_arr),
        total: total_opt,
        page,
        page_size: page_size,
        branch,
    };
    (StatusCode::OK, Json(resp)).into_response()
}

fn row_to_json(row: &rusqlite::Row) -> anyhow::Result<serde_json::Value> {
    use rusqlite::types::ValueRef;
    let mut obj = serde_json::Map::new();
    let rowref = row.as_ref();
    for i in 0..rowref.column_count() {
        let name = rowref.column_name(i).unwrap_or("").to_string();
        let v = row.get_ref(i)?;
        let j = match v {
            ValueRef::Null => serde_json::Value::Null,
            ValueRef::Integer(n) => serde_json::Value::from(n),
            ValueRef::Real(f) => serde_json::Value::from(f),
            ValueRef::Text(t) => serde_json::Value::from(std::str::from_utf8(t)?.to_string()),
            ValueRef::Blob(b) => {
                use base64::engine::general_purpose::STANDARD as B64;
                serde_json::Value::from(B64.encode(b))
            }
        };
        obj.insert(name, j);
    }
    Ok(serde_json::Value::Object(obj))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_row_to_json_basic_types() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE t (id INTEGER, name TEXT, rating REAL, data BLOB)",
            [],
        )
        .unwrap();
        let blob: Vec<u8> = vec![1, 2, 3, 4];
        conn.execute(
            "INSERT INTO t (id, name, rating, data) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![1i64, "hello", 4.5f64, blob],
        )
        .unwrap();
        let mut stmt = conn.prepare("SELECT id, name, rating, data FROM t").unwrap();
        let mut rows = stmt.query([]).unwrap();
        if let Some(row) = rows.next().unwrap() {
            let v = row_to_json(row).unwrap();
            assert_eq!(v["id"], 1);
            assert_eq!(v["name"], "hello");
            assert!(v["data"].as_str().unwrap().len() > 0); // base64
        } else {
            panic!("no row returned")
        }
    }
}

fn disallowed(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    DISALLOWED.iter().any(|ext| lower.ends_with(ext))
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
        let body = render_directory_markdown(&tree, rel);
        return (StatusCode::OK, [("Content-Type", "text/markdown".to_string())], body).into_response();
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
            let body = render_directory_markdown(&sub_tree, rel);
            (StatusCode::OK, [("Content-Type", "text/markdown".to_string())], body).into_response()
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
    let body = render_directory_markdown(&tree, "");
    (StatusCode::OK, [("Content-Type", "text/markdown".to_string())], body).into_response()
}

async fn put_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    query: Option<Query<HashMap<String, String>>>,
    body: Bytes,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if disallowed(&decoded) {
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
    if disallowed(&decoded) {
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

fn render_404_markdown(repo_path: &PathBuf, branch: &str, missing_path: &str) -> Response {
    // Try to read /404.md from the same branch
    let custom = read_file_from_repo(repo_path, branch, "404.md").ok();
    let body: Vec<u8> = match custom {
        Some(bytes) => bytes,
        None => {
            // Build detailed 404 with cause and parent listing
            let mut s = String::new();
            s.push_str("# 404 — Not Found\n\n");
            // Determine cause
            let repo = Repository::open_bare(repo_path);
            let cause = if let Ok(repo) = repo {
                let refname = format!("refs/heads/{}", branch);
                match repo.find_reference(&refname) {
                    Ok(reference) => match reference.peel_to_commit().and_then(|c| c.tree()) {
                        Ok(root) => {
                            if root.is_empty() {
                                format!("Branch `{}` is empty.", branch)
                            } else {
                                format!("Path `/{}\u{201d}` not found on branch `{}`.", missing_path.trim_matches('/'), branch)
                            }
                        }
                        Err(_) => format!("Unable to read branch `{}` tree.", branch),
                    },
                    Err(_) => format!("Branch `{}` does not exist.", branch),
                }
            } else {
                "Repository open failure".to_string()
            };
            s.push_str(&cause);
            s.push_str("\n\n");
            // Parent directory listing
            if let Ok(repo) = Repository::open_bare(repo_path) {
                let refname = format!("refs/heads/{}", branch);
                if let Ok(reference) = repo.find_reference(&refname) {
                    if let Ok(commit) = reference.peel_to_commit() {
                        if let Ok(root) = commit.tree() {
                            let parent = missing_path.trim_matches('/');
                            let parent_path = std::path::Path::new(parent).parent().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| "".to_string());
                            let tree_to_list = if parent_path.is_empty() { Some(root) } else {
                                match root.get_path(std::path::Path::new(&parent_path)) {
                                    Ok(e) if e.kind() == Some(ObjectType::Tree) => repo.find_tree(e.id()).ok(),
                                    _ => Some(root),
                                }
                            };
                            if let Some(t) = tree_to_list {
                                s.push_str(&format!("## Parent directory: /{}\n\n", parent_path));
                                let md = String::from_utf8_lossy(&render_directory_markdown(&t, &parent_path)).to_string();
                                s.push_str(&md);
                                s.push('\n');
                            }
                        }
                    }
                }
            }
            s.into_bytes()
        }
    };
    (
        StatusCode::NOT_FOUND,
        [("Content-Type", "text/markdown".to_string())],
        body,
    )
        .into_response()
}

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

    // If this is a meta.json being written, validate against rules.metaSchema from default branch rules.yaml
    if path.ends_with("meta.json") {
        // Attempt to read rules.yaml from default branch
        if let Ok(bytes) = read_file_from_repo(repo_path, DEFAULT_BRANCH, "rules.yaml") {
            if let Ok(rules_yaml) = String::from_utf8(bytes) {
                if let Ok(rules_val) = serde_yaml::from_str::<serde_json::Value>(&rules_yaml) {
                    if let Some(meta_schema) = rules_val.get("metaSchema") {
                        // Compile schema and validate
                        // Leak to satisfy jsonschema static lifetime requirement
                        let leaked_schema: &'static serde_json::Value = Box::leak(Box::new(meta_schema.clone()));
                        let compiled = jsonschema::JSONSchema::compile(leaked_schema)
                            .map_err(|e| anyhow::anyhow!("invalid metaSchema in rules.yaml: {}", e))?;
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
