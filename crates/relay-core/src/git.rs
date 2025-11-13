use anyhow::{Context, Result};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicBool, Ordering}, Arc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use std::io::Write;

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
    let peer = stream.peer_addr().map(|a| a.to_string()).unwrap_or_else(|_| "unknown".to_string());
    log::info!("[git] Connection from {} -> repos {}", peer, repos_root.display());
    // This is a scaffold: immediately close the connection after a short banner write.
    // Real implementation (M3+) will speak mygit protocol here.
    let banner = b"relay git scaffold: mygit protocol not yet implemented\n";
    let _ = stream.write(banner);
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
