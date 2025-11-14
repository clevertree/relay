"use client";
import axios from "axios";
import YAML from "yaml";
import { useConfigStore } from "../store/config";

export type IndexDef = {
  path: string;
  searchPath?: string;
  description?: string;
};

export type ContentDef = {
  path: string;
  description?: string;
  properties?: Record<string, {
    type?: "string" | "integer" | "number" | "boolean";
    description?: string;
    required?: boolean;
    pattern?: string;
  }>;
};

export type RepoSchema = {
  version: number;
  title?: string;
  description?: string;
  index?: string; // defaults to README.md
  content?: ContentDef;
  indices?: Record<string, IndexDef>;
};

async function fetchRepoFile(repo: string, path: string): Promise<string> {
  const { masterEndpoint } = useConfigStore.getState();
  const base = masterEndpoint.replace(/\/$/, "");
  const url = `${base}/api/repos/${encodeURIComponent(repo)}/file?path=${encodeURIComponent(path)}`;
  const res = await axios.get(url, { timeout: 2500 }).catch(() => ({ data: null as any }));
  const data = res?.data;
  if (typeof data === "string") return data;
  if (data && typeof data.content === "string") return data.content;
  return "";
}

export async function loadRepoSchema(repo: string): Promise<RepoSchema | null> {
  const raw = await fetchRepoFile(repo, "relay.yaml");
  if (!raw) return null;
  let doc: any;
  try {
    doc = YAML.parse(raw);
  } catch (e) {
    return null;
  }
  // Minimal validation per schema/relay.schema.yaml
  if (!doc || typeof doc !== "object") return null;
  if (typeof doc.version !== "number") return null;
  // Coerce/validate shapes
  const out: RepoSchema = {
    version: doc.version,
    title: typeof doc.title === "string" ? doc.title : undefined,
    description: typeof doc.description === "string" ? doc.description : undefined,
    index: typeof doc.index === "string" ? doc.index : undefined,
    content: doc.content && typeof doc.content === "object" ? {
      path: String(doc.content.path || ""),
      description: typeof doc.content.description === "string" ? doc.content.description : undefined,
      properties: (doc.content.properties && typeof doc.content.properties === "object") ? doc.content.properties as ContentDef["properties"] : undefined,
    } : undefined,
    indices: (doc.indices && typeof doc.indices === "object") ? doc.indices as Record<string, IndexDef> : undefined,
  };
  if (out.content && !out.content.path) return null;
  return out;
}

export async function loadRepoIndexMarkdown(repo: string, schema: RepoSchema | null): Promise<string> {
  const indexPath = (schema?.index && typeof schema.index === "string" && schema.index.trim()) ? schema.index : "README.md";
  const md = await fetchRepoFile(repo, indexPath);
  if (md) return md;
  // fallback placeholder
  return `# ${repo}\n\nNo index file found at ${indexPath}.`;
}
