use std::{net::SocketAddr, path::PathBuf, str::FromStr};

use axum::{
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::{delete, get, post, put},
    Json, Router,
};
use git2::{Oid, Repository, Signature};
use percent_encoding::percent_decode_str as url_decode;
use serde::Serialize;
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
    axum::Server::bind(&addr).serve(app.into_make_service()).await?;
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
    capabilities: Vec<&'static str>,
}

async fn post_status(State(state): State<AppState>) -> impl IntoResponse {
    let repo = match Repository::open_bare(&state.repo_path) {
        Ok(r) => r,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    };
    let branches = list_branches(&repo);
    let body = StatusResponse {
        ok: true,
        repoInitialized: true,
        branches,
        samplePaths: serde_json::json!({"index": "index.md"}),
        capabilities: vec!["git", "torrent", "ipfs", "http"],
    };
    Json(body).into_response()
}

async fn post_query() -> impl IntoResponse {
    (StatusCode::NOT_IMPLEMENTED, "QUERY not implemented; use local index DB").into_response()
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
    let repo = Repository::open_bare(repo_path)?;
    let refname = format!("refs/heads/{}", branch);
    let reference = repo.find_reference(&refname).map_err(|_| ReadError::NotFound)?;
    let commit = reference.peel_to_commit().map_err(|_| ReadError::NotFound)?;
    let tree = commit.tree()?;
    let entry = tree.get_path(std::path::Path::new(path)).map_err(|_| ReadError::NotFound)?;
    let blob = repo.find_blob(entry.id())?;
    Ok(blob.content().to_vec())
}

fn write_file_to_repo(repo_path: &PathBuf, branch: &str, path: &str, content: &[u8]) -> anyhow::Result<(String, String)> {
    let repo = Repository::open_bare(repo_path)?;
    let sig = Signature::now("relay", "relay@local")?;
    // Get current commit (or create empty tree)
    let (parent_commit, mut index) = {
        let refname = format!("refs/heads/{}", branch);
        match repo.find_reference(&refname).and_then(|r| r.peel_to_commit()) {
            Ok(commit) => {
                let tree = commit.tree()?;
                let mut idx = repo.index()?;
                idx.read_tree(&tree)?;
                (Some(commit), idx)
            }
            Err(_) => (None, repo.index()?),
        }
    };
    // write blob and add/update entry
    let blob_id = repo.blob(content)?;
    let mut entry = git2::IndexEntry::new();
    entry.id = blob_id;
    entry.mode = 0o100644;
    entry.path = path.as_bytes().to_vec();
    index.add_frombuffer(&entry, content)?; // ensures entry present
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let refname = format!("refs/heads/{}", branch);
    let commit_id = match parent_commit {
        Some(parent) => repo.commit(Some(&refname), &sig, &sig, &format!("PUT {}", path), &tree, &[&parent])?,
        None => repo.commit(Some(&refname), &sig, &sig, &format!("PUT {}", path), &tree, &[])?
    };
    Ok((commit_id.to_string(), branch.to_string()))
}

fn delete_file_in_repo(repo_path: &PathBuf, branch: &str, path: &str) -> Result<(String, String), ReadError> {
    let repo = Repository::open_bare(repo_path)?;
    let sig = Signature::now("relay", "relay@local")?;
    let refname = format!("refs/heads/{}", branch);
    let parent = repo.find_reference(&refname).and_then(|r| r.peel_to_commit()).map_err(|_| ReadError::NotFound)?;
    let tree = parent.tree()?;
    let mut index = repo.index()?;
    index.read_tree(&tree)?;
    // remove path
    index.remove_path(std::path::Path::new(path)).map_err(|_| ReadError::NotFound)?;
    let new_tree_id = index.write_tree()?;
    let new_tree = repo.find_tree(new_tree_id)?;
    let commit_id = repo.commit(Some(&refname), &sig, &sig, &format!("DELETE {}", path), &new_tree, &[&parent])?;
    Ok((commit_id.to_string(), branch.to_string()))
}
