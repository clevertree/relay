use streaming_files::env::load_env;

fn snapshot_env(keys: &[&str]) -> Vec<(String, Option<String>)> {
    keys.iter()
        .map(|k| (k.to_string(), std::env::var(k).ok()))
        .collect()
}

fn restore_env(vars: Vec<(String, Option<String>)>) {
    for (k, v) in vars {
        match v {
            Some(val) => std::env::set_var(&k, val),
            None => std::env::remove_var(&k),
        }
    }
}

#[test]
fn env_parsing_defaults_and_overrides() {
    // Run in a single test to avoid parallel env races
    let keys = [
        "RELAY_QBT_HOST","RELAY_QBT_PORT","RELAY_QBT_BASE","RELAY_QBT_USER","RELAY_QBT_PASS","RELAY_QBT_BYPASS_LOCALHOST",
        "RELAY_TR_HOST","RELAY_TR_PORT","RELAY_TR_PATH","RELAY_TR_USER","RELAY_TR_PASS",
        "RELAY_STREAM_DOWNLOAD_DIR",
    ];
    let snap = snapshot_env(&keys);

    // Defaults
    for k in &keys { std::env::remove_var(k); }
    let e = load_env();
    assert_eq!(e.qbt.host, "127.0.0.1");
    assert_eq!(e.qbt.port, 8080);
    assert_eq!(e.qbt.base, "/");
    assert!(e.qbt.bypass_localhost);
    assert_eq!(e.tr.host, "127.0.0.1");
    assert_eq!(e.tr.port, 9091);
    assert_eq!(e.tr.path, "/transmission/rpc");

    // Overrides
    std::env::set_var("RELAY_QBT_HOST", "10.0.0.5");
    std::env::set_var("RELAY_QBT_PORT", "9000");
    std::env::set_var("RELAY_QBT_BASE", "/base");
    std::env::set_var("RELAY_TR_HOST", "192.168.1.99");
    std::env::set_var("RELAY_TR_PORT", "9191");
    std::env::set_var("RELAY_TR_PATH", "/rpc");
    std::env::set_var("RELAY_STREAM_DOWNLOAD_DIR", "/tmp/dl");

    let e2 = load_env();
    assert_eq!(e2.qbt.host, "10.0.0.5");
    assert_eq!(e2.qbt.port, 9000);
    assert_eq!(e2.qbt.base, "/base");
    assert_eq!(e2.tr.host, "192.168.1.99");
    assert_eq!(e2.tr.port, 9191);
    assert_eq!(e2.tr.path, "/rpc");
    assert_eq!(e2.download_dir.as_deref(), Some("/tmp/dl"));

    restore_env(snap);
}
