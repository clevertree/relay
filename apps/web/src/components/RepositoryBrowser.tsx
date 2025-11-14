"use client";
import React, { useEffect, useState } from "react";
import { Box, CircularProgress, Typography, Paper, Alert, Stack, Chip } from "@mui/material";
import SafeMarkdown from "./SafeMarkdown";
import { loadRepoIndexMarkdown, loadRepoSchema, RepoSchema } from "../lib/repoSchema";

export default function RepositoryBrowser({ repoName }: { repoName: string }) {
  const [schema, setSchema] = useState<RepoSchema | null>(null);
  const [indexMd, setIndexMd] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
              <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
                <Chip label={`version: ${schema.version}`} size="small" />
                {schema.index && <Chip label={`index: ${schema.index}`} size="small" />}
              </Stack>
              {schema.indices && (
                <Typography variant="body2" color="text.secondary">
                  Indices: {Object.keys(schema.indices).join(", ") || "(none)"}
                </Typography>
              )}
            </Box>
          )}
          <Paper variant="outlined" sx={{ p: 2 }}>
            <SafeMarkdown markdown={indexMd} />
          </Paper>
          {/* TODO: Add search UI that uses schema.indices (e.g., byTitle/byDirector/byGenre) to query index folders. */}
        </Stack>
      )}
    </Box>
  );
}
