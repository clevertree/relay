import create from 'zustand';

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';
export type LogItem = { ts: number; level: LogLevel; message: string };

interface LogState {
  items: LogItem[];
  append: (level: LogLevel, message: string) => void;
  clear: () => void;
}

export const useLogStore = create<LogState>((set) => ({
  items: [],
  append: (level, message) => set((s) => ({ items: [...s.items, { ts: Date.now(), level, message }] })),
  clear: () => set({ items: [] }),
}));

export function log(level: LogLevel, message: string) {
  useLogStore.getState().append(level, message);
  // If tauri bridge exists, also forward to native for disk logging
  try {
    const anyWin: any = typeof window !== 'undefined' ? (window as any) : {};
    const invoke = anyWin.__TAURI__?.invoke ?? anyWin.tauri?.invoke ?? anyWin.__TAURI_IPC__?.invoke;
    if (invoke) {
      // fire and forget, don't await
      invoke('log_message', { level, message }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

export const logInfo = (m: string) => log('info', m);
export const logWarn = (m: string) => log('warn', m);
export const logError = (m: string) => log('error', m);
export const logDebug = (m: string) => log('debug', m);

export function bridgeAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  const anyWin: any = window as any;
  return Boolean(anyWin.__TAURI__ || anyWin.tauri || anyWin.__TAURI_IPC__);
}

export async function tauriInvoke<T = any>(cmd: string, args?: Record<string, any>): Promise<T> {
  const anyWin: any = typeof window !== 'undefined' ? (window as any) : {};
  const invoke = anyWin.__TAURI__?.invoke ?? anyWin.tauri?.invoke ?? anyWin.__TAURI_IPC__?.invoke;
  if (!invoke) {
    const msg = `Tauri bridge unavailable while invoking ${cmd}`;
    logWarn(msg + ' — falling back to web-only behaviour if available');
    throw new Error('Tauri invoke unavailable');
  }
  logDebug(`invoke ${cmd} ${args ? JSON.stringify(args) : ''}`.trim());
  try {
    const res = await invoke(cmd, args ?? {});
    logInfo(`invoke ${cmd} OK`);
    return res as T;
  } catch (e: any) {
    const detail = e?.message || String(e);
    logError(`invoke ${cmd} failed: ${detail}`);
    throw e;
  }
}
