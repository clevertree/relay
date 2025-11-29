// Browser-friendly TMDB query utilities (no Node deps)
// - Gets public env via POST /env (whitelisted RELAY_PUBLIC_*)
// - Exposes: fetchTmdbGenres, queryTmdb, queryLocalViaServer, queryAllHybrid

let __envCache = null;
let __genreMapCache = null;

export async function loadEnvOnce() {
  if (__envCache) return __envCache;
  try {
    const headers = {};
    const meta = document.querySelector('meta[name="relay-branch"]');
    const branch = meta?.getAttribute('content') || 'main';
    headers['X-Relay-Branch'] = branch;
    const res = await fetch('/env', { method: 'POST', headers });
    __envCache = res.ok ? await res.json() : {};
  } catch { __envCache = {}; }
  return __envCache;
}

export function tmdbAuth(env) {
  const v3 = env.RELAY_PUBLIC_TMDB_API_KEY;
  const bearer = env.RELAY_PUBLIC_TMDB_BEARER || env.RELAY_PUBLIC_TMDB_READ_ACCESS_ID;
  const headers = {};
  let urlSuffix = '';
  if (v3) {
    urlSuffix = (qs) => (qs.includes('?') ? '&' : '?') + 'api_key=' + encodeURIComponent(v3);
    return { headers, urlSuffix };
  }
  if (bearer) {
    headers['Authorization'] = /^Bearer\s+/i.test(bearer) ? bearer : `Bearer ${bearer}`;
    return { headers, urlSuffix: () => '' };
  }
  return { headers: {}, urlSuffix: () => '' };
}

export async function fetchTmdbGenres() {
  if (__genreMapCache) return __genreMapCache;
  const env = await loadEnvOnce();
  const { headers, urlSuffix } = tmdbAuth(env);
  if (!headers.Authorization && typeof urlSuffix !== 'function') return {};
  let url = 'https://api.themoviedb.org/3/genre/movie/list?language=en-US';
  url += typeof urlSuffix === 'function' ? urlSuffix(url) : '';
  try {
    const resp = await fetch(url, { headers });
    if (!resp.ok) return {};
    const data = await resp.json();
    const map = {};
    for (const g of (data.genres || [])) map[g.id] = g.name;
    __genreMapCache = map;
    return map;
  } catch { return {}; }
}

export function mapTmdbToRow(r) {
  const title = r.title || r.original_title || '';
  const release_year = r.release_date ? Number((r.release_date || '').slice(0, 4)) : undefined;
  const id = r.id ? String(r.id) : undefined;
  const url_poster = r.poster_path ? ('https://image.tmdb.org/t/p/w500' + r.poster_path) : undefined;
  const url_backdrop = r.backdrop_path ? ('https://image.tmdb.org/t/p/w780' + r.backdrop_path) : undefined;
  const overview = r.overview;
  return { id, title, release_year, url_poster, url_backdrop, overview, source: 'tmdb' };
}

// Transform a TMDB search result `r` into the local row schema, resolving genres
export function transformSearchResult(r, genreMap = {}) {
  const row = mapTmdbToRow(r);
  const ids = Array.isArray(r.genre_ids) ? r.genre_ids : [];
  const names = ids.map(id => genreMap[id]).filter(Boolean);
  return names.length ? { ...row, genre: names } : row;
}

export async function queryTmdb(q, limit = 10, page = 0, onPartial) {
  const query = String(q || '').trim();
  if (!query) return { rows: [], stats: { total: 0 } };
  const env = await loadEnvOnce();
  const { headers, urlSuffix } = tmdbAuth(env);
  if (!headers.Authorization && typeof urlSuffix !== 'function') return { rows: [], stats: { total: 0 } };
  const base = 'https://api.themoviedb.org/3/search/movie';
  const params = new URLSearchParams({ query, include_adult: 'false', language: 'en-US', page: String(Number(page || 0) + 1) });
  let url = base + '?' + params.toString();
  url += typeof urlSuffix === 'function' ? urlSuffix(url) : '';
  const resp = await fetch(url, { headers });
  if (!resp.ok) return { rows: [], stats: { total: 0 } };
  const data = await resp.json();
  const results = Array.isArray(data.results) ? data.results.slice(0, Number(limit || 10)) : [];
  let genreMap = {};
  try { genreMap = await fetchTmdbGenres(); } catch {}
  const rows = results.map(r => {
    const row = mapTmdbToRow(r);
    const ids = Array.isArray(r.genre_ids) ? r.genre_ids : [];
    const names = ids.map(id => genreMap[id]).filter(Boolean);
    return names.length ? { ...row, genre: names } : row;
  });
  const out = { rows, stats: { total: data.total_results || 0 } };
  if (typeof onPartial === 'function') { try { onPartial('tmdb', out); } catch {} }
  return out;
}

// Helper for querying local DB via Relay server
export async function queryLocalViaServer(filterBody, branch) {
  const res = await fetch('/', {
    method: 'QUERY',
    headers: { 'Content-Type': 'application/json', 'X-Relay-Branch': branch || 'main' },
    body: JSON.stringify(filterBody || {})
  });
  if (!res.ok) throw new Error('local query failed: ' + res.status);
  const json = await res.json();
  const items = Array.isArray(json.items) ? json.items : [];
  const rows = items.map(it => ({
    id: it._id || it.id || it.meta_dir || it._meta_dir,
    title: it.title,
    release_year: it.release_year,
    genre: it.genre,
    meta_dir: it.meta_dir || it._meta_dir,
    source: 'local'
  }));
  return { rows, stats: { total: json.total ?? rows.length } };
}

export async function queryAllHybrid({ text, page = 0, limit = 25, branch = 'main' }, onPartial) {
  const body = { params: {}, page };
  const t = String(text || '').trim();
  if (t) {
    const year = (t.match(/\b(19\d{2}|20\d{2})\b/) || [])[0];
    if (year) body.params.release_year = { eq: parseInt(year, 10) };
    if (t.startsWith('"') && t.endsWith('"') && t.length > 2) body.params.title = { eq: t.slice(1, -1) };
  }
  const acc = { rows: [], stats: { total: 0 } };
  const seen = new Set();
  const keyOf = (r) => r.meta_dir ? `local:${r.meta_dir}` : `${(r.title||'').toLowerCase()}::${r.release_year||''}`;
  let localDone = false;
  let pendingRemote = null;

  const emitCombined = () => {
    if (typeof onPartial === 'function') onPartial('combined', { rows: [...acc.rows], stats: { ...acc.stats } });
  };

  const pLocal = (async () => {
    try {
      const local = await queryLocalViaServer(body, branch);
      for (const r of local.rows) { const k = keyOf(r); if (seen.has(k)) continue; seen.add(k); acc.rows.push(r); }
      acc.stats.total += local.stats.total || 0;
      localDone = true;
      // After local arrives, merge any pending remote rows with de-dup (prefer local)
      if (pendingRemote && Array.isArray(pendingRemote.rows)) {
        for (const r of pendingRemote.rows) { const k = keyOf(r); if (seen.has(k)) continue; seen.add(k); acc.rows.push(r); }
        acc.stats.total += pendingRemote.stats?.total || 0;
        pendingRemote = null;
      }
      emitCombined();
    } catch (e) {
      localDone = true;
      emitCombined();
    }
  })();

  const pTmdb = (async () => {
    try {
      const remote = await queryTmdb(t, limit, page);
      if (!localDone) {
        // Defer merging until local finishes to ensure local preference
        pendingRemote = remote;
        // Still emit remote-only snapshot if desired? We emit combined (currently local-only), so skip.
      } else {
        for (const r of remote.rows) { const k = keyOf(r); if (seen.has(k)) continue; seen.add(k); acc.rows.push(r); }
        acc.stats.total += remote.stats.total || 0;
        emitCombined();
      }
    } catch (e) {
      // ignore
    }
  })();

  await Promise.allSettled([pLocal, pTmdb]);
  return acc;
}
            