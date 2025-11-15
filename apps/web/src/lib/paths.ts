import { tauriInvoke } from './log';

export async function getDefaultConfigPath(): Promise<string> {
  // Prefer asking the native side for the OS-specific app data dir. If the
  // Tauri API is unavailable (web), fall back to the workspace host path.
  try {
    const p = await tauriInvoke<string>('get_app_host_path');
    if (p && typeof p === 'string') return p as string;
  } catch {}
  // Default for non-desktop/web runtime
  return 'host/repros'.replace('repros', 'repos');
}
