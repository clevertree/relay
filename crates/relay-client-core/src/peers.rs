use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use crate::remotes::fetch_options;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct PeerHost(pub String);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerProbeConfig {
    pub https_port: u16,     // default 443
    pub git_port: u16,       // default 9418
    pub ssh_port: Option<u16>, // optional 22
    pub ipfs_api_port: u16,  // default 5001
    pub ipfs_gateway_port: u16, // default 8080
    pub ipfs_swarm_port: u16,   // default 4001
    pub attempts: u8,        // default 3
    pub timeout: Duration,   // per attempt
}

impl Default for PeerProbeConfig {
    fn default() -> Self {
        Self {
            https_port: 443,
            git_port: 9418,
            ssh_port: Some(22),
            ipfs_api_port: 5001,
            ipfs_gateway_port: 8080,
            ipfs_swarm_port: 4001,
            attempts: 3,
            timeout: Duration::from_millis(800),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProbeResult {
    pub https_up: bool,
    pub https_latency_ms: Option<u128>,
    pub git_up: bool,
    pub ssh_up: bool,
    pub ipfs_api_up: bool,
    pub ipfs_api_latency_ms: Option<u128>,
    pub ipfs_gateway_up: bool,
    pub ipfs_swarm_up: bool,
    pub last_update_ts: Option<i64>, // unix millis
}

pub async fn probe_peer(host: &str, cfg: &PeerProbeConfig) -> ProbeResult {
    // HTTPS: try TCP connect and a HEAD request; record median latency
    let https_latencies = sample_n(cfg.attempts, cfg.timeout, || async {
        tcp_then_head_https(host, cfg.https_port, cfg.timeout).await
    }).await;
    let https_up = !https_latencies.is_empty();
    let https_latency_ms = median_opt(&https_latencies);

    // Git: TCP 9418
    let git_up = tcp_check(host, cfg.git_port, cfg.timeout).await;

    // SSH (optional)
    let ssh_up = match cfg.ssh_port {
        Some(p) => tcp_check(host, p, cfg.timeout).await,
        None => false,
    };

    // IPFS API: POST /api/v0/version on 5001
    let ipfs_api_latencies = sample_n(cfg.attempts, cfg.timeout, || async {
        ipfs_api_version_http(host, cfg.ipfs_api_port, cfg.timeout).await
    }).await;
    let ipfs_api_up = !ipfs_api_latencies.is_empty();
    let ipfs_api_latency_ms = median_opt(&ipfs_api_latencies);

    // IPFS Gateway: HEAD /ipfs/ on 8080 (any HTTP response counts as up)
    let ipfs_gateway_up = http_head(format!("http://{}:{}/ipfs/", host, cfg.ipfs_gateway_port), cfg.timeout).await;

    // IPFS Swarm: TCP 4001
    let ipfs_swarm_up = tcp_check(host, cfg.ipfs_swarm_port, cfg.timeout).await;

    // Last update time via OPTIONS /
    let last_update_ts = match fetch_options(&format!("https://{}", host)).await {
        Ok(opts) => {
            // Heuristic: find the max timestamp from branchHeads if it looks like millis/seconds
            opts.branch_heads
                .and_then(|v| extract_latest_ts(&v))
                .or_else(|| current_date_header_millis())
        }
        Err(_) => None,
    };

    ProbeResult {
        https_up,
        https_latency_ms,
        git_up,
        ssh_up,
        ipfs_api_up,
        ipfs_api_latency_ms,
        ipfs_gateway_up,
        ipfs_swarm_up,
        last_update_ts,
    }
}

async fn tcp_check(host: &str, port: u16, timeout: Duration) -> bool {
    let addr = format!("{}:{}", host, port);
    let fut = TcpStream::connect(addr);
    tokio::time::timeout(timeout, fut).await.map(|r| r.is_ok()).unwrap_or(false)
}

async fn tcp_then_head_https(host: &str, port: u16, timeout: Duration) -> Option<u128> {
    // First try TCP connect to detect obvious failures quickly
    if !tcp_check(host, port, timeout).await { return None; }
    // Then HEAD https://host:port/
    let url = format!("https://{}:{}/", host, port);
    let client = reqwest::Client::builder().timeout(timeout).build().ok()?;
    let start = Instant::now();
    let req = client.head(url).send();
    match tokio::time::timeout(timeout, req).await {
        Ok(Ok(_resp)) => Some(start.elapsed().as_millis()),
        _ => None,
    }
}

async fn ipfs_api_version_http(host: &str, port: u16, timeout: Duration) -> Option<u128> {
    let url = format!("http://{}:{}/api/v0/version", host, port);
    let client = reqwest::Client::builder().timeout(timeout).build().ok()?;
    let start = Instant::now();
    let req = client.post(url).send();
    match tokio::time::timeout(timeout, req).await {
        Ok(Ok(_resp)) => Some(start.elapsed().as_millis()),
        _ => None,
    }
}

async fn http_head(url: String, timeout: Duration) -> bool {
    let client = match reqwest::Client::builder().timeout(timeout).build() { Ok(c) => c, Err(_) => return false };
    let req = client.head(url).send();
    tokio::time::timeout(timeout, req).await.map(|r| r.is_ok()).unwrap_or(false)
}

fn median_opt(values: &Vec<u128>) -> Option<u128> {
    if values.is_empty() { return None; }
    let mut v = values.clone();
    v.sort_unstable();
    Some(v[v.len()/2])
}

async fn sample_n<F, Fut>(n: u8, _timeout: Duration, f: F) -> Vec<u128>
where
    F: Fn() -> Fut,
    Fut: std::future::Future<Output = Option<u128>>,
{
    let mut out = Vec::new();
    for _ in 0..n {
        if let Some(ms) = f().await { out.push(ms); }
    }
    out
}

fn extract_latest_ts(v: &serde_json::Value) -> Option<i64> {
    // Accept a map of branch->head->timestamp or arrays; pick the maximum integer value
    fn max_int(val: &serde_json::Value, cur: &mut i64) {
        match val {
            serde_json::Value::Number(n) => {
                if let Some(i) = n.as_i64() { if i > *cur { *cur = i; }}
            }
            serde_json::Value::Array(a) => for x in a { max_int(x, cur); },
            serde_json::Value::Object(m) => for (_k, x) in m { max_int(x, cur); },
            _ => {}
        }
    }
    let mut maxv = i64::MIN;
    max_int(v, &mut maxv);
    if maxv == i64::MIN { None } else { Some(maxv) }
}

fn current_date_header_millis() -> Option<i64> { None }
