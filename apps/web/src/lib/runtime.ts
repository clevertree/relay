// Lightweight runtime detection helper used by the frontend.
// Prefer detecting the Tauri JS bridge; fall back to user-agent checks for
// embedded webviews only as a last resort. The UI should treat the runtime as
// "desktop" only when the native bridge is available.

export function isDesktopRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const anyWin = window as any;
  // Common Tauri bridge indicators
  if (anyWin.__TAURI__ || anyWin.tauri || anyWin.__TAURI_IPC__) return true;
  // In some embedded contexts the UA string contains "Tauri" — treat that as a weak fallback
  try {
    const ua = navigator?.userAgent || '';
    if (ua.includes('Tauri')) return true;
  } catch (e) {
    // ignore
  }
  return false;
}
