use anyhow::{anyhow, Result};
use bytes::Bytes;
use serde::{Deserialize, Serialize};

pub const HEADER_BRANCH: &str = "X-Relay-Branch";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusResponse {
    pub ok: bool,
    #[serde(rename = "repoInitialized")]
    pub repo_initialized: bool,
    pub branches: Vec<String>,
    #[serde(rename = "samplePaths")]
    pub sample_paths: serde_json::Value,
    #[serde(default)]
    pub rules: Option<serde_json::Value>,
    pub capabilities: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WriteResponse {
    pub commit: String,
    pub branch: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResponse {
    pub items: serde_json::Value,
    #[serde(default)]
    pub total: Option<i64>,
    pub page: u32,
    #[serde(rename = "pageSize")]
    pub page_size: u32,
    pub branch: String,
}

fn normalize_socket(socket: &str) -> String {
    if socket.starts_with("http://") || socket.starts_with("https://") {
        socket.to_string()
    } else {
        format!("http://{}", socket)
    }
}

pub async fn connect_status(socket: &str) -> Result<StatusResponse> {
    let base = normalize_socket(socket);
    let url = format!("{}/status", base.trim_end_matches('/'));
    let res = reqwest::Client::new().post(url).send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("status failed: {}", res.status()));
    }
    Ok(res.json::<StatusResponse>().await?)
}

pub async fn get_file(socket: &str, path: &str, branch: &str) -> Result<Bytes> {
    let base = normalize_socket(socket);
    let url = format!("{}/{}", base.trim_end_matches('/'), urlencoding::encode(path));
    let res = reqwest::Client::new()
        .get(url)
        .header(HEADER_BRANCH, branch)
        .send()
        .await?;
    if !res.status().is_success() {
        return Err(anyhow!("GET failed: {}", res.status()));
    }
    Ok(res.bytes().await?)
}

pub async fn put_file(socket: &str, path: &str, branch: &str, body: Bytes) -> Result<WriteResponse> {
    let base = normalize_socket(socket);
    let url = format!("{}/{}", base.trim_end_matches('/'), urlencoding::encode(path));
    let res = reqwest::Client::new()
        .put(url)
        .header(HEADER_BRANCH, branch)
        .body(body)
        .send()
        .await?;
    let status = res.status();
    if !status.is_success() {
        let txt = res.text().await.unwrap_or_default();
        return Err(anyhow!("PUT failed: {} {}", status, txt));
    }
    Ok(res.json::<WriteResponse>().await?)
}

pub async fn post_query(socket: &str, branch: &str, path: Option<&str>, body: Option<serde_json::Value>) -> Result<QueryResponse> {
    let base = normalize_socket(socket);
    let mut url = format!("{}/query", base.trim_end_matches('/'));
    if let Some(p) = path { url.push('/'); url.push_str(&urlencoding::encode(p)); }
    let client = reqwest::Client::new();
    let req = client.post(url).header(HEADER_BRANCH, branch);
    let req = if let Some(b) = body { req.json(&b) } else { req };
    let res = req.send().await?;
    if !res.status().is_success() {
        return Err(anyhow!("QUERY failed: {}", res.status()));
    }
    Ok(res.json::<QueryResponse>().await?)
}
