use httpmock::{Method::POST, Mock, MockServer};
use streaming_files::rpc::TorrentClient; // trait methods
use streaming_files::rpc::transmission::TransmissionClient;

fn transmission_success_body<T: serde::Serialize>(arguments: T) -> String {
    serde_json::json!({ "result": "success", "arguments": arguments }).to_string()
}

#[tokio::test]
async fn transmission_healthy_handles_handshake() {
    let server = MockServer::start();

    // First call → 409 with session id header
    let _m1: Mock = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .matches(|req| {
                let has = req
                    .headers
                    .as_ref()
                    .map(|h| h.iter().any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id")))
                    .unwrap_or(false);
                !has
            });
        then.status(409)
            .header("X-Transmission-Session-Id", "abc123")
            .body("");
    });

    // Second call with header → 200 success
    let _m2: Mock = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "abc123");
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({})));
    });

    let client = TransmissionClient::new(format!("{}/transmission/rpc", server.base_url()));
    let ok = client.healthy().await.unwrap();
    assert!(ok, "expected healthy() to succeed after handshake");
}

#[tokio::test]
async fn transmission_add_magnet_success_and_duplicate() {
    let server = MockServer::start();

    // Handshake first
    let _m1 = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .matches(|req| {
                let has = req
                    .headers
                    .as_ref()
                    .map(|h| h.iter().any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id")))
                    .unwrap_or(false);
                !has
            });
        then.status(409).header("X-Transmission-Session-Id", "sess");
    });
    // Real add → success
    let _m2 = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "sess")
            .json_body_partial(r#"{"method":"torrent-add"}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({
                "torrent-added": { "hashString": "aa11", "name": "Movie" }
            })));
    });

    let client = TransmissionClient::new(format!("{}/transmission/rpc", server.base_url()));
    let add = client.add_magnet("magnet:?xt=urn:btih:aa11", None, None).await.unwrap();
    assert_eq!(add.info_hash, "aa11");
    assert_eq!(add.name.as_deref(), Some("Movie"));

    // Duplicate path
    let server2 = MockServer::start();
    let _d1 = server2.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .matches(|req| {
                let has = req
                    .headers
                    .as_ref()
                    .map(|h| h.iter().any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id")))
                    .unwrap_or(false);
                !has
            });
        then.status(409).header("X-Transmission-Session-Id", "ddup");
    });
    let _d2 = server2.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "ddup")
            .json_body_partial(r#"{"method":"torrent-add"}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({
                "torrent-duplicate": { "hashString": "bb22", "name": "Dup" }
            })));
    });
    let client2 = TransmissionClient::new(format!("{}/transmission/rpc", server2.base_url()));
    let add2 = client2.add_magnet("magnet:?xt=urn:btih:bb22", None, None).await.unwrap();
    assert_eq!(add2.info_hash, "bb22");
    assert_eq!(add2.name.as_deref(), Some("Dup"));
}

#[tokio::test]
async fn transmission_status_and_files_mapping() {
    let server = MockServer::start();

    // Handshake
    let _h1 = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .matches(|req| {
                let has = req
                    .headers
                    .as_ref()
                    .map(|h| h.iter().any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id")))
                    .unwrap_or(false);
                !has
            });
        then.status(409).header("X-Transmission-Session-Id", "tok");
    });

    // Status call
    let info_hash = "0123456789abcdef0123456789abcdef01234567";
    let _status = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "tok")
            .json_body_partial(r#"{"method":"torrent-get","arguments":{"fields":["id","name","hashString","percentDone","rateDownload","rateUpload","sizeWhenDone","downloadedEver","downloadDir","status"]}}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({
                "torrents": [
                    {
                        "name": "Example Movie 1080p",
                        "hashString": info_hash,
                        "percentDone": 0.75,
                        "rateDownload": 2048,
                        "rateUpload": 512,
                        "sizeWhenDone": 100000000,
                        "downloadedEver": 75000000,
                        "downloadDir": "C:/Downloads",
                        "status": 4
                    }
                ]
            })));
    });

    let client = TransmissionClient::new(format!("{}/transmission/rpc", server.base_url()));
    let st = client.status(info_hash).await.unwrap();
    assert!(st.exists);
    assert_eq!(st.info_hash, info_hash);
    assert_eq!(st.download_rate, 2048);
    assert_eq!(st.upload_rate, 512);

    // Files call (new handshake not triggered because mock matches with header again)
    let _files = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "tok")
            .json_body_partial(r#"{"method":"torrent-get","arguments":{"fields":["hashString","files","fileStats"]}}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({
                "torrents": [
                    {
                        "hashString": info_hash,
                        "files": [
                            { "name": "video.mkv", "length": 100000000 },
                            { "name": "readme.txt", "length": 1000 }
                        ],
                        "fileStats": [
                            { "bytesCompleted": 80000000, "priority": 1 },
                            { "bytesCompleted": 1000, "priority": 0 }
                        ]
                    }
                ]
            })));
    });

    let files = client.list_files(info_hash).await.unwrap();
    assert_eq!(files.len(), 2);
    assert!(files[0].is_media);
    assert_eq!(files[0].downloaded, 80000000);
}

#[tokio::test]
async fn transmission_start_and_stop() {
    let server = MockServer::start();
    // Handshake
    let _h1 = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .matches(|req| {
                let has = req
                    .headers
                    .as_ref()
                    .map(|h| h.iter().any(|(k, _)| k.eq_ignore_ascii_case("X-Transmission-Session-Id")))
                    .unwrap_or(false);
                !has
            });
        then.status(409).header("X-Transmission-Session-Id", "tok2");
    });
    // Start
    let _start = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "tok2")
            .json_body_partial(r#"{"method":"torrent-start"}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({})));
    });
    // Stop
    let _stop = server.mock(|when, then| {
        when.method(POST)
            .path("/transmission/rpc")
            .header("X-Transmission-Session-Id", "tok2")
            .json_body_partial(r#"{"method":"torrent-stop"}"#);
        then.status(200)
            .header("content-type", "application/json")
            .body(transmission_success_body(serde_json::json!({})));
    });

    let client = TransmissionClient::new(format!("{}/transmission/rpc", server.base_url()));
    let ih = "0123456789abcdef0123456789abcdef01234567";
    client.set_seeding(ih, true).await.unwrap();
    client.set_seeding(ih, false).await.unwrap();
}
