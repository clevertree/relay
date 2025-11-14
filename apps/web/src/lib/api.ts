"use client";
import axios from 'axios';
import { useConfigStore } from '../store/config';

export type RepoInfo = { name: string; path?: string; description?: string };

export async function listRepos(): Promise<RepoInfo[]> {
  const { masterEndpoint } = useConfigStore.getState();
  const base = masterEndpoint.replace(/\/$/, '');
  // Directory listing JSON at /repos/ expected: [ { name, path, type } ]
  const url = `${base}/repos/`;
  try {
    const res = await axios.get(url, { timeout: 2500, responseType: 'json' });
    const arr = res.data as any;
    if (Array.isArray(arr)) {
      return arr
        .filter((e) => e && (e.type === 'dir' || e.type === 'directory'))
        .map((e) => ({ name: e.name || e.path || '', path: e.path }))
        .filter((r) => r.name);
    }
  } catch (e) {
    // return empty if unavailable
  }
  return [];
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
