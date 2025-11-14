use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use serde_json::Value as JsonValue;
use std::path::Path;
use std::io::Write;

#[derive(Parser, Debug)]
#[command(name = "relay")]
#[command(about = "Relay CLI", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Repository utilities
    Repo {
        #[command(subcommand)]
        cmd: RepoCmd,
    },
}

#[derive(Subcommand, Debug)]
enum RepoCmd {
    /// Validate repository at path
    Validate {
        path: String,
        #[arg(long)]
        json: bool,
    },
    /// List repositories under root
    List { root: String },
    /// Insert or update an entry based on relay.yaml rules
    Insert {
        /// Path to repository root containing relay.yaml
        path: String,
        /// JSON object with properties for the entry
        #[arg(long)]
        props: String,
        /// Replace existing meta.json entirely instead of merging
        #[arg(long, default_value_t = false)]
        replace: bool,
    },
    /// Search an index for entries matching a substring
    Search {
        /// Path to repository root containing relay.yaml
        path: String,
        /// Index name (e.g., byTitle, byDirector)
        index: String,
        /// Query substring (will be slugified to match on-disk names)
        query: String,
        /// Limit number of results
        #[arg(long)]
        limit: Option<usize>,
        /// Output JSON array instead of plain lines
        #[arg(long)]
        json: bool,
    },
}

fn main() -> Result<()> {
    env_logger::init();
    let cli = Cli::parse();
    // session-only: we do not read from previous logs. We only append new lines.
    log_append("info", &format!("relay-cli start: {:?}", std::env::args().collect::<Vec<_>>()));
    let res = match cli.command {
        Commands::Repo { cmd } => handle_repo(cmd),
    };
    match &res {
        Ok(_) => log_append("info", "relay-cli finished OK"),
        Err(e) => log_append("error", &format!("relay-cli error: {}", e)),
    }
    res
}

fn handle_repo(cmd: RepoCmd) -> Result<()> {
    use relay_repo::ops;
    match cmd {
        RepoCmd::Validate { path, json } => {
            let root = Path::new(&path);
            let violations = match ops::validate_repo(root) {
                Ok(v) => v,
                Err(e) => {
                    eprintln!("Validation error: {}", e);
                    std::process::exit(1);
                }
            };
            if json {
                println!("{}", serde_json::to_string_pretty(&violations)?);
            } else if violations.is_empty() {
                println!("Validation PASSED for {}", path);
            } else {
                eprintln!("Validation FAILED for {}:", path);
                for v in &violations {
                    eprintln!("- [{}] {} — {}", v.code, v.path, v.message);
                }
            }
            if violations.is_empty() {
                std::process::exit(0);
            } else {
                // exit 2 for violations present
                std::process::exit(2);
            }
        }
        RepoCmd::List { root } => {
            let root_path = std::path::Path::new(&root);
            if root_path.is_dir() {
                for entry in std::fs::read_dir(root_path)? {
                    let entry = entry?;
                    if entry.file_type()?.is_dir() {
                        println!("{}", entry.file_name().to_string_lossy());
                    }
                }
            } else {
                eprintln!("Not a directory: {}", root);
                std::process::exit(1);
            }
        }
        RepoCmd::Insert {
            path,
            props,
            replace,
        } => {
            let root = Path::new(&path);
            let props_json: JsonValue = serde_json::from_str(&props)
                .with_context(|| "--props must be a valid JSON object string")?;
            let res = ops::insert_entry(root, &props_json, replace)?;
            println!("Content dir: {}", res.content_dir);
            println!("Meta file  : {}", res.meta_path);
            if res.index_links.is_empty() {
                println!("Index links: (none)");
            } else {
                println!("Index links:");
                for (name, link) in res.index_links.iter() {
                    println!("  - {}: {}", name, link);
                }
            }
        }
        RepoCmd::Search {
            path,
            index,
            query,
            limit,
            json,
        } => {
            let root = Path::new(&path);
            let schema = ops::load_schema_from_repo(root)?;
            let results = ops::search_index(root, &schema, &index, &query, limit)?;
            if json {
                let rels: Vec<String> = results
                    .iter()
                    .map(|p| p.strip_prefix(root).unwrap_or(p).display().to_string())
                    .collect();
                println!("{}", serde_json::to_string_pretty(&rels)?);
            } else {
                for p in results {
                    println!("{}", p.strip_prefix(root).unwrap_or(&p).display());
                }
            }
        }
    }
    Ok(())
}
