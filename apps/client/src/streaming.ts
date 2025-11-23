// Renderer bridge for desktop streaming commands. Provides a safe browser shim.

type AddResult = { info_hash: string; name?: string | null };
type TorrentStatus = {
  exists: boolean;
  state: string;
  progress: number;
  size: number;
  downloaded: number;
  upload: number;
  download_rate: number;
  upload_rate: number;
  info_hash: string;
  name?: string | null;
  save_path?: string | null;
  files_known: boolean;
};
type TorrentFile = {
  index: number;
  path: string;
  length: number;
  downloaded: number;
  priority: number;
  is_media: boolean;
};
type PlayDecision = { allow: boolean; path?: string | null; reason?: string | null; remember: boolean };

const hasTauri = typeof window !== 'undefined' && (window as any).__TAURI__?.invoke;

async function invoke<T>(cmd: string, payload?: Record<string, any>): Promise<T> {
  if (!hasTauri) throw new Error('desktop-only: Tauri bridge not available');
  const { invoke } = (window as any).__TAURI__;
  return invoke<T>(cmd, payload || {});
}

export const Streaming = {
  async addMagnet(magnet: string, savePath?: string, seeding?: boolean): Promise<AddResult> {
    return invoke<AddResult>('streaming_add_magnet', { magnet, savePath, seeding });
  },
  async status(infoHashOrMagnet: string): Promise<TorrentStatus> {
    return invoke<TorrentStatus>('streaming_status', { infoHashOrMagnet });
  },
  async listFiles(infoHash: string): Promise<TorrentFile[]> {
    return invoke<TorrentFile[]>('streaming_list_files', { infoHash });
  },
  async setSeeding(infoHash: string, on: boolean): Promise<void> {
    return invoke<void>('streaming_set_seeding', { infoHash, on });
  },
  async pickDownloadDir(): Promise<string> {
    return invoke<string>('streaming_pick_download_dir', {});
  },
  async requestPlay(infoHash: string, fileIndex?: number): Promise<PlayDecision> {
    return invoke<PlayDecision>('streaming_request_play', { infoHash, fileIndex });
  },
  async resumeWhenAvailable(infoHash: string, fileIndex?: number): Promise<void> {
    return invoke<void>('streaming_resume_when_available', { infoHash, fileIndex });
  },
  async cancelResume(infoHash: string, fileIndex?: number): Promise<void> {
    return invoke<void>('streaming_cancel_resume', { infoHash, fileIndex });
  },
  async playPath(path: string): Promise<void> {
    // This will succeed only if the desktop app is built with the 'videoplayer' feature and wired to a plugin.
    return invoke<void>('streaming_play_path', { path });
  },
  async openWithSystem(path: string): Promise<void> {
    return invoke<void>('streaming_open_with_system', { path });
  },
  async getConfig(): Promise<any> {
    return invoke<any>('streaming_get_config');
  },
  async setConfig(patch: Partial<any>): Promise<any> {
    return invoke<any>('streaming_set_config', { patch });
  },
  async refreshBackend(): Promise<{ active: string; error?: string }> {
    return invoke<{ active: string; error?: string }>('streaming_refresh_backend');
  }
};

// Attach to window for non-TS consumers
if (typeof window !== 'undefined') {
  (window as any).Streaming = Streaming;
}

export type { AddResult, TorrentStatus, TorrentFile, PlayDecision };
