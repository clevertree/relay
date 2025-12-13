use streaming_files::playback::is_playable_by_thresholds;

#[test]
fn zero_length_never_playable() {
    assert!(!is_playable_by_thresholds(
        0,
        0,
        16 * 1024 * 1024,
        64 * 1024 * 1024,
        1
    ));
}

#[test]
fn first_bytes_rule_allows() {
    let len = 100 * 1024 * 1024; // 100 MB
    let min_first = 16 * 1024 * 1024; // 16 MB
                                      // downloaded just below first-bytes threshold should still be playable due to percent rule (1% of 100MB = 1MB)
    assert!(is_playable_by_thresholds(
        min_first - 1,
        len,
        min_first,
        64 * 1024 * 1024,
        1
    ));
    // downloaded at first-bytes threshold
    assert!(is_playable_by_thresholds(
        min_first,
        len,
        min_first,
        64 * 1024 * 1024,
        1
    ));
}

#[test]
fn total_bytes_vs_percent_min_logic() {
    let len = 10 * 1024 * 1024 * 1024u64; // 10 GB
    let min_total = 64 * 1024 * 1024u64; // 64 MB
    let percent = 1u32; // 1%
                        // need_percent = 1% of 10GB = 100MB; min(min_total, need_percent) = 64MB
                        // 15MB: below first-bytes (16MB) and below min_total (64MB) -> not playable
    assert!(!is_playable_by_thresholds(
        15 * 1024 * 1024,
        len,
        16 * 1024 * 1024,
        min_total,
        percent
    ));
    // 63MB: above first-bytes (16MB) so playable even if below 64MB total
    assert!(is_playable_by_thresholds(
        63 * 1024 * 1024,
        len,
        16 * 1024 * 1024,
        min_total,
        percent
    ));
    // 64MB: at min_total -> playable
    assert!(is_playable_by_thresholds(
        64 * 1024 * 1024,
        len,
        16 * 1024 * 1024,
        min_total,
        percent
    ));
}

#[test]
fn tiny_file_uses_file_size_caps() {
    // File smaller than thresholds; we clamp thresholds to length
    let len = 5 * 1024 * 1024u64; // 5 MB
    let min_first = 16 * 1024 * 1024u64; // 16 MB -> clamped to 5 MB
    let min_total = 64 * 1024 * 1024u64; // 64 MB -> clamped by percent
    let percent = 1u32; // 1% of 5MB = 0.05MB ≈ 52428 bytes (rounding to nearest)
                        // Below both first-bytes (5MB) and min(min_total, percent_of_length) (~52KB)
    assert!(!is_playable_by_thresholds(
        50 * 1024,
        len,
        min_first,
        min_total,
        percent
    ));
    // At ~52KB should be allowed by percent rule
    assert!(is_playable_by_thresholds(
        53 * 1024,
        len,
        min_first,
        min_total,
        percent
    ));
}
