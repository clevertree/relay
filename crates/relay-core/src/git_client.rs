use anyhow::{Context, Result};
use std::net::TcpStream;
use std::io::{Read, Write};

#[derive(Debug, Clone)]
pub struct AdvertisedRef {
    pub oid: String,
    pub name: String, // e.g., "HEAD" or "refs/heads/main"
}

#[derive(Debug, Clone)]
pub struct Discovery {
    pub refs: Vec<AdvertisedRef>,
    pub capabilities: Vec<String>,
    pub head_symref: Option<String>, // e.g., Some("refs/heads/main")
}

fn pkt_line(s: &str) -> String { format!("{:04x}{}", s.len() + 4, s) }

fn read_pkt_line(stream: &mut TcpStream) -> Result<Option<String>> {
    let mut hdr = [0u8; 4];
    stream.read_exact(&mut hdr)?;
    let len_hex = std::str::from_utf8(&hdr).context("Invalid pkt-line header")?;
    if len_hex == "0000" { return Ok(None); }
    let len = u16::from_str_radix(len_hex, 16).context("Bad pkt-line length")? as usize;
    if len < 4 { anyhow::bail!("Invalid pkt-line length <4"); }
    let mut payload = vec![0u8; len - 4];
    stream.read_exact(&mut payload)?;
    Ok(Some(String::from_utf8(payload).context("pkt payload not utf8")?))
}

fn parse_git_url(url: &str) -> Result<(String, u16, String)> {
    // returns (host, port, repo)
    let (host_port, path) = url.strip_prefix("git://")
        .and_then(|s| s.split_once('/'))
        .context("Invalid git url; expected git://host[:port]/repo")?;
    let (host, port) = if let Some((h, p)) = host_port.split_once(':') {
        let port: u16 = p.parse().context("Invalid port in url")?;
        (h.to_string(), port)
    } else { (host_port.to_string(), 9418) };
    let repo = path.trim_matches('/');
    if repo.is_empty() { anyhow::bail!("Missing repo name in url"); }
    Ok((host, port, repo.to_string()))
}

pub fn discover(url: &str) -> Result<Discovery> {
    let (host, port, repo) = parse_git_url(url)?;
    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).with_context(|| format!("Failed to connect to {}", addr))?;

    // Send request line: service and path, then NUL separated key-values
    let req = format!("git-upload-pack /{}\0host={}\0", repo, host);
    stream.write_all(req.as_bytes())?;

    // Read pkt-lines until flush (0000)
    let mut refs: Vec<AdvertisedRef> = Vec::new();
    let mut capabilities: Vec<String> = Vec::new();
    let mut head_symref: Option<String> = None;

    let mut first = true;
    loop {
        match read_pkt_line(&mut stream)? {
            Some(line) => {
                if first {
                    // first line may have NUL separator for capabilities
                    if let Some((left, caps)) = line.split_once('\0') {
                        capabilities = caps.trim_end_matches('\n').split(' ').map(|s| s.to_string()).collect();
                        // pull symref from capabilities if present
                        for cap in &capabilities {
                            if let Some(rest) = cap.strip_prefix("symref=HEAD:") {
                                head_symref = Some(rest.to_string());
                            }
                        }
                        // Parse the left part as the actual ref line
                        let lt = left.trim_end_matches('\n');
                        if let Some((oid, name)) = lt.split_once(' ') {
                            refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                        }
                    } else {
                        // No capabilities; parse as a normal ref line
                        let lt = line.trim_end_matches('\n');
                        if let Some((oid, name)) = lt.split_once(' ') {
                            refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                        }
                    }
                    first = false;
                } else {
                    // Subsequent lines: no NUL capabilities, just refs
                    let lt = line.trim_end_matches('\n');
                    if let Some((oid, name)) = lt.split_once(' ') {
                        refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                    }
                }
            }
            None => break,
        }
    }

    Ok(Discovery { refs, capabilities, head_symref })
}

pub fn negotiate_and_request_pack(url: &str, shallow: bool) -> Result<TcpStream> {
    // Returns the open stream positioned for receiving the packfile from server
    let (host, port, repo) = parse_git_url(url)?;
    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr).with_context(|| format!("Failed to connect to {}", addr))?;

    // Discovery request
    let req = format!("git-upload-pack /{}\0host={}\0", repo, host);
    stream.write_all(req.as_bytes())?;

    // Parse advertise-refs to choose target OID for main
    let mut refs: Vec<AdvertisedRef> = Vec::new();
    let mut capabilities: Vec<String> = Vec::new();
    let mut head_symref: Option<String> = None;
    let mut first = true;
    loop {
        match read_pkt_line(&mut stream)? {
            Some(line) => {
                if first {
                    if let Some((left, caps)) = line.split_once('\0') {
                        capabilities = caps.trim_end_matches('\n').split(' ').map(|s| s.to_string()).collect();
                        for cap in &capabilities {
                            if let Some(rest) = cap.strip_prefix("symref=HEAD:") {
                                head_symref = Some(rest.to_string());
                            }
                        }
                        let lt = left.trim_end_matches('\n');
                        if let Some((oid, name)) = lt.split_once(' ') {
                            refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                        }
                    } else {
                        let lt = line.trim_end_matches('\n');
                        if let Some((oid, name)) = lt.split_once(' ') {
                            refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                        }
                    }
                    first = false;
                } else {
                    let lt = line.trim_end_matches('\n');
                    if let Some((oid, name)) = lt.split_once(' ') {
                        refs.push(AdvertisedRef { oid: oid.to_string(), name: name.to_string() });
                    }
                }
            }
            None => break,
        }
    }

    // Choose main OID via symref if present, else by explicit ref name
    let main_ref = head_symref.as_deref().unwrap_or("refs/heads/main");
    let target_oid = refs.iter()
        .find(|r| r.name == main_ref)
        .map(|r| r.oid.clone())
        .or_else(|| refs.iter().find(|r| r.name == "HEAD").map(|r| r.oid.clone()))
        .context("No suitable advertised ref (HEAD/main) found")?;

    // Send wants
    let want_line = format!("want {} multi_ack side-band-64k\n", target_oid);
    let want_pkt = pkt_line(&want_line);
    stream.write_all(want_pkt.as_bytes())?;

    if shallow {
        let deepen_pkt = pkt_line("deepen 1\n");
        stream.write_all(deepen_pkt.as_bytes())?;
    }

    let done_pkt = pkt_line("done\n");
    stream.write_all(done_pkt.as_bytes())?;

    // flush
    stream.write_all(b"0000")?;

    Ok(stream)
}
