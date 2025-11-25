use crate::errors::Result;

#[derive(Debug, Clone)]
pub struct PlayConfirm {
    pub proceed: bool,
    pub remember: bool,
}

#[async_trait::async_trait]
pub trait UiPrompt: Send + Sync {
    async fn pick_download_dir(&self, suggested: Option<&str>) -> Result<Option<String>>;
    async fn confirm_play(
        &self,
        title: &str,
        file_path: &str,
        size_bytes: u64,
    ) -> Result<PlayConfirm>;
}

// Optional video player abstraction (client feature)
#[cfg(feature = "client")]
#[async_trait::async_trait]
pub trait VideoPlayer: Send + Sync {
    async fn play(&self, path: &str) -> Result<()>;
}
