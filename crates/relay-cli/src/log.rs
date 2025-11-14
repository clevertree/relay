use log::Level;
use std::fs::OpenOptions;
use std::io::Write;

pub fn log_append(level: &str, msg: &str) {
    let _ = log::log!(target: "relay-cli", Level::Info, "{}", msg);
    // Attempt to append to a temp file for session logs; ignore errors.
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open("/tmp/relay-cli.log") {
        let _ = writeln!(f, "[{}] {}", level, msg);
    }
}
