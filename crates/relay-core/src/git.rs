use anyhow::{Context, Result};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::io::{Read, Write};

#[derive(Debug)]
pub struct GitServerHandle {
    pub port: u16,
    pub repos_root: PathBuf,
    shutdown: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

#[cfg(feature = "git")]
pub fn start_git_server<P: AsRef<Path>>(port: u16, repos_root: P) -> Result<GitServerHandle> {
    let root = repos_root.as_ref().to_path_buf();
    let bind_addr = format!("0.0.0.0:{}", port);
    let listener = TcpListener::bind(&bind_addr)
        .with_context(|| format!("Failed to bind git server on {}", bind_addr))?;
    listener
        .set_nonblocking(false)
        .with_context(|| "Failed to configure git listener" )?;

    let shutdown = Arc::new(AtomicBool::new(false));
    let sd_flag = shutdown.clone();

    log::info!(
        "[git] Starting scaffold git server on {} serving repos at {}",
        bind_addr,
        root.display()
    );

    let handle_root = root.clone();
    let thread: JoinHandle<()> = thread::spawn(move || {
        for incoming in listener.incoming() {
            if sd_flag.load(Ordering::SeqCst) {
                break;
            }
            match incoming {
                Ok(mut stream) => {
                    if let Err(e) = handle_client(&mut stream, &handle_root) {
                        log::warn!("[git] Client handling error: {}", e);
                    }
                }
                Err(e) => {
                    // Spurious wakeups or errors
                    log::debug!("[git] Accept error: {}", e);
                    // Short sleep to avoid busy loop
                    std::thread::sleep(Duration::from_millis(50));
                }
            }
        }
        log::info!("[git] Git server thread exiting");
    });

    Ok(GitServerHandle { port, repos_root: root, shutdown, thread: Some(thread) })
}

#[cfg(feature = "git")]
pub fn stop_git_server(mut handle: GitServerHandle) -> Result<()> {
    log::info!("[git] Stopping git server on port {}", handle.port);
    handle.shutdown.store(true, Ordering::SeqCst);
    // Nudge the blocking accept() by opening a local connection
    let _ = TcpStream::connect(("127.0.0.1", handle.port));
    if let Some(j) = handle.thread.take() {
        let _ = j.join();
    }
    Ok(())
}

#[cfg(feature = "git")]
fn handle_client(stream: &mut TcpStream, repos_root: &Path) -> Result<()> {
    let peer = stream
        .peer_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    log::info!("[git] Connection from {} -> repos {}", peer, repos_root.display());

    // Parse initial request line for git smart protocol over TCP (git://)
    // Expected like: "git-upload-pack /<name>\0host=<host>\0..."
    let mut buf = [0u8; 1024];
    let n = stream.read(&mut buf).unwrap_or(0);
    if n == 0 {
        log::debug!("[git] empty request from {}", peer);
        return Ok(());
    }
    let req = String::from_utf8_lossy(&buf[..n]);
    let mut parts = req.splitn(2, '\0');
    let first = parts.next().unwrap_or("");
    let _rest = parts.next(); // unused for now (host, extra)

    let (service, raw_path) = match first.split_once(' ') {
        Some((svc, p)) => (svc.trim(), p.trim()),
        None => {
            log::warn!("[git] malformed request: {}", first);
            write_err_pkt(stream, "malformed git request")?;
            return Ok(());
        }
    };

    let mut name = raw_path.trim_start_matches('/').trim_end_matches(".git");
    // Safety check on repo name
    if !is_safe_repo_name(name) {
        write_err_pkt(stream, "invalid repository name")?;
        return Ok(());
    }

    // Resolve path to ensure repo exists and is non-bare
    if let Some(repo_path) = resolve_repo_path(repos_root, name) {
        log::info!("[git] {} -> {}", service, repo_path.display());
        // For now, respond with a protocol-level error but confirm discovery works
        match service {
            "git-upload-pack" | "git-receive-pack" => {
                write_err_pkt(stream, "git protocol not yet implemented (advertise-refs/upload-pack/receive-pack WIP)")?;
            }
            _ => {
                write_err_pkt(stream, "unsupported service")?;
            }
        }
    } else {
        write_err_pkt(stream, "repository not found or not a non-bare repo with .git directory")?;
    }
    Ok(())
}

#[cfg(feature = "git")]
fn write_err_pkt(stream: &mut TcpStream, msg: &str) -> Result<()> {
    // pkt-line: 4-hex length including length itself
    let line = format!("ERR {}\n", msg);
    let pkt = pkt_line(&line);
    stream.write_all(pkt.as_bytes())?;
    // flush-pkt
    stream.write_all(b"0000")?;
    Ok(())
}

#[cfg(feature = "git")]
fn pkt_line(s: &str) -> String {
    let len = s.len() + 4;
    format!("{:04x}{}", len, s)
}

#[cfg(not(feature = "git"))]
pub fn start_git_server<P: AsRef<Path>>(port: u16, repos_root: P) -> Result<GitServerHandle> {
    let root = repos_root.as_ref().to_path_buf();
    log::warn!(
        "[git] Git feature disabled; not actually starting server. Intended port {} root {}",
        port,
        root.display()
    );
    Ok(GitServerHandle { port, repos_root: root, shutdown: Arc::new(AtomicBool::new(false)), thread: None })
}

#[cfg(not(feature = "git"))]
pub fn stop_git_server(_handle: GitServerHandle) -> Result<()> {
    log::warn!("[git] Git feature disabled; nothing to stop.");
    Ok(())
}

// --- Repo name parsing & safety helpers -----------------------------------------------------
#[cfg(feature = "git")]
pub fn is_safe_repo_name(name: &str) -> bool {
    if name.is_empty() || name.len() > 200 { return false; }
    if name.starts_with('.') { return false; }
    if name.contains('/') || name.contains('\\') { return false; }
    if name.contains("..") { return false; }
    // Allow [A-Za-z0-9_-]
    name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

#[cfg(feature = "git")]
pub fn resolve_repo_path(repos_root: &Path, name: &str) -> Option<PathBuf> {
    if !is_safe_repo_name(name) { return None; }
    let p = repos_root.join(name);
    // Non-bare, checked-out working tree expected (has .git directory)
    let git_dir = p.join(".git");
    if git_dir.is_dir() { Some(p) } else { None }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn repo_name_safety() {
        assert!(is_safe_repo_name("movies"));
        assert!(is_safe_repo_name("My_Repo-1"));
        assert!(!is_safe_repo_name(""));
        assert!(!is_safe_repo_name(".hidden"));
        assert!(!is_safe_repo_name("../etc"));
        assert!(!is_safe_repo_name("bad/name"));
        assert!(!is_safe_repo_name("bad\\name"));
        assert!(!is_safe_repo_name("semi;colon"));
    }

    #[test]
    fn resolve_requires_non_bare() {
        // Create a temporary directory layout in target for test isolation
        let tmp = std::env::temp_dir().join("relay_core_git_tests");
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // Make a fake non-bare repo with .git directory
        let movies = tmp.join("movies");
        std::fs::create_dir_all(movies.join(".git")).unwrap();

        // A bare-like dir without .git should not resolve
        let bareish = tmp.join("bareish");
        std::fs::create_dir_all(&bareish).unwrap();

        assert_eq!(resolve_repo_path(&tmp, "movies"), Some(movies));
        assert_eq!(resolve_repo_path(&tmp, "bareish"), None);
        assert_eq!(resolve_repo_path(&tmp, "../hack"), None);

        let _ = std::fs::remove_dir_all(&tmp);
    }
}
