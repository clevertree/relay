use serde::{Deserialize, Serialize};
use anyhow::Result;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OptionsResponse {
    pub branches: Option<Vec<String>>,
    pub repos: Option<Vec<String>>,
    pub branch_heads: Option<serde_json::Value>,
    pub relay: Option<serde_json::Value>, // may contain parsed relay.yaml content
}

pub async fn fetch_options(base_url: &str) -> Result<OptionsResponse> {
    let url = format!("{}/", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .request(reqwest::Method::OPTIONS, url)
        .send()
        .await?;
    let ct = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if ct.contains("application/json") || ct.contains("+json") {
        let v = resp.json::<serde_json::Value>().await?;
        // Best-effort mapping
        let branches = v.get("branches").and_then(|x| serde_json::from_value(x.clone()).ok());
        let repos = v.get("repos").and_then(|x| serde_json::from_value(x.clone()).ok());
        let branch_heads = v.get("branchHeads").cloned();
        let relay = v.get("relay").cloned().or_else(|| v.get("relay_yaml").cloned());
        Ok(OptionsResponse { branches, repos, branch_heads, relay })
    } else {
        // Try plain text / YAML fallback
        let _text = resp.text().await.unwrap_or_default();
        Ok(OptionsResponse::default())
    }
}

pub async fn get_path(base_url: &str, path: &str) -> Result<reqwest::Response> {
    let url = format!("{}/{}", base_url.trim_end_matches('/'), path.trim_start_matches('/'));
    let client = reqwest::Client::new();
    Ok(client.get(url).send().await?)
}

pub async fn query(base_url: &str, body: serde_json::Value) -> Result<serde_json::Value> {
    let url = format!("{}/", base_url.trim_end_matches('/'));
    let client = reqwest::Client::new();
    let resp = client
        .request(reqwest::Method::from_bytes(b"QUERY").unwrap(), url)
        .json(&body)
        .send()
        .await?;
    Ok(resp.json::<serde_json::Value>().await?)
}
