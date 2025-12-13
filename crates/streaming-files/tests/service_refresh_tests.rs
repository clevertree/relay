use httpmock::{Method::GET, Method::POST, MockServer};
use std::sync::Arc;
use streaming_files::rpc::{NullClient, TorrentClient};
use streaming_files::service::StreamingService;

#[tokio::test]
async fn refresh_backend_picks_qbt_when_healthy() {
    let qbt = MockServer::start();
    // qBittorrent health endpoint
    let _m_ver = qbt.mock(|when, then| {
        when.method(GET).path("/api/v2/app/version");
        then.status(200).body("4.6.4");
    });

    // Start with a NullClient service
    let svc0 = StreamingService::new_with_client(Arc::new(NullClient)).expect("svc");
    let mut svc = svc0;
    // Point qbt host to full base URL and prefer auto
    let patch = serde_json::json!({
        "preferred_backend": "auto",
        "qbt_host": qbt.base_url(),
    });
    let _ = svc.apply_config_patch(patch).expect("patch");

    // Refresh and expect qbt to be selected
    svc.refresh_backend().await.expect("refresh ok");
    assert_eq!(svc.active_backend_name(), "qbt");
}

#[tokio::test]
async fn refresh_backend_falls_back_to_transmission() {
    let qbt = MockServer::start();
    // qbt unhealthy (no version endpoint or 500)
    let _m_ver = qbt.mock(|when, then| {
        when.method(GET).path("/api/v2/app/version");
        then.status(500);
    });

    let tr = MockServer::start();
    // Transmission RPC: first request (without session id) returns 409 + header
    let _m1 = tr.mock(|when, then| {
        when.method(POST).path("/transmission/rpc").matches(|req| {
            let has = req
                .headers
                .as_ref()
                .map(|h| {
                    h.iter()
                        .any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id"))
                })
                .unwrap_or(false);
            !has
        });
        then.status(409).header("X-Transmission-Session-Id", "tok");
    });
    // Second request with header returns success
    let _m2 = tr.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "tok");
        then.status(200)
            .header("content-type", "application/json")
            .body(serde_json::json!({"result":"success","arguments":{}}).to_string());
    });

    let svc0 = StreamingService::new_with_client(Arc::new(NullClient)).expect("svc");
    let mut svc = svc0;
    // Apply overrides: qbt host (full URL) and transmission host/port/path
    let tr_url = tr.base_url();
    // Parse host and port from base_url e.g., http://127.0.0.1:12345
    let url = url::Url::parse(&tr_url).unwrap();
    let host = url.host_str().unwrap().to_string();
    let port = url.port().unwrap();
    let patch = serde_json::json!({
        "preferred_backend": "auto",
        "qbt_host": qbt.base_url(),
        "tr_host": host,
        "tr_port": port,
        "tr_path": "/transmission/rpc"
    });
    let _ = svc.apply_config_patch(patch).expect("patch");

    // Refresh and expect transmission to be selected
    svc.refresh_backend().await.expect("refresh ok");
    assert_eq!(svc.active_backend_name(), "transmission");
}
