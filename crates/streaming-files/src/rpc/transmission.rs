use crate::errors::{Result, StreamingError};
use crate::model::{AddResult, TorrentFile, TorrentState, TorrentStatus};
use crate::rpc::TorrentClient;
use reqwest::header::HeaderValue;
use reqwest::Client;
use serde::{Deserialize, Serialize};

pub struct TransmissionClient {
    pub base_url: String,
    client: Client,
}

impl TransmissionClient {
    pub fn new<S: Into<String>>(base_url: S) -> Self {
        let b = base_url.into();
        // Do not force trailing slash; Transmission RPC is a full path endpoint
        let client = Client::builder()
            .cookie_store(true)
            .build()
            .expect("reqwest client");
        Self { base_url: b, client }
    }

    async fn rpc<T: for<'de> Deserialize<'de>, A: Serialize + ?Sized>(&self, method: &str, args: &A) -> Result<T> {
        #[derive(Serialize)]
        struct Req<'a, A: Serialize + ?Sized> { method: &'a str, arguments: &'a A }
        #[derive(Deserialize)]
        struct Resp<T> { result: String, arguments: Option<T> }

        // First try without a session id
        let req1 = self.client
            .post(&self.base_url)
            .json(&Req { method, arguments: args });
        let mut resp = req1
            .send()
            .await
            .map_err(|e| StreamingError::RpcUnavailable(format!("transmission request failed: {}", e)))?;
        if resp.status().as_u16() == 409 {
            // Get new session id from header and retry once
            if let Some(h) = resp.headers().get("X-Transmission-Session-Id").cloned() {
                if let Ok(s) = header_to_string(&h) {
                    let req2 = self.client
                        .post(&self.base_url)
                        .header("X-Transmission-Session-Id", s)
                        .json(&Req { method, arguments: args });
                    resp = req2
                        .send()
                        .await
                        .map_err(|e| StreamingError::RpcUnavailable(format!("transmission request failed: {}", e)))?;
                }
            }
        }
        if !resp.status().is_success() {
            return Err(StreamingError::RpcUnavailable(format!("transmission http {}", resp.status())));
        }
        let body = resp.json::<Resp<T>>().await.map_err(|e| StreamingError::RpcUnavailable(format!("transmission decode: {}", e)))?;
        if body.result != "success" { return Err(StreamingError::RpcUnavailable(format!("transmission result: {}", body.result))); }
        body.arguments.ok_or_else(|| StreamingError::RpcUnavailable("missing arguments in transmission response".into()))
    }
}

fn header_to_string(h: &HeaderValue) -> std::result::Result<String, std::string::FromUtf8Error> {
    String::from_utf8(h.as_bytes().to_vec())
}

#[derive(Debug, Deserialize)]
struct SessionGet {}

#[derive(Debug, Deserialize)]
struct TorrentGetResp {
    torrents: Vec<TorrentItem>,
}

#[derive(Debug, Deserialize)]
struct TorrentItem {
    id: Option<i64>,
    name: Option<String>,
    #[serde(rename = "hashString")] 
    hash_string: Option<String>,
    #[serde(rename = "percentDone")] 
    percent_done: Option<f64>,
    #[serde(rename = "rateDownload")] 
    rate_download: Option<u64>,
    #[serde(rename = "rateUpload")] 
    rate_upload: Option<u64>,
    #[serde(rename = "sizeWhenDone")] 
    size_when_done: Option<u64>,
    #[serde(rename = "downloadedEver")] 
    downloaded_ever: Option<u64>,
    #[serde(rename = "downloadDir")] 
    download_dir: Option<String>,
    status: Option<i32>,
    files: Option<Vec<TFile>>, 
    #[serde(rename = "fileStats")] 
    file_stats: Option<Vec<TFileStat>>, 
}

#[derive(Debug, Deserialize)]
struct TFile { name: String, length: u64 }

#[derive(Debug, Deserialize)]
struct TFileStat { #[serde(rename = "bytesCompleted")] bytes_completed: u64, priority: i32 }

fn map_tr_status(code: i32) -> TorrentState {
    // Transmission status codes: 0 Stopped, 1 CheckWait, 2 Checking, 3 DownloadWait, 4 Download, 5 SeedWait, 6 Seed
    match code {
        c if c == 0 => TorrentState::Paused,
        c if c == 1 || c == 2 => TorrentState::Checking,
        c if c == 3 || c == 4 => TorrentState::Downloading,
        c if c == 5 || c == 6 => TorrentState::Seeding,
        _ => TorrentState::Unknown,
    }
}

#[async_trait::async_trait]
impl TorrentClient for TransmissionClient {
    fn name(&self) -> &'static str { "transmission" }
    async fn healthy(&self) -> Result<bool> {
        #[derive(serde::Serialize)]
        struct Args {}
        let res: std::result::Result<SessionGet, _> = self.rpc("session-get", &Args {}).await;
        Ok(res.is_ok())
    }

    async fn add_magnet(&self, magnet: &str, save_path: Option<&str>, _seeding: Option<bool>) -> Result<AddResult> {
        #[derive(Serialize)]
        struct Args<'a> { #[serde(rename = "filename")] filename: &'a str, #[serde(rename = "download-dir", skip_serializing_if = "Option::is_none")] download_dir: Option<&'a str> }
        #[derive(Deserialize)]
        struct Out { #[serde(rename = "torrent-added")] torrent_added: Option<Added>, #[serde(rename = "torrent-duplicate")] torrent_duplicate: Option<Added> }
        #[derive(Deserialize)]
        struct Added { hashString: Option<String>, name: Option<String> }
        let args = Args { filename: magnet, download_dir: save_path };
        let out: Out = self.rpc("torrent-add", &args).await?;
        let added = out.torrent_added.or(out.torrent_duplicate);
        if let Some(a) = added { Ok(AddResult { info_hash: a.hashString.unwrap_or_default(), name: a.name }) } else { Ok(AddResult { info_hash: String::new(), name: None }) }
    }

    async fn status(&self, info_hash: &str) -> Result<TorrentStatus> {
        #[derive(Serialize)]
        struct Args<'a> { fields: Vec<&'a str>, ids: Vec<&'a str> }
        let args = Args { fields: vec!["id","name","hashString","percentDone","rateDownload","rateUpload","sizeWhenDone","downloadedEver","downloadDir","status"], ids: vec![info_hash] };
        let out: TorrentGetResp = self.rpc("torrent-get", &args).await?;
        if let Some(t) = out.torrents.into_iter().next() {
            let size = t.size_when_done.unwrap_or(0);
            let downloaded = t.downloaded_ever.unwrap_or(0);
            let progress = t.percent_done.unwrap_or(0.0) as f32;
            let state = t.status.map(map_tr_status).unwrap_or(TorrentState::Unknown);
            return Ok(TorrentStatus {
                exists: true,
                state,
                progress,
                size,
                downloaded,
                upload: 0,
                download_rate: t.rate_download.unwrap_or(0),
                upload_rate: t.rate_upload.unwrap_or(0),
                info_hash: info_hash.to_string(),
                name: t.name,
                save_path: t.download_dir,
                files_known: false,
            });
        }
        Ok(TorrentStatus { exists: false, state: TorrentState::Unknown, progress: 0.0, size: 0, downloaded: 0, upload: 0, download_rate: 0, upload_rate: 0, info_hash: info_hash.to_string(), name: None, save_path: None, files_known: false })
    }

    async fn list_files(&self, info_hash: &str) -> Result<Vec<TorrentFile>> {
        #[derive(Serialize)]
        struct Args<'a> { fields: Vec<&'a str>, ids: Vec<&'a str> }
        let args = Args { fields: vec!["hashString","files","fileStats"], ids: vec![info_hash] };
        let out: TorrentGetResp = self.rpc("torrent-get", &args).await?;
        if let Some(t) = out.torrents.into_iter().next() {
            let files = t.files.unwrap_or_default();
            let stats = t.file_stats.unwrap_or_default();
            let out: Vec<TorrentFile> = files.into_iter().enumerate().map(|(idx, f)| {
                let downloaded = stats.get(idx).map(|s| s.bytes_completed).unwrap_or(0);
                let priority = stats.get(idx).map(|s| s.priority.max(0) as u8).unwrap_or(0);
                let is_media = crate::model::is_media_path(&f.name);
                TorrentFile { index: idx, path: f.name, length: f.length, downloaded, priority, is_media }
            }).collect();
            return Ok(out);
        }
        Ok(vec![])
    }

    async fn set_seeding(&self, info_hash: &str, on: bool) -> Result<()> {
        #[derive(Serialize)]
        struct Args<'a> { ids: Vec<&'a str> }
        let args = Args { ids: vec![info_hash] };
        let method = if on { "torrent-start" } else { "torrent-stop" };
        let _: serde_json::Value = self.rpc(method, &args).await?;
        Ok(())
    }

    async fn save_path(&self, info_hash: &str) -> Result<Option<String>> {
        #[derive(Serialize)]
        struct Args<'a> { fields: Vec<&'a str>, ids: Vec<&'a str> }
        let args = Args { fields: vec!["downloadDir"], ids: vec![info_hash] };
        let out: TorrentGetResp = self.rpc("torrent-get", &args).await?;
        Ok(out.torrents.into_iter().next().and_then(|t| t.download_dir))
    }
}
