"use client";
import axios from 'axios';
import { useConfigStore } from '../store/config';
import { tauriInvoke, logInfo, logWarn } from './log';

export type RepoInfo = {
  name: string;
  title?: string;
  lastSize?: number;
  lastUpdate?: string;
  lastURL?: string;
  localPath?: string; // if omitted => remote repo
  missing?: boolean;  // computed on native side for local repos
};

export async function listRepos(): Promise<RepoInfo[]> {
  // Load from native config only; do not scan /repos folder.
  try {
    const arr = await tauriInvoke<RepoInfo[]>('get_repos');
    logInfo(`Loaded ${Array.isArray(arr) ? arr.length : 0} repositories from config`);
    return Array.isArray(arr) ? arr : [];
  } catch {
    // In web runtime, Tauri may be unavailable; return empty.
    logWarn('get_repos unavailable; returning empty repo list');
    return [];
  }
}

export async function fetchInterfaceMarkdown(repo: string): Promise<string> {
  const { masterEndpoint } = useConfigStore.getState();
  const base = masterEndpoint.replace(/\/$/, '');
  // Static file access only
  const url = `${base}/repos/${encodeURIComponent(repo)}/.relay/interface.md`;
  try {
    const res = await axios.get(url, { timeout: 2500, responseType: 'text' });
    if (typeof res.data === 'string') return res.data;
  } catch (e) {
    // no mocks; return empty string
  }
  return '';
}
