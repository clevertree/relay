"use client";
import axios from "axios";
import { useConfigStore } from "../store/config";

export type TreeEntry = {
  name: string;
  path: string; // relative path within repo
  type: "file" | "dir" | "symlink";
};

function baseUrl() {
  const { masterEndpoint } = useConfigStore.getState();
  return masterEndpoint.replace(/\/$/, "");
}

export async function fetchTree(repo: string, path: string): Promise<TreeEntry[]> {
  // Directory listing API at static path: /repos/<repo>/<path>
  const clean = path.replace(/^\/+/, "");
  const url = `${baseUrl()}/repos/${encodeURIComponent(repo)}/${clean}`;
  try {
    const res = await axios.get(url, { timeout: 2500, responseType: 'json' });
    const data = res.data;
    if (Array.isArray(data)) {
      return data as TreeEntry[];
    }
  } catch (e) {
    // return empty on error (no mocks)
  }
  return [];
}

export async function fetchFileText(repo: string, path: string): Promise<string> {
  const clean = path.replace(/^\/+/, "");
  const url = `${baseUrl()}/repos/${encodeURIComponent(repo)}/${clean}`;
  try {
    const res = await axios.get(url, { timeout: 2500, responseType: 'text' });
    return typeof res.data === "string" ? res.data : "";
  } catch (e) {
    // return empty
  }
  return "";
}

export async function fetchFileJson<T = any>(repo: string, path: string): Promise<T | null> {
  const txt = await fetchFileText(repo, path);
  if (!txt) return null;
  try { return JSON.parse(txt) as T; } catch { return null; }
}
