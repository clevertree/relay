#![allow(clippy::missing_safety_doc)]

//! C ABI surface for React Native bridge integration.
//! Provides peer probing, OPTIONS requests, and core relay functionality.

use libc::{c_char, c_void, size_t};
use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::ptr;
use std::time::{Duration, Instant};
use tokio::runtime::Runtime;

#[cfg(target_os = "android")]
pub mod jni;

/// Version information
#[no_mangle]
pub extern "C" fn relay_core_version() -> *const c_char {
    static VERSION: &str = concat!(env!("CARGO_PKG_NAME"), " ", env!("CARGO_PKG_VERSION"), "\0");
    VERSION.as_ptr() as *const c_char
}

/// Probe result for a single protocol
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProbeResult {
    pub protocol: String,
    pub port: u16,
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub latency_ms: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// Full probe response for a peer
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PeerProbeResponse {
    pub host: String,
    pub probes: Vec<ProbeResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_update_ts: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branches: Option<Vec<String>>,
}

/// OPTIONS response data
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OptionsResponse {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branches: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repos: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub branch_heads: Option<serde_json::Value>,
}

/// Helper to create a CString from Rust string and return pointer
/// Caller must free with `relay_free_string`
fn string_to_c(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(cs) => cs.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Free a string allocated by this library
#[no_mangle]
pub unsafe extern "C" fn relay_free_string(s: *mut c_char) {
    if !s.is_null() {
        drop(CString::from_raw(s));
    }
}

/// Create a tokio runtime for async operations
fn get_runtime() -> Result<Runtime, String> {
    Runtime::new().map_err(|e| format!("Failed to create runtime: {}", e))
}

/// Probe HTTPS endpoint
async fn probe_https(host: &str, timeout_ms: u64) -> ProbeResult {
    let port = 443u16;
    let timeout = Duration::from_millis(timeout_ms);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(true) // For local dev
        .build()
        .unwrap_or_default();

    let url = if host.contains("localhost") || host.contains("10.0.2.2") || host.contains("127.0.0.1") {
        let port_suffix = if host.contains(':') { "" } else { ":8080" };
        format!("http://{}{}/", host, port_suffix)
    } else {
        let port_suffix = if host.contains(':') { "" } else { ":443" };
        format!("https://{}{}/", host, port_suffix)
    };

    let start = Instant::now();
    match client.head(&url).send().await {
        Ok(res) if res.status().as_u16() < 500 => ProbeResult {
            protocol: "https".to_string(),
            port,
            ok: true,
            latency_ms: Some(start.elapsed().as_millis() as u32),
            error: None,
        },
        Ok(res) => ProbeResult {
            protocol: "https".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(format!("HTTP {}", res.status())),
        },
        Err(e) => ProbeResult {
            protocol: "https".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
    }
}

/// Probe IPFS API endpoint (port 5001)
async fn probe_ipfs_api(host: &str, timeout_ms: u64) -> ProbeResult {
    let port = 5001u16;
    let timeout = Duration::from_millis(timeout_ms);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_default();

    let base_host = host.split(':').next().unwrap_or(host);
    let url = format!("http://{}:{}/api/v0/version", base_host, port);

    let start = Instant::now();
    match client.post(&url).send().await {
        Ok(res) if res.status().is_success() => ProbeResult {
            protocol: "ipfs-api".to_string(),
            port,
            ok: true,
            latency_ms: Some(start.elapsed().as_millis() as u32),
            error: None,
        },
        Ok(res) => ProbeResult {
            protocol: "ipfs-api".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(format!("HTTP {}", res.status())),
        },
        Err(e) => ProbeResult {
            protocol: "ipfs-api".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
    }
}

/// Probe IPFS Gateway endpoint (port 8080)
async fn probe_ipfs_gateway(host: &str, timeout_ms: u64) -> ProbeResult {
    let port = 8080u16;
    let timeout = Duration::from_millis(timeout_ms);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .unwrap_or_default();

    let base_host = host.split(':').next().unwrap_or(host);
    let url = format!("http://{}:{}/ipfs/", base_host, port);

    let start = Instant::now();
    match client.head(&url).send().await {
        Ok(res) if res.status().as_u16() < 500 => ProbeResult {
            protocol: "ipfs-gateway".to_string(),
            port,
            ok: true,
            latency_ms: Some(start.elapsed().as_millis() as u32),
            error: None,
        },
        Ok(res) => ProbeResult {
            protocol: "ipfs-gateway".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(format!("HTTP {}", res.status())),
        },
        Err(e) => ProbeResult {
            protocol: "ipfs-gateway".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
    }
}

/// Probe Git TCP endpoint (port 9418)
async fn probe_git(host: &str, timeout_ms: u64) -> ProbeResult {
    let port = 9418u16;
    let timeout = Duration::from_millis(timeout_ms);
    let base_host = host.split(':').next().unwrap_or(host);
    let addr = format!("{}:{}", base_host, port);

    let start = Instant::now();
    match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => ProbeResult {
            protocol: "git".to_string(),
            port,
            ok: true,
            latency_ms: Some(start.elapsed().as_millis() as u32),
            error: None,
        },
        Ok(Err(e)) => ProbeResult {
            protocol: "git".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
        Err(_) => ProbeResult {
            protocol: "git".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some("timeout".to_string()),
        },
    }
}

/// Probe IPFS Swarm TCP endpoint (port 4001)
async fn probe_ipfs_swarm(host: &str, timeout_ms: u64) -> ProbeResult {
    let port = 4001u16;
    let timeout = Duration::from_millis(timeout_ms);
    let base_host = host.split(':').next().unwrap_or(host);
    let addr = format!("{}:{}", base_host, port);

    let start = Instant::now();
    match tokio::time::timeout(timeout, tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => ProbeResult {
            protocol: "ipfs-swarm".to_string(),
            port,
            ok: true,
            latency_ms: Some(start.elapsed().as_millis() as u32),
            error: None,
        },
        Ok(Err(e)) => ProbeResult {
            protocol: "ipfs-swarm".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some(e.to_string()),
        },
        Err(_) => ProbeResult {
            protocol: "ipfs-swarm".to_string(),
            port,
            ok: false,
            latency_ms: None,
            error: Some("timeout".to_string()),
        },
    }
}

/// Fetch OPTIONS from a peer
async fn fetch_options(host: &str, timeout_ms: u64) -> Result<OptionsResponse, String> {
    let timeout = Duration::from_millis(timeout_ms);
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let url = if host.contains("localhost") || host.contains("10.0.2.2") || host.contains("127.0.0.1") {
        let port_suffix = if host.contains(':') { "" } else { ":8080" };
        format!("http://{}{}/", host, port_suffix)
    } else {
        let port_suffix = if host.contains(':') { "" } else { ":443" };
        format!("https://{}{}/", host, port_suffix)
    };

    let res = client
        .request(reqwest::Method::OPTIONS, &url)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    Ok(OptionsResponse {
        branches: data.get("branches").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
        }),
        repos: data.get("repos").and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|v| v.as_str().map(String::from))
                    .collect()
            })
        }),
        branch_heads: data.get("branchHeads").cloned(),
    })
}

/// Probe a peer on all protocols
/// Returns JSON string with PeerProbeResponse
/// Caller must free the returned string with relay_free_string
#[no_mangle]
pub unsafe extern "C" fn relay_probe_peer(
    host: *const c_char,
    timeout_ms: u64,
) -> *mut c_char {
    if host.is_null() {
        return ptr::null_mut();
    }

    let host_str = match CStr::from_ptr(host).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return ptr::null_mut(),
    };

    let rt = match get_runtime() {
        Ok(r) => r,
        Err(_) => return ptr::null_mut(),
    };

    let response = rt.block_on(async {
        let (https, ipfs_api, ipfs_gw, git, swarm) = tokio::join!(
            probe_https(&host_str, timeout_ms),
            probe_ipfs_api(&host_str, timeout_ms),
            probe_ipfs_gateway(&host_str, timeout_ms),
            probe_git(&host_str, timeout_ms),
            probe_ipfs_swarm(&host_str, timeout_ms),
        );

        let probes = vec![https, ipfs_api, ipfs_gw, git, swarm];

        // Also fetch OPTIONS for metadata
        let options = fetch_options(&host_str, timeout_ms).await.ok();

        PeerProbeResponse {
            host: host_str,
            probes,
            last_update_ts: None, // TODO: extract from branch_heads
            branches: options.as_ref().and_then(|o| o.branches.clone()),
        }
    });

    match serde_json::to_string(&response) {
        Ok(json) => string_to_c(json),
        Err(_) => ptr::null_mut(),
    }
}

/// Fetch OPTIONS from a peer
/// Returns JSON string with OptionsResponse
/// Caller must free the returned string with relay_free_string
#[no_mangle]
pub unsafe extern "C" fn relay_fetch_options(
    host: *const c_char,
    timeout_ms: u64,
) -> *mut c_char {
    if host.is_null() {
        return ptr::null_mut();
    }

    let host_str = match CStr::from_ptr(host).to_str() {
        Ok(s) => s.to_string(),
        Err(_) => return ptr::null_mut(),
    };

    let rt = match get_runtime() {
        Ok(r) => r,
        Err(_) => return ptr::null_mut(),
    };

    let response = rt.block_on(fetch_options(&host_str, timeout_ms));

    match response {
        Ok(opts) => match serde_json::to_string(&opts) {
            Ok(json) => string_to_c(json),
            Err(_) => ptr::null_mut(),
        },
        Err(_) => ptr::null_mut(),
    }
}

/// GET a file from a peer
/// Returns the file content as bytes, or null on error
/// out_len receives the length of the returned buffer
/// Caller must free the returned buffer with relay_free_buffer
#[no_mangle]
pub unsafe extern "C" fn relay_get_file(
    host: *const c_char,
    path: *const c_char,
    branch: *const c_char,
    timeout_ms: u64,
    out_len: *mut size_t,
) -> *mut u8 {
    if host.is_null() || path.is_null() || out_len.is_null() {
        return ptr::null_mut();
    }

    let host_str = match CStr::from_ptr(host).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let path_str = match CStr::from_ptr(path).to_str() {
        Ok(s) => s,
        Err(_) => return ptr::null_mut(),
    };

    let branch_str = if branch.is_null() {
        "main"
    } else {
        match CStr::from_ptr(branch).to_str() {
            Ok(s) => s,
            Err(_) => "main",
        }
    };

    let rt = match get_runtime() {
        Ok(r) => r,
        Err(_) => return ptr::null_mut(),
    };

    let result = rt.block_on(async {
        let timeout = Duration::from_millis(timeout_ms);
        let client = reqwest::Client::builder()
            .timeout(timeout)
            .danger_accept_invalid_certs(true)
            .build()?;

        let base_url = if host_str.contains("localhost") || host_str.contains("10.0.2.2") {
            let port = if host_str.contains(':') { "" } else { ":8080" };
            format!("http://{}{}", host_str, port)
        } else {
            let port = if host_str.contains(':') { "" } else { "" };
            format!("https://{}{}", host_str, port)
        };

        let url = format!("{}/{}", base_url.trim_end_matches('/'), path_str.trim_start_matches('/'));

        let res = client
            .get(&url)
            .header("X-Relay-Branch", branch_str)
            .send()
            .await?;

        if !res.status().is_success() {
            return Err(anyhow::anyhow!("HTTP {}", res.status()));
        }

        Ok(res.bytes().await?.to_vec())
    });

    match result {
        Ok(bytes) => {
            *out_len = bytes.len();
            let ptr = libc::malloc(bytes.len()) as *mut u8;
            if !ptr.is_null() {
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
            }
            ptr
        }
        Err(_) => {
            *out_len = 0;
            ptr::null_mut()
        }
    }
}

/// Free a buffer allocated by relay_get_file
#[no_mangle]
pub unsafe extern "C" fn relay_free_buffer(buf: *mut c_void) {
    if !buf.is_null() {
        libc::free(buf);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_version() {
        unsafe {
            let ver = relay_core_version();
            assert!(!ver.is_null());
            let s = CStr::from_ptr(ver).to_str().unwrap();
            assert!(s.contains("relay-client-rn-core"));
        }
    }
}
