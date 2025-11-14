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
  metaFile?: string; // defaults to meta.json
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

export function defaultIndexPath(schema: RepoSchema | null | undefined): string {
  const idx = schema?.index && typeof schema.index === "string" && schema.index.trim() ? schema.index : "README.md";
  return idx;
}

export function defaultMetaFile(schema: RepoSchema | null | undefined): string {
  const mf = schema?.content?.metaFile && schema.content.metaFile.trim() ? schema.content.metaFile : "meta.json";
  return mf;
}

export function slugify(input: string): string {
  const s = (input ?? "").toString().trim().toLowerCase();
  // replace sequences of non-alphanumeric with single '-'
  return s
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function computeIndexSearchPath(idx: IndexDef, query: string): string {
  if (idx.searchPath && idx.searchPath.includes("{search}")) {
    return idx.searchPath.replace("{search}", slugify(query));
  }
  // Fallback: use the base of idx.path (before first placeholder)
  const p = idx.path || "";
  const cut = p.indexOf("{");
  const base = (cut >= 0 ? p.slice(0, cut) : p).replace(/\/+$/, "");
  return base;
}

async function fetchRepoFile(repo: string, path: string): Promise<string> {
  const { masterEndpoint } = useConfigStore.getState();
  const base = masterEndpoint.replace(/\/$/, "");
  // Static file hosting: files are served directly from /repos/<name>/<path>
  const clean = path.replace(/^\/+/, "");
  const url = `${base}/repos/${encodeURIComponent(repo)}/${clean}`;
  try {
    const res = await axios.get(url, { timeout: 2500, responseType: 'text' });
    return typeof res.data === "string" ? res.data : "";
  } catch (e) {
    return "";
  }
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
