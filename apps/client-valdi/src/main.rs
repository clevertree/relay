use clap::Parser;
use relay_client_core::{AppConfig};
use tracing::info;
use dotenvy::dotenv;

#[derive(Parser, Debug)]
#[command(name = "relay-client", version, about = "Relay Client (Valdi) shell", propagate_version = true)]
struct Cli {
    /// Optional peers list overriding RELAY_MASTER_PEER_LIST (semicolon-separated)
    #[arg(long)]
    peers: Option<String>,
    /// Keep running and re-print peers periodically (developer preview)
    #[arg(long)]
    watch: bool,
    /// Interval seconds for --watch
    #[arg(long, default_value_t = 10)]
    interval: u64,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Load .env from project root so RELAY_MASTER_PEER_LIST is available in dev
    let _ = dotenv();
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let cli = Cli::parse();
    let mut cfg = AppConfig::from_env()?;
    if let Some(p) = cli.peers {
        cfg.master_peers = p
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect();
    }
    info!(?cfg, "Loaded config");

    // Developer preview: optionally keep running and re-print on interval
    if cli.watch {
        loop {
            let now = chrono::Local::now();
            let peers = cfg.master_peers.clone();
            if peers.is_empty() {
                println!("[{}] No peers configured. Set RELAY_MASTER_PEER_LIST or pass --peers.", now.format("%Y-%m-%d %H:%M:%S"));
            } else {
                println!("[{}] Peers:", now.format("%Y-%m-%d %H:%M:%S"));
                for p in &peers {
                    println!(" - {}", p);
                }
            }
            tokio::time::sleep(std::time::Duration::from_secs(cli.interval)).await;
        }
    } else {
        // Placeholder: print peers and exit; Valdi UI wiring will come next.
        if cfg.master_peers.is_empty() {
            println!("No peers configured. Set RELAY_MASTER_PEER_LIST or pass --peers.");
        } else {
            println!("Peers:");
            for p in cfg.master_peers {
                println!(" - {}", p);
            }
        }
    }

    Ok(())
}
