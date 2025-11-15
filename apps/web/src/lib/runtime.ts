// Lightweight runtime helper retained for compatibility with older code.
// Do not inspect Tauri globals; rely on the validated bridge state instead.
import { useBridgeStore } from './log';

export function isDesktopRuntime(): boolean {
  try {
    const s = useBridgeStore.getState();
    return Boolean(s.validated);
  } catch {
    return false;
  }
}
