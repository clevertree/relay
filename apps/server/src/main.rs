use std::{net::SocketAddr, path::PathBuf, str::FromStr};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use tokio::net::TcpListener;
use git2::{Oid, Repository, Signature};
use base64::Engine;
use percent_encoding::percent_decode_str as url_decode;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tracing::{error, info};

#[derive(Clone)]
struct AppState {
    repo_path: PathBuf,
}

const HEADER_BRANCH: &str = "X-Relay-Branch";
const DEFAULT_BRANCH: &str = "main";
const DISALLOWED: &[&str] = &[".html", ".htm", ".js"];

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let repo_path = std::env::var("RELAY_REPO_PATH")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from("data/repo.git"));
    ensure_bare_repo(&repo_path)?;

    let state = AppState { repo_path };

    let app = Router::new()
        .route("/status", post(post_status))
        .route("/query/*path", post(post_query))
        .route("/*path", get(get_file).put(put_file).delete(delete_file))
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
    repoInitialized: bool,
    branches: Vec<String>,
    samplePaths: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    rules: Option<serde_json::Value>,
    capabilities: Vec<&'static str>,
}

#[derive(Deserialize)]
struct RulesDoc {
    #[serde(default)]
    indexFile: Option<String>,
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
                    let idx = serde_yaml::from_str::<RulesDoc>(&rules_yaml).ok().and_then(|d| d.indexFile);
                    (Some(json_val), idx.unwrap_or_else(|| "index.md".to_string()))
                }
                Err(_) => (None, "index.md".to_string()),
            }
        }
        Err(_) => (None, "index.md".to_string()),
    };
    let body = StatusResponse {
        ok: true,
        repoInitialized: true,
        branches,
        samplePaths: serde_json::json!({"index": index_file}),
        rules: rules_json,
        capabilities: vec!["git", "torrent", "ipfs", "http"],
    };
    Json(body).into_response()
}

#[derive(Deserialize)]
struct QueryRequest {
    #[serde(default)]
    page: Option<usize>,
    #[serde(default)]
    pageSize: Option<usize>,
    #[serde(default)]
    params: Option<serde_json::Value>,
}

#[derive(Serialize)]
struct QueryResponse {
    items: serde_json::Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    total: Option<i64>,
    page: usize,
    pageSize: usize,
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
        Some(Json(v)) => serde_json::from_value(v).unwrap_or(QueryRequest { page: Some(0), pageSize: Some(25), params: None }),
        None => QueryRequest { page: Some(0), pageSize: Some(25), params: None },
    };
    let page = req.page.unwrap_or(0);
    let page_size = req.pageSize.unwrap_or(25);

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
        pageSize: page_size,
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

fn branch_from(headers: &HeaderMap) -> String {
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
)-> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, "Disallowed file type").into_response();
    }
    let branch = branch_from(&headers);
    match read_file_from_repo(&state.repo_path, &branch, &decoded) {
        Ok(bytes) => (
            StatusCode::OK,
            [("Content-Type", mime_guess::from_path(&decoded).first_or_octet_stream().essence_str().to_string())],
            bytes,
        )
            .into_response(),
        Err(ReadError::NotFound) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => {
            error!(?e, "read error");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

async fn put_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
    body: Bytes,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Disallowed file type"}))).into_response();
    }
    let branch = branch_from(&headers);
    match write_file_to_repo(&state.repo_path, &branch, &decoded, &body) {
        Ok((commit, branch)) => Json(serde_json::json!({"commit": commit, "branch": branch, "path": decoded})).into_response(),
        Err(e) => {
            error!(?e, "write error");
            (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response()
        }
    }
}

async fn delete_file(
    State(state): State<AppState>,
    headers: HeaderMap,
    Path(path): Path<String>,
) -> impl IntoResponse {
    let decoded = url_decode(&path).decode_utf8_lossy().to_string();
    if disallowed(&decoded) {
        return (StatusCode::FORBIDDEN, Json(serde_json::json!({"error": "Disallowed file type"}))).into_response();
    }
    let branch = branch_from(&headers);
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

fn write_file_to_repo(_repo_path: &PathBuf, _branch: &str, _path: &str, _content: &[u8]) -> anyhow::Result<(String, String)> {
    // TODO: Implement writing to a bare Git repo tree safely (tree builder). For now, return an error.
    anyhow::bail!("PUT not implemented in this build")
}

fn delete_file_in_repo(_repo_path: &PathBuf, _branch: &str, _path: &str) -> Result<(String, String), ReadError> {
    Err(ReadError::Other(anyhow::anyhow!("DELETE not implemented in this build")))
}
