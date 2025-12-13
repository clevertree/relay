use std::sync::Arc;
use streaming_files::rpc::NullClient;
use streaming_files::service::StreamingService;

#[test]
fn apply_config_patch_validates_playback_target() {
    // Build a service with a NullClient (no RPC needed for config ops)
    let svc0 = StreamingService::new_with_client(Arc::new(NullClient)).expect("svc");
    let mut svc = svc0;

    // Defaults should be present (after load/migrate)
    let cfg = svc.get_config();
    assert!(!cfg.preferred_backend.is_empty());
    assert!(matches!(
        cfg.playback_target.as_str(),
        "auto" | "tauri" | "system"
    ));

    // Accept valid value: system
    let patch = serde_json::json!({ "playback_target": "system" });
    let updated = svc.apply_config_patch(patch).expect("patch system");
    assert_eq!(updated.playback_target, "system");

    // Accept valid value: tauri
    let patch = serde_json::json!({ "playback_target": "tauri" });
    let updated = svc.apply_config_patch(patch).expect("patch tauri");
    assert_eq!(updated.playback_target, "tauri");

    // Reject invalid value
    let bad = svc.apply_config_patch(serde_json::json!({ "playback_target": "foo" }));
    assert!(bad.is_err(), "expected invalid playback_target to error");
}
