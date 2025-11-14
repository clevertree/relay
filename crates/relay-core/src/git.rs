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
        "[git] Starting git server on {} serving repos at {}",
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

    let name = raw_path.trim_start_matches('/').trim_end_matches(".git");
    // Safety check on repo name
    if !is_safe_repo_name(name) {
        write_err_pkt(stream, "invalid repository name")?;
        return Ok(());
    }

    // Resolve path to ensure repo exists and is non-bare
    if let Some(repo_path) = resolve_repo_path(repos_root, name) {
        log::info!("[git] {} -> {}", service, repo_path.display());
        match service {
            "git-upload-pack" => {
                advertise_refs(stream, &repo_path, service).or_else(|e| {
                    log::warn!("[git] advertise-refs failed: {}", e);
                    write_err_pkt(stream, "failed to advertise refs")
                })?;
                // Proceed to (minimal) negotiation; full upload-pack will be implemented in M3.2
                if let Err(e) = handle_upload_pack(stream, &repo_path) {
                    log::warn!("[git] upload-pack negotiation error: {}", e);
                }
            }
            "git-receive-pack" => {
                // For now, we only implement discovery here as well
                advertise_refs(stream, &repo_path, service).or_else(|e| {
                    log::warn!("[git] advertise-refs (receive) failed: {}", e);
                    write_err_pkt(stream, "failed to advertise refs")
                })?;
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

#[cfg(feature = "git")]
fn read_loose_ref(path: &Path) -> Option<String> {
    std::fs::read_to_string(path).ok().map(|s| s.trim().to_string())
}

#[cfg(feature = "git")]
fn enumerate_loose_heads(git_dir: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let heads = git_dir.join("refs").join("heads");
    if heads.is_dir() {
        let walk = std::fs::read_dir(&heads).ok();
        if let Some(walk) = walk {
            for entry in walk.flatten() {
                if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
                    let name = entry.file_name().to_string_lossy().to_string();
                    if let Some(oid) = read_loose_ref(&entry.path()) {
                        if oid.len() >= 40 { out.push((oid[..40].to_string(), format!("refs/heads/{}", name))); }
                    }
                }
            }
        }
    }
    out
}

#[cfg(feature = "git")]
fn read_head_ref(git_dir: &Path) -> (Option<String>, Option<String>) {
    // Returns (symref target, resolved oid if direct)
    let head = git_dir.join("HEAD");
    if let Some(content) = read_loose_ref(&head) {
        if let Some(rest) = content.strip_prefix("ref: ") {
            return (Some(rest.to_string()), None);
        } else {
            // direct
            let oid = content.trim().to_string();
            if oid.len() >= 40 { return (None, Some(oid[..40].to_string())); }
        }
    }
    (None, None)
}

#[cfg(feature = "git")]
fn advertise_refs(stream: &mut TcpStream, repo_path: &Path, service: &str) -> Result<()> {
    let git_dir = repo_path.join(".git");
    // Gather refs
    let mut refs = enumerate_loose_heads(&git_dir);

    // HEAD
    let (head_symref, head_oid_direct) = read_head_ref(&git_dir);
    let head_oid = if let Some(sym) = &head_symref {
        let target = git_dir.join(sym);
        read_loose_ref(&target).and_then(|s| if s.len()>=40 { Some(s[..40].to_string()) } else { None })
    } else { head_oid_direct };

    // Build capabilities (minimal)
    let caps = vec!["multi_ack".to_string(), "side-band-64k".to_string(), "symref=HEAD:".to_string() + head_symref.as_deref().unwrap_or("refs/heads/main")];
    let capabilities = caps.join(" ");

    // First line: either HEAD or first ref carries capabilities with NUL separator
    let mut first_line_written = false;
    if let Some(oid) = head_oid {
        let mut line = format!("{} {}\0{}\n", oid, "HEAD", capabilities);
        let pkt = pkt_line(&line);
        stream.write_all(pkt.as_bytes())?;
        first_line_written = true;
    }

    for (oid, name) in refs.drain(..) {
        let line = if !first_line_written {
            first_line_written = true;
            format!("{} {}\0{}\n", oid, name, capabilities)
        } else {
            format!("{} {}\n", oid, name)
        };
        let pkt = pkt_line(&line);
        stream.write_all(pkt.as_bytes())?;
    }

    // flush
    stream.write_all(b"0000")?;
    Ok(())
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


#[cfg(feature = "git")]
fn read_pkt_line(stream: &mut TcpStream) -> Result<Option<String>> {
    let mut hdr = [0u8; 4];
    stream.read_exact(&mut hdr)?;
    let len_hex = std::str::from_utf8(&hdr).context("Invalid pkt-line header")?;
    if len_hex == "0000" {
        return Ok(None); // flush
    }
    let len = u16::from_str_radix(len_hex, 16).context("Bad pkt-line length")? as usize;
    if len < 4 { anyhow::bail!("Invalid pkt-line length <4"); }
    let payload_len = len - 4;
    let mut payload = vec![0u8; payload_len];
    stream.read_exact(&mut payload)?;
    let s = String::from_utf8(payload).context("pkt payload not utf8")?;
    Ok(Some(s))
}

#[cfg(feature = "git")]
fn resolve_ref_oid(git_dir: &Path, refname: &str) -> Option<String> {
    let target = git_dir.join(refname);
    read_loose_ref(&target).and_then(|s| if s.len() >= 40 { Some(s[..40].to_string()) } else { None })
}

#[cfg(feature = "git")]
fn handle_upload_pack(stream: &mut TcpStream, repo_path: &Path) -> Result<()> {
    // Minimal negotiation parser: collect wants/deepen/done then reply with ERR for now.
    // This scaffolds M3.2; actual pack streaming will replace this.
    log::debug!("[git] upload-pack: waiting for negotiation lines");

    let git_dir = repo_path.join(".git");
    let main_ref = "refs/heads/main";
    let head_oid_main = resolve_ref_oid(&git_dir, main_ref);

    // Read first phase: wants until flush
    let mut wants: Vec<String> = Vec::new();
    let mut requested_deepen: Option<u32> = None;
    loop {
        match read_pkt_line(stream)? {
            Some(line) => {
                let line_trim = line.trim_end_matches('\n');
                if let Some(rest) = line_trim.strip_prefix("want ") {
                    // First 'want' may carry capabilities after NUL; keep OID part
                    let oid_part = rest.splitn(2, '\0').next().unwrap_or(rest).trim();
                    wants.push(oid_part.to_string());
                } else if let Some(rest) = line_trim.strip_prefix("deepen ") {
                    if let Ok(n) = rest.trim().parse::<u32>() { requested_deepen = Some(n); }
                    log::debug!("[git] client requested deepen {:?}", requested_deepen);
                } else if line_trim == "done" {
                    // Some clients send done before flush
                    log::debug!("[git] client sent done");
                } else {
                    log::debug!("[git] upload-pack: other line: {}", line_trim.escape_debug());
                }
            }
            None => break, // flush
        }
    }

    if wants.is_empty() {
        write_err_pkt(stream, "no 'want' received in upload-pack")?;
        return Ok(());
    }

    // Validate that the want matches our main head (v1 scope)
    if let Some(main_oid) = head_oid_main {
        if !wants.iter().any(|w| w == &main_oid) {
            write_err_pkt(stream, "requested OID not available (only refs/heads/main supported in v1)")?;
            return Ok(());
        }
    } else {
        write_err_pkt(stream, "refs/heads/main not found")?;
        return Ok(());
    }

    // For now, we don't generate a pack yet.
    // Acknowledge shallow request if present (log only), then return explicit WIP error.
    let _ = requested_deepen;
    write_err_pkt(stream, "upload-pack not implemented yet (M3.2 WIP)")?;
    Ok(())
}
