"use client";
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type UiConfig = {
  masterEndpoint: string;
  httpPort: number;
  gitPort: number;
  shallowDefault: boolean;
  // Base path where the desktop host stores app data (repos). When empty, we
  // resolve a default at runtime: OS app dir when desktop, or './host/repos' in web.
  configPath: string;
};

const defaultConfig: UiConfig = {
  masterEndpoint: 'http://localhost:8080',
  httpPort: 8080,
  gitPort: 9418,
  shallowDefault: true,
  configPath: '', // empty means: resolve default per runtime
};

type Store = UiConfig & {
  set: (partial: Partial<UiConfig>) => void;
};

export const useConfigStore = create<Store>()(
  persist(
    (set, get) => ({
      ...defaultConfig,
      set: (partial) => set({ ...get(), ...partial }),
    }),
    { 
      name: 'relay-ui-config',
      skipHydration: true,
    }
  )
);
