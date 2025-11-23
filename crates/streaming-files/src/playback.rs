//! Playback threshold helpers (pure functions, easy to unit test)

/// Decide if a media file is playable based on configured thresholds.
///
/// Rules:
/// - Allow when `downloaded >= min_first_bytes` (first-N-bytes available)
/// - OR when `downloaded >= min(min_total_bytes, percent_of_length)`
///
/// All inputs are in bytes; `percent_100` is from 0..=100.
pub fn is_playable_by_thresholds(
    downloaded: u64,
    length: u64,
    min_first_bytes: u64,
    min_total_bytes: u64,
    percent_100: u32,
) -> bool {
    if length == 0 { return false; }
    let dl = downloaded.min(length);
    let need_first = min_first_bytes.min(length);
    let pct = (percent_100 as f64 / 100.0).clamp(0.0, 1.0);
    let need_percent = ((length as f64) * pct).round() as u64;
    let need_total = std::cmp::min(min_total_bytes, need_percent);
    dl >= need_first || dl >= need_total
}
