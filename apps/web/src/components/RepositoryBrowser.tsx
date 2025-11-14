"use client";
import React, { useEffect, useRef, useState } from "react";
import { Box, CircularProgress, Typography, Paper, Alert, Stack, Chip, List, ListItem, ListItemText, TextField, Breadcrumbs, Link as MLink } from "@mui/material";
import SafeMarkdown from "./SafeMarkdown";
import { loadRepoIndexMarkdown, loadRepoSchema, RepoSchema } from "../lib/repoSchema";
import { fetchTree, TreeEntry, fetchFileText } from "../lib/tree";

function normalizePath(p: string): string {
  // keep relative (no leading '/'), drop trailing '/'
  return (p || "").replace(/^\/+/, "").replace(/\/+$/, "");
}

function joinPath(base: string, seg: string): string {
  const b = normalizePath(base);
  const s = (seg || "").replace(/^\/+|\/+$/g, "");
  return [b, s].filter(Boolean).join("/");
}

export default function RepositoryBrowser({ repoName }: { repoName: string }) {
  const [schema, setSchema] = useState<RepoSchema | null>(null);
  const [indexMd, setIndexMd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Browsing state
  const [currentPath, setCurrentPath] = useState<string>(""); // '' denotes root '/'
  const [entries, setEntries] = useState<TreeEntry[]>([]);
  const [loadingEntries, setLoadingEntries] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);
  const [viewFilePath, setViewFilePath] = useState<string | null>(null);
  const [viewFileContent, setViewFileContent] = useState<string>("");
  const [viewLoading, setViewLoading] = useState(false);

  // Quick links for index roots (base of each indices.<name>.path before '{')
  const indexRoots = React.useMemo(() => {
    const out: { name: string; base: string }[] = [];
    const map = schema?.indices || {} as any;
    Object.keys(map).forEach((name) => {
      const p = map[name]?.path || "";
      const cut = p.indexOf("{");
      const base = (cut >= 0 ? p.slice(0, cut) : p).replace(/^\/+|\/+$/g, "");
      if (base) out.push({ name, base });
    });
    return out;
  }, [schema]);

  useEffect(() => {
    let mounted = true;
    async function run() {
      setLoading(true);
      setError(null);
      const s = await loadRepoSchema(repoName);
      if (!mounted) return;
      setSchema(s);
      const md = await loadRepoIndexMarkdown(repoName, s);
      if (!mounted) return;
      setIndexMd(md);
      if (!s) {
        setError("relay.yaml missing or invalid. Showing README.md if available.");
      }
      setLoading(false);
    }
    if (repoName) run();
    return () => { mounted = false; };
  }, [repoName]);

  // Load directory entries when not at root
  useEffect(() => {
    let cancelled = false;
    async function loadDir() {
      if (!currentPath) { setEntries([]); return; }
      setLoadingEntries(true);
      const list = await fetchTree(repoName, currentPath);
      if (!cancelled) {
        setEntries(Array.isArray(list) ? list : []);
        setLoadingEntries(false);
      }
    }
    loadDir();
    return () => { cancelled = true; };
  }, [repoName, currentPath]);

  // Navigation helpers
  const navigateTo = (path: string) => {
    const np = normalizePath(path);
    setCurrentPath(np);
    setFilter("");
    setViewFilePath(null);
    setViewFileContent("");
    setTimeout(() => filterRef.current?.focus(), 0);
  };

  function isDirType(t: string | undefined) {
    return t === "dir" || t === "directory" || t === "symlink";
  }

  function isMarkdown(path: string): boolean {
    const p = path.toLowerCase();
    return p.endsWith(".md") || p.endsWith(".markdown") || p.endsWith(".mdx");
  }

  const onEntryClick = async (entry: TreeEntry) => {
    const fullPath = joinPath(currentPath, entry.name);
    if (isDirType(entry.type)) {
      navigateTo(fullPath);
    } else if (entry.type === "file") {
      setViewLoading(true);
      setViewFilePath(fullPath);
      const txt = await fetchFileText(repoName, fullPath);
      setViewFileContent(txt || "");
      setViewLoading(false);
    }
  };

  const crumbs = React.useMemo(() => {
    const parts = normalizePath(currentPath).split("/").filter(Boolean);
    const acc: { label: string; path: string }[] = [{ label: "/", path: "" }];
    let cur = "";
    for (const p of parts) {
      cur = joinPath(cur, p);
      acc.push({ label: p, path: cur });
    }
    return acc;
  }, [currentPath]);

  const filtered = React.useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(e => (e.name || "").toLowerCase().includes(q));
  }, [entries, filter]);

  return (
    <Box>
      <Typography variant="h4" gutterBottom>
        {schema?.title || repoName}
      </Typography>
      {schema?.description && (
        <Typography variant="body1" color="text.secondary" gutterBottom>
          {schema.description}
        </Typography>
      )}
      {loading ? (
        <CircularProgress />
      ) : (
        <Stack spacing={2}>
          {error && <Alert severity="warning">{error}</Alert>}
          {schema && (
            <Box>
              <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Chip label={`version: ${schema.version}`} size="small" />
                {schema.index && <Chip label={`index: ${schema.index}`} size="small" />}
                {schema.content?.path && <Chip label={`content: ${schema.content.path}`} size="small" />}
                {schema.content?.metaFile && <Chip label={`meta: ${schema.content.metaFile}`} size="small" />}
              </Stack>
              {schema.content?.properties && (
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  Properties: {Object.entries(schema.content.properties).map(([k, v]) => `${k}${v?.required ? '*' : ''}${v?.type ? ':'+v.type : ''}`).join(', ')}
                </Typography>
              )}
              {indexRoots.length > 0 && (
                <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap' }}>
                  {indexRoots.map((r) => (
                    <Chip key={r.name} label={r.name} onClick={() => navigateTo(r.base)} clickable size="small" />
                  ))}
                </Stack>
              )}
            </Box>
          )}

          {/* Location + Filter */}
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
            <Box sx={{ flex: 1, minWidth: 320 }}>
              <Typography variant="caption">Location</Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {`/repo/${repoName}/${normalizePath(currentPath)}`.replace(/\/$/, '') || `/repo/${repoName}/`}
              </Typography>
              <Breadcrumbs aria-label="breadcrumb" sx={{ mt: 0.5 }}>
                {crumbs.map((c, i) => (
                  <MLink key={c.path + i} underline="hover" color="inherit" onClick={() => navigateTo(c.path)} sx={{ cursor: 'pointer' }}>
                    {c.label}
                  </MLink>
                ))}
              </Breadcrumbs>
            </Box>
            <TextField
              label="Filter"
              placeholder="Type to filter..."
              size="small"
              value={filter}
              inputRef={filterRef}
              onChange={(e) => setFilter(e.target.value)}
              sx={{ minWidth: 240 }}
            />
          </Stack>

          {/* Content */}
          {currentPath === "" ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <SafeMarkdown markdown={indexMd} />
            </Paper>
          ) : viewFilePath ? (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 1, fontFamily: 'monospace' }}>
                {`/repo/${repoName}/${viewFilePath}`}
              </Typography>
              {viewLoading ? (
                <CircularProgress size={20} />
              ) : (viewFilePath && viewFilePath.toLowerCase().endsWith('.md') || viewFilePath.toLowerCase().endsWith('.markdown') || viewFilePath.toLowerCase().endsWith('.mdx')) ? (
                <SafeMarkdown markdown={viewFileContent} />
              ) : (
                <Box component="pre" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'monospace', m: 0 }}>
                  {viewFileContent || '(empty file)'}
                </Box>
              )}
            </Paper>
          ) : (
            <Paper variant="outlined" sx={{ p: 1 }}>
              {loadingEntries ? (
                <Box sx={{ p: 2 }}><CircularProgress size={20} /> Loading...</Box>
              ) : filtered.length === 0 ? (
                <Box sx={{ p: 2 }}>
                  <Typography variant="body2" color="text.secondary">No entries</Typography>
                </Box>
              ) : (
                <List dense>
                  {filtered.map((e) => (
                    <ListItem key={e.path} onClick={() => onEntryClick(e)} sx={{ cursor: 'pointer' }}>
                      <ListItemText primary={e.name} secondary={e.type} />
                    </ListItem>
                  ))}
                </List>
              )}
            </Paper>
          )}
        </Stack>
      )}
    </Box>
  );
}
