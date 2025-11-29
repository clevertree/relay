// Lightweight YTS spider for the browser (no Node deps)
// Use case: When opening a movie with no stored torrent hashes, call this
// to discover possible torrents on YTS and surface them to the user.
//
// Environment: relies on public env returned by POST /env, particularly
// RELAY_PUBLIC_YTS_DOMAIN (e.g., yts.lt)

import { loadEnvOnce } from '../tmdb/query_tmdb.js';

function getDomainFromEnv(env) {
  const d = (env && env.RELAY_PUBLIC_YTS_DOMAIN) ? String(env.RELAY_PUBLIC_YTS_DOMAIN).trim() : '';
  // fallback to yts.lt as per instructions
  return d || 'yts.lt';
}

export function buildYtsBrowseUrl(domain, title) {
  const t = encodeURIComponent(String(title || '').trim());
  return `https://${domain}/browse-movies/${t}/all/all/0/latest/0/all`;
}

// Try to extract the first movie page URL from the browse/search HTML
export function extractMoviePageUrl(html, domain) {
  if (!html) return null;

  // 1) Try DOM parsing (most reliable in browser)
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    // Prefer the browse card anchor
    const a = doc.querySelector('a.browse-movie-link[href*="/movies/"]');
    if (a) {
      const href = a.getAttribute('href') || '';
      if (href.startsWith('http://') || href.startsWith('https://')) return href;
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return `https://${domain}${href}`;
    }
    // Fallback: any anchor pointing to /movies/
    const any = doc.querySelector('a[href*="/movies/"]');
    if (any) {
      const href = any.getAttribute('href') || '';
      if (href.startsWith('http://') || href.startsWith('https://')) return href;
      if (href.startsWith('//')) return 'https:' + href;
      if (href.startsWith('/')) return `https://${domain}${href}`;
    }
  } catch {
    // If DOMParser isn't available, fall back to regex below
  }

  // 2) Regex fallbacks
  const d = domain.replace(/\./g, '\\.');
  // Anchor with href first, capture entire URL until closing quote
  const reHref = new RegExp(
    `<a[^>]+href=["'](https?:\/\/[^"']*\/movies\/[^"']+|\/\/[^"']*\/movies\/[^"']+|\/movies\/[^"']+)["'][^>]*>`,
    'i'
  );
  const mHref = html.match(reHref);
  if (mHref && mHref[1]) {
    const href = mHref[1];
    if (href.startsWith('http://') || href.startsWith('https://')) return href;
    if (href.startsWith('//')) return 'https:' + href;
    if (href.startsWith('/')) return `https://${domain}${href}`;
  }

  // Specific absolute URL to this domain (last resort)
  const reAbs = new RegExp(`https?://${d}/movies/[^"'<>\s]+`, 'i');
  const mAbs = html.match(reAbs);
  if (mAbs && mAbs[0]) return mAbs[0];

  return null;
}

// Convert btih base32 (length ~32) to hex (length 40)
function base32ToHex(s) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const ch of s.toUpperCase()) {
    const v = alphabet.indexOf(ch);
    if (v < 0) return null;
    bits += v.toString(2).padStart(5, '0');
  }
  let out = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const nibble = parseInt(bits.slice(i, i + 4), 2);
    out += nibble.toString(16);
  }
  // trim/pad to 40 hex chars
  if (out.length >= 40) return out.slice(0, 40);
  return out.padEnd(40, '0');
}

function normalizeInfoHash(btih) {
  if (!btih) return null;
  const s = String(btih).trim();
  // hex 40
  if (/^[a-fA-F0-9]{40}$/.test(s)) return s.toLowerCase();
  // base32 typical
  if (/^[a-zA-Z2-7]{32}$/.test(s)) {
    const hex = base32ToHex(s);
    return hex ? hex.toLowerCase() : null;
  }
  // parse from xt if given something like urn:btih:...
  const m = s.match(/urn:btih:([^&]+)/i);
  if (m) return normalizeInfoHash(decodeURIComponent(m[1]));
  return null;
}

export function extractTorrents(html, domain) {
  const results = [];
  const seen = new Set();

  // 1) Direct YTS download links which contain hex hashes
  const reDl = new RegExp(`https?://${domain.replace(/\./g, '\\.')}/torrent/download/([a-fA-F0-9]{40})`, 'g');
  for (const m of html.matchAll(reDl)) {
    const hash = (m[1] || '').toLowerCase();
    if (!hash || seen.has(hash)) continue;
    seen.add(hash);
    // craft a description by looking around the match
    const idx = m.index || 0;
    const ctx = html.slice(Math.max(0, idx - 300), Math.min(html.length, idx + 300));
    const quality = (ctx.match(/\b(2160p|1080p|720p|480p)\b/i) || [])[0] || '';
    const size = (ctx.match(/\b(\d+(?:\.\d+)?\s?(?:GB|MB))\b/i) || [])[0] || '';
    const desc = [quality.toUpperCase(), size.toUpperCase()].filter(Boolean).join(' ').trim();
    results.push({ hash, description: desc || 'YTS download', href_download: m[0], href_magnet: null, source: 'yts' });
  }

  // 2) Magnet links — extract btih
  const reMag = /href\s*=\s*"(magnet:\?[^"\s]+)"/gi;
  for (const m of html.matchAll(reMag)) {
    const href = m[1];
    let hash = null;
    try {
      const url = new URL(href);
      const xt = url.searchParams.get('xt') || '';
      const mm = xt.match(/urn:btih:([^&]+)/i);
      if (mm) hash = normalizeInfoHash(decodeURIComponent(mm[1]));
      if (!hash) continue;
      if (seen.has(hash)) continue;
      seen.add(hash);
      const name = url.searchParams.get('dn') || '';
      const quality = (name.match(/\b(2160p|1080p|720p|480p)\b/i) || [])[0] || '';
      const desc = [name, quality.toUpperCase()].filter(Boolean).join(' ').trim();
      results.push({ hash, description: desc || 'Magnet', href_download: null, href_magnet: href, source: 'yts' });
    } catch {
      // ignore bad magnet
    }
  }

  return results;
}

export async function queryYtsForTorrents(title) {
  const t = String(title || '').trim();
  if (!t) return { domain: null, browseUrl: null, movieUrl: null, torrents: [] };
  const env = await loadEnvOnce();
  const domain = getDomainFromEnv(env);
  const browseUrl = buildYtsBrowseUrl(domain, t);
  console.debug('[yts] browse url:', browseUrl);
  try {
    const res = await fetch(browseUrl, { method: 'GET' });
    if (!res.ok) {
      console.debug('[yts] browse fetch failed:', res.status);
      return { domain, browseUrl, movieUrl: null, torrents: [] };
    }
    const html1 = await res.text();
    const movieUrl = extractMoviePageUrl(html1, domain);
    console.debug('[yts] movie url candidate:', movieUrl);
    if (!movieUrl) return { domain, browseUrl, movieUrl: null, torrents: [] };
    const res2 = await fetch(movieUrl, { method: 'GET' });
    if (!res2.ok) {
      console.debug('[yts] movie fetch failed:', res2.status);
      return { domain, browseUrl, movieUrl, torrents: [] };
    }
    const html2 = await res2.text();
    const torrents = extractTorrents(html2, domain);
    console.debug('[yts] torrents found:', torrents.length, torrents);
    return { domain, browseUrl, movieUrl, torrents };
  } catch (e) {
    console.debug('[yts] error', e);
    return { domain, browseUrl, movieUrl: null, torrents: [] };
  }
}

export default { queryYtsForTorrents, buildYtsBrowseUrl, extractMoviePageUrl, extractTorrents };
