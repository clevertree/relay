import create from 'zustand';
import { invoke as tauriInvokeCore } from '@tauri-apps/api/core';

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
  // Also forward to native logger when running inside Tauri (ignore failures in web runtime)
  try {
    // fire and forget, don't await
    tauriInvokeCore('log_message', { level, message }).catch(() => {});
  } catch {
    // ignore when Tauri API is unavailable
  }
}

export const logInfo = (m: string) => log('info', m);
export const logWarn = (m: string) => log('warn', m);
export const logError = (m: string) => log('error', m);
export const logDebug = (m: string) => log('debug', m);

// Bridge validation state and helpers
export type BridgeState = {
  present: boolean;          // JS bridge objects detected
  validated: boolean;        // round-trip invoke succeeded
  validating: boolean;       // validation in progress
  error?: string;            // last validation error
};

export const useBridgeStore = create<BridgeState>(() => ({
  present: false,
  validated: false,
  validating: false,
  error: undefined,
}));

let validationStarted = false;

export function startBridgeValidation() {
  if (validationStarted) return;
  validationStarted = true;
  // start in validating state; presence will be inferred from probe result
  useBridgeStore.setState({ present: false, validating: true, validated: false, error: undefined });
  const timeoutMs = 2500;
  const withTimeout = <T,>(p: Promise<T>, ms: number) => new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); reject(e); });
  });
  (async () => {
    try {
      logInfo('Validating desktop bridge…');
      const res = await withTimeout(tauriInvoke<string>('debug_state'), timeoutMs);
      // Optional: echo the response to the log at debug level
      String(res || '').split('\n').forEach((line) => line && logDebug(line));
      useBridgeStore.setState({ present: true, validated: true, validating: false, error: undefined });
      logInfo('Desktop bridge validated.');
    } catch (e: any) {
      const msg = e?.message || String(e);
      useBridgeStore.setState({ present: false, validated: false, validating: false, error: msg });
      logWarn(`Desktop bridge validation failed: ${msg}`);
    }
  })();
}

export function bridgeAvailable(): boolean {
  // Prefer store-based signal to avoid touching Tauri globals.
  try {
    const s = useBridgeStore.getState();
    return Boolean(s.present || s.validated);
  } catch {
    return false;
  }
}

export async function tauriInvoke<T = any>(cmd: string, args?: Record<string, any>): Promise<T> {
  logDebug(`invoke ${cmd} ${args ? JSON.stringify(args) : ''}`.trim());
  try {
    const res = await tauriInvokeCore(cmd, args ?? {});
    logInfo(`invoke ${cmd} OK`);
    return res as T;
  } catch (e: any) {
    const detail = e?.message || String(e);
    // If running in web runtime, the Tauri API will throw; normalize the error
    if (detail && /not allowed|tauri|ipc|window is not defined|Cannot read|No such file or directory/i.test(detail)) {
      logWarn(`Tauri bridge unavailable while invoking ${cmd} — falling back to web-only behaviour if available`);
      throw new Error('Tauri invoke unavailable');
    }
    logError(`invoke ${cmd} failed: ${detail}`);
    throw e;
  }
}
