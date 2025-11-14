"use client";
import axios from 'axios';
import { useConfigStore } from '../store/config';

export type RepoInfo = { name: string; path?: string; description?: string };

export async function listRepos(): Promise<RepoInfo[]> {
  const { masterEndpoint } = useConfigStore.getState();
  const url = `${masterEndpoint.replace(/\/$/, '')}/api/repos`;
  try {
    const res = await axios.get(url, { timeout: 2500 });
    if (Array.isArray(res.data)) return res.data as RepoInfo[];
  } catch (e) {
    // fall back to mock data
  }
  return [ { name: 'movies', description: 'Sample movies repository' } ];
}

export async function fetchInterfaceMarkdown(repo: string): Promise<string> {
  const { masterEndpoint } = useConfigStore.getState();
  const url = `${masterEndpoint.replace(/\/$/, '')}/api/repos/${encodeURIComponent(repo)}/file?path=.relay/interface.md`;
  try {
    const res = await axios.get(url, { timeout: 2500 });
    if (typeof res.data === 'string') return res.data;
    if (res.data && typeof res.data.content === 'string') return res.data.content;
  } catch (e) {
    // mock content
  }
  return `# ${repo}\n\nWelcome to the ${repo} repository.\n\nThis is a placeholder interface. Configure your host HTTP server to serve .relay/interface.md.`;
}
