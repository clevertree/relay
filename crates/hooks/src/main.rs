use clap::Parser;
use tracing::{info, Level};

/// Simple hook runner placeholder. Intended to be invoked by Git hooks.
#[derive(Parser, Debug)]
#[command(version, about = "Relay Git hooks runner (placeholder)")]
struct Args {
    /// Hook name (e.g., pre-receive, post-receive)
    #[arg(short, long)]
    hook: String,
}

fn main() {
    tracing_subscriber::fmt()
        .with_max_level(Level::INFO)
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let args = Args::parse();
    info!(hook = %args.hook, "Hook invoked");
    // Future behavior: index metadata into a local DB for QUERY performance.
}
