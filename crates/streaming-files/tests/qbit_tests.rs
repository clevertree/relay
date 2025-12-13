use httpmock::{Method::GET, MockServer};
use streaming_files::rpc::qbit::QBitClient;
use streaming_files::rpc::TorrentClient; // bring trait into scope for method calls

#[tokio::test]
async fn qbit_healthy_true_on_version_ok() {
    let server = MockServer::start();
    let _m = server.mock(|when, then| {
        when.method(GET).path("/api/v2/app/version");
        then.status(200).body("4.6.4");
    });

    let base = format!("{}/", server.base_url());
    let client = QBitClient::new(base);
    let ok = client.healthy().await.unwrap();
    assert!(ok);
}

#[tokio::test]
async fn qbit_add_magnet_success() {
    use httpmock::Method::POST;
    let server = MockServer::start();
    // Add endpoint returns 200 on success (qBittorrent returns empty body)
    let _m_add = server.mock(|when, then| {
        when.method(POST).path("/api/v2/torrents/add");
        then.status(200).body("");
    });

    let base = format!("{}/", server.base_url());
    let client = QBitClient::new(base);
    let res = client
        .add_magnet("magnet:?xt=urn:btih:abc", None, None)
        .await;
    assert!(res.is_ok(), "expected add_magnet Ok, got {res:?}");
}

#[tokio::test]
async fn qbit_status_maps_fields() {
    let server = MockServer::start();
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    let _m = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v2/torrents/info")
            .query_param("hashes", info_hash);
        then.status(200)
            .header("content-type", "application/json")
            .body(
                serde_json::json!([
                    {
                      "hash": info_hash,
                      "name": "Example Movie 1080p",
                      "state": "downloading",
                      "progress": 0.5,
                      "dlspeed": 1024,
                      "upspeed": 2048,
                      "downloaded": 12345678,
                      "uploaded": 87654321,
                      "total_size": 999999999,
                      "save_path": "C:/Downloads"
                    }
                ])
                .to_string(),
            );
    });

    let base = format!("{}/", server.base_url());
    let client = QBitClient::new(base);
    let st = client.status(info_hash).await.unwrap();
    assert!(st.exists);
    assert_eq!(st.info_hash, info_hash);
    assert!(st.size > 0);
    assert_eq!(st.download_rate, 1024);
    assert_eq!(st.upload_rate, 2048);
}

#[tokio::test]
async fn qbit_files_listing_basic() {
    let server = MockServer::start();
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    let _m = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v2/torrents/files")
            .query_param("hash", info_hash);
        then.status(200)
            .header("content-type", "application/json")
            .body(
                serde_json::json!([
                    { "name": "video.mkv", "size": 1000, "progress": 0.5, "priority": 1 },
                    { "name": "readme.txt", "size": 100, "progress": 1.0, "priority": 0 }
                ])
                .to_string(),
            );
    });

    let base = format!("{}/", server.base_url());
    let client = QBitClient::new(base);
    let files = client.list_files(info_hash).await.unwrap();
    assert_eq!(files.len(), 2);
    assert!(files[0].is_media);
}
