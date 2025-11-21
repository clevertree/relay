use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use clap::{Parser, Subcommand};
use std::fs;
use std::io::{self, Read, Write};

#[derive(Parser, Debug)]
#[command(version, about = "Relay CLI client")] 
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Connect to a relay server and print status
    Connect { 
        /// Server socket, e.g. http://localhost:8088 or localhost:8088
        socket: String,
    },
    /// Download a file from the server
    Get {
        /// e.g. localhost:8088
        socket: String,
        /// file path inside repo (e.g. data/2024/Movie/meta.json)
        filepath: String,
        /// Branch (default main)
        #[arg(long, default_value = "main")]
        branch: String,
        /// Output file (defaults to stdout if omitted)
        #[arg(long)]
        out: Option<String>,
    },
    /// Upload a file to the server
    Put {
        /// e.g. localhost:8088
        socket: String,
        /// file path inside repo
        filepath: String,
        /// Branch (default main)
        #[arg(long, default_value = "main")]
        branch: String,
        /// Read body from file path (if omitted, read from stdin)
        #[arg(long)]
        from: Option<String>,
    },
    /// Execute a query against the server
    Query {
        /// e.g. localhost:8088
        socket: String,
        /// Optional path suffix after /query (rare)
        #[arg(long)]
        path: Option<String>,
        /// Branch or 'all' (default main)
        #[arg(long, default_value = "main")]
        branch: String,
        /// Query body: either a JSON string or plain text; if omitted, send empty body
        #[arg(long)]
        body: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Commands::Connect { socket } => {
            let status = relay_lib::connect_status(&socket).await?;
            println!("{}", serde_json::to_string_pretty(&status)?);
        }
        Commands::Get { socket, filepath, branch, out } => {
            let bytes = relay_lib::get_file(&socket, &filepath, &branch).await?;
            if let Some(path) = out {
                fs::write(path, &bytes)?;
            } else {
                io::stdout().write_all(&bytes)?;
            }
        }
        Commands::Put { socket, filepath, branch, from } => {
            let data: Vec<u8> = if let Some(p) = from {
                fs::read(p)?
            } else {
                let mut buf = Vec::new();
                io::stdin().read_to_end(&mut buf)?;
                buf
            };
            let resp = relay_lib::put_file(&socket, &filepath, &branch, Bytes::from(data)).await?;
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
        Commands::Query { socket, path, branch, body } => {
            let body_json = if let Some(b) = body {
                // Try parse as JSON, else wrap as { q: string }
                match serde_json::from_str::<serde_json::Value>(&b) {
                    Ok(v) => Some(v),
                    Err(_) => Some(serde_json::json!({"q": b})),
                }
            } else { None };
            let resp = relay_lib::post_query(&socket, &branch, path.as_deref(), body_json).await?;
            println!("{}", serde_json::to_string_pretty(&resp)?);
        }
    }
    Ok(())
}
