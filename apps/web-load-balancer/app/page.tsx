"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type DomainStatus = {
  domain: string;
  resolvedIp?: string;
  https: { ok: boolean; ms?: number; error?: string };
  ports: Record<number, { ok: boolean; ms?: number; error?: string }>;
  lastChecked: string;
};

type ApiResponse = { results: DomainStatus[] };

export default function Home() {
  const [results, setResults] = useState<DomainStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [clientTimings, setClientTimings] = useState<Record<string, number>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [rowLoading, setRowLoading] = useState<Record<string, boolean>>({});

  const fetchCache = useCallback(async () => {
    const r = await fetch("/api/check", { cache: "no-store" });
    const j = (await r.json()) as ApiResponse;
    setResults(j.results);
  }, []);

  const runServerChecks = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/check", { method: "POST" });
      const j = (await r.json()) as ApiResponse;
      setResults(j.results);
    } finally {
      setLoading(false);
    }
  }, []);

  const checkSingle = useCallback(async (domain: string) => {
    setRowLoading((prev) => ({ ...prev, [domain]: true }));
    try {
      const r = await fetch("/api/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain }),
      });
      const j = (await r.json()) as ApiResponse;
      const updated = j.results[0];
      setResults((prev) => {
        const idx = prev.findIndex((x) => x.domain === updated.domain);
        if (idx === -1) return prev;
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    } finally {
      setRowLoading((prev) => ({ ...prev, [domain]: false }));
    }
  }, []);

  useEffect(() => {
    fetchCache();
  }, [fetchCache]);

  // Client-side timing: attempt to HEAD https://domain/ and also https://domain:9418/ and :22
  const doClientTiming = useCallback(async (domain: string) => {
    const tryFetch = async (url: string) => {
      const start = performance.now();
      try {
        const ctrl = new AbortController();
        const id = setTimeout(() => ctrl.abort(), 3000);
        await fetch(url, { method: "HEAD", mode: "no-cors", signal: ctrl.signal });
        clearTimeout(id);
        return performance.now() - start;
      } catch {
        return performance.now() - start; // still record elapsed time
      }
    };
    const base = await tryFetch(`https://${domain}/`);
    // Best-effort probes on ports (may error due to CORS/cert but we measure RTT-ish)
    const p9418 = await tryFetch(`https://${domain}:9418/`).catch(() => NaN);
    const p22 = await tryFetch(`https://${domain}:22/`).catch(() => NaN);
    // choose the best among successful timings prioritizing base https
    const best = [base, p9418, p22].filter((v) => Number.isFinite(v)).reduce((a, b) => Math.min(a, b), base);
    setClientTimings((prev) => ({ ...prev, [domain]: best }));
    return best;
  }, []);

  const chooseBest = useCallback(async () => {
    // Prefer domains that server marked as https ok and port 443 ok
    const ranked = [...results].sort((a, b) => {
      const aOk = (a.https.ok ? 1 : 0);
      const bOk = (b.https.ok ? 1 : 0);
      return bOk - aOk;
    });
    for (const r of ranked) {
      const t = await doClientTiming(r.domain);
      if (!Number.isNaN(t)) {
        setSelected(r.domain);
        return r.domain;
      }
    }
    return null;
  }, [results, doClientTiming]);

  const beginRedirect = useCallback(async () => {
    let target = selected;
    if (!target) target = await chooseBest();
    if (!target) return;
    setCountdown(5);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c === null) return null;
        if (c <= 1) {
          if (timerRef.current) clearInterval(timerRef.current);
          window.location.href = `https://${target}/`;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, [selected, chooseBest]);

  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const sorted = useMemo(() => {
    return [...results].sort((a, b) => {
      const at = clientTimings[a.domain] ?? a.https.ms ?? Number.MAX_SAFE_INTEGER;
      const bt = clientTimings[b.domain] ?? b.https.ms ?? Number.MAX_SAFE_INTEGER;
      return at - bt;
    });
  }, [results, clientTimings]);

  return (
    <div className="mx-auto max-w-4xl p-6 space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Relay Master Peers</h1>
        <div className="flex items-center gap-3">
          <button onClick={runServerChecks} disabled={loading}
                  className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {loading ? "Checking..." : "Check All"}
          </button>
          <button onClick={beginRedirect} className="rounded bg-emerald-600 px-4 py-2 text-white">
            Choose & Redirect
          </button>
        </div>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border border-zinc-200 dark:border-zinc-800">
          <thead className="bg-zinc-100 dark:bg-zinc-900">
            <tr>
              <th className="p-2 text-left">Domain</th>
              <th className="p-2 text-left">Resolved IP</th>
              <th className="p-2 text-left">HTTPS</th>
              <th className="p-2 text-left">Git(9418)</th>
              <th className="p-2 text-left">SSH(22)</th>
              <th className="p-2 text-left">Last Checked</th>
              <th className="p-2 text-left">Client RTT</th>
              <th className="p-2 text-left">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const client = clientTimings[r.domain];
              return (
                <tr key={r.domain} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className="p-2 font-medium">{r.domain}</td>
                  <td className="p-2 text-zinc-600">{r.resolvedIp ?? ""}</td>
                  <td className="p-2">
                    <span className={r.https.ok ? "text-emerald-600" : "text-rose-600"}>
                      {r.https.ok ? `ok${r.https.ms ? ` (${r.https.ms}ms)` : ""}` : (r.https.error || "fail")}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={r.ports[9418]?.ok ? "text-emerald-600" : "text-rose-600"}>
                      {r.ports[9418]?.ok ? `ok${r.ports[9418]?.ms ? ` (${r.ports[9418]?.ms}ms)` : ""}` : (r.ports[9418]?.error || "fail")}
                    </span>
                  </td>
                  <td className="p-2">
                    <span className={r.ports[22]?.ok ? "text-emerald-600" : "text-rose-600"}>
                      {r.ports[22]?.ok ? `ok${r.ports[22]?.ms ? ` (${r.ports[22]?.ms}ms)` : ""}` : (r.ports[22]?.error || "fail")}
                    </span>
                  </td>
                  <td className="p-2 text-zinc-500">{r.lastChecked ? new Date(r.lastChecked).toLocaleString() : ""}</td>
                  <td className="p-2">
                    {client ? `${Math.round(client)}ms` : (
                      <button className="underline" onClick={() => doClientTiming(r.domain)}>measure</button>
                    )}
                  </td>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <button className="rounded border px-2 py-1" onClick={() => setSelected(r.domain)}>
                      {selected === r.domain ? "Selected" : "Select"}
                      </button>
                      <button
                        className="rounded border px-2 py-1"
                        onClick={() => checkSingle(r.domain)}
                        disabled={!!rowLoading[r.domain]}
                      >
                        {rowLoading[r.domain] ? "Checking..." : "Check"}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="p-4 rounded border border-zinc-200 dark:border-zinc-800">
          Selected: <span className="font-semibold">{selected}</span>
          {countdown !== null && <span className="ml-2">Redirecting in {countdown}s...</span>}
        </div>
      )}
    </div>
  );
}
