// Relay WebExtension background service worker (MV3)
// Handles storage, MRU recents, tracker calls, optional downloads, and optional backend health checks.

/* global chrome */
const browser = typeof chrome !== 'undefined' ? chrome : browser;

// Keys in storage
const KEYS = {
  trackerUrl: 'trackerUrl',
  recentRepos: 'recentRepos',
  torrentBackends: 'torrentBackends',
  preferences: 'preferences',
};

// Defaults
const DEFAULTS = {
  trackerUrl: 'https://relaynet.online',
  // Seed a handy local dev server URL on first run
  recentRepos: ['http://localhost:8088'],
  torrentBackends: { qbt: { base: '' }, trans: { base: '' } },
  preferences: { openAfterDownload: true },
};

// In-memory per-tab page info (branch/repo detection, origin)
const pageInfo = new Map(); // tabId -> { origin, branch, repo }
const branchRules = new Map(); // tabId -> { ruleId, origin, branch }
const repoRules = new Map(); // tabId -> { ruleId, origin, repo }

// Track tab removal to cleanup
if (browser.tabs && browser.tabs.onRemoved) {
  browser.tabs.onRemoved.addListener((tabId) => {
    pageInfo.delete(tabId);
    // Cleanup any header injection rules/listeners tied to this tab
    try { removeBranchHeaderRule(tabId); } catch (_) {}
    try { removeRepoHeaderRule(tabId); } catch (_) {}
  });
}

async function get(key, fallback) {
  return new Promise((resolve) => {
    browser.storage.local.get([key], (obj) => {
      if (browser.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.warn('storage.get error', browser.runtime.lastError);
      }
      resolve(obj[key] ?? fallback);
    });
  });
}

async function set(obj) {
  return new Promise((resolve) => {
    browser.storage.local.set(obj, () => {
      if (browser.runtime.lastError) {
        // eslint-disable-next-line no-console
        console.warn('storage.set error', browser.runtime.lastError);
      }
      resolve();
    });
  });
}

// MRU recents
async function addRecent(url) {
  const recent = (await get(KEYS.recentRepos, DEFAULTS.recentRepos)) || [];
  const list = [url, ...recent.filter((u) => u !== url)].slice(0, 10);
  await set({ [KEYS.recentRepos]: list });
  return list;
}

async function listRecents() {
  return (await get(KEYS.recentRepos, DEFAULTS.recentRepos)) || [];
}

// Open repo
async function openRepo(url) {
  await new Promise((resolve) => browser.tabs.create({ url }, resolve));
  await addRecent(url);
  return true;
}

// Tracker
async function fetchPeers() {
  const trackerUrl = await get(KEYS.trackerUrl, DEFAULTS.trackerUrl);
  try {
    const res = await fetch(new URL('/api/peers', trackerUrl).toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('fetchPeers failed', e);
    throw e;
  }
}

// Permissions
async function ensureDownloadsPermission() {
  return new Promise((resolve) => {
    browser.permissions.request({ permissions: ['downloads', 'downloads.open'] }, (granted) => {
      resolve(Boolean(granted));
    });
  });
}

async function requestHostPermission(origin) {
  return new Promise((resolve) => {
    browser.permissions.request({ origins: [origin] }, (granted) => resolve(Boolean(granted)));
  });
}

function isChromium() {
  try { return typeof chrome !== 'undefined' && !!chrome.declarativeNetRequest; } catch { return false; }
}

function nextRuleIdForTab(tabId) {
  return 100000 + Number(tabId);
}

function escapeRegex(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function addBranchHeaderRule(tabId, origin, branch) {
  if (!origin || !branch) return;
  // Store in-memory
  pageInfo.set(tabId, { origin: origin, branch: branch });
  const isChr = isChromium();
  if (isChr && chrome.declarativeNetRequest) {
    const ruleId = nextRuleIdForTab(tabId);
    const url = new URL(origin);
    const scheme = url.protocol; // e.g., 'http:'
    const host = url.host; // includes port if any
    const regex = `^${escapeRegex(scheme)}//${escapeRegex(host)}/.*`;
    const rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'X-Relay-Branch', operation: 'set', value: String(branch) }],
      },
      condition: {
        tabIds: [tabId],
        regexFilter: regex,
        resourceTypes: [
          'main_frame','sub_frame','xmlhttprequest','script','stylesheet','image','font','media','ping','other'
        ],
      },
    };
    // Remove old rule if present then add new
    try {
      await new Promise((resolve) => chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId], addRules: [rule],
      }, resolve));
      branchRules.set(tabId, { ruleId, origin, branch });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('addBranchHeaderRule failed (Chromium)', e);
    }
  } else if (browser.webRequest && browser.webRequest.onBeforeSendHeaders) {
    // Firefox path: add a per-tab listener
    const filter = { urls: [origin.replace(/\/$/, '') + '/*'], tabId };
    const listener = (details) => {
      const hdrs = details.requestHeaders || [];
      const name = 'X-Relay-Branch';
      const found = hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase());
      if (found) found.value = String(branch); else hdrs.push({ name, value: String(branch) });
      return { requestHeaders: hdrs };
    };
    try {
      browser.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['blocking', 'requestHeaders']);
      branchRules.set(tabId, { listener, origin, branch });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('addBranchHeaderRule failed (FF)', e);
    }
  }
}

function removeBranchHeaderRule(tabId) {
  const rec = branchRules.get(tabId);
  if (!rec) return;
  if (rec.ruleId && isChromium() && chrome.declarativeNetRequest) {
    try { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rec.ruleId], addRules: [] }, () => {}); } catch {}
  }
  if (rec.listener && browser.webRequest && browser.webRequest.onBeforeSendHeaders) {
    try { browser.webRequest.onBeforeSendHeaders.removeListener(rec.listener); } catch {}
  }
  branchRules.delete(tabId);
}

async function addRepoHeaderRule(tabId, origin, repo) {
  if (!origin || !repo) return;
  // Store in-memory
  const existing = pageInfo.get(tabId) || { origin };
  pageInfo.set(tabId, { ...existing, origin: origin, repo: repo, branch: existing.branch });
  const isChr = isChromium();
  if (isChr && chrome.declarativeNetRequest) {
    const ruleId = 200000 + Number(tabId);
    const url = new URL(origin);
    const scheme = url.protocol; // e.g., 'http:'
    const host = url.host; // includes port if any
    const regex = `^${escapeRegex(scheme)}//${escapeRegex(host)}/.*`;
    const rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        requestHeaders: [{ header: 'X-Relay-Repo', operation: 'set', value: String(repo) }],
      },
      condition: {
        tabIds: [tabId],
        regexFilter: regex,
        resourceTypes: [
          'main_frame','sub_frame','xmlhttprequest','script','stylesheet','image','font','media','ping','other'
        ],
      },
    };
    try {
      await new Promise((resolve) => chrome.declarativeNetRequest.updateSessionRules({
        removeRuleIds: [ruleId], addRules: [rule],
      }, resolve));
      repoRules.set(tabId, { ruleId, origin, repo });
    } catch (e) {
      console.warn('addRepoHeaderRule failed (Chromium)', e);
    }
  } else if (browser.webRequest && browser.webRequest.onBeforeSendHeaders) {
    const filter = { urls: [origin.replace(/\/$/, '') + '/*'], tabId };
    const listener = (details) => {
      const hdrs = details.requestHeaders || [];
      const name = 'X-Relay-Repo';
      const found = hdrs.find((h) => h.name.toLowerCase() === name.toLowerCase());
      if (found) found.value = String(repo); else hdrs.push({ name, value: String(repo) });
      return { requestHeaders: hdrs };
    };
    try {
      browser.webRequest.onBeforeSendHeaders.addListener(listener, filter, ['blocking', 'requestHeaders']);
      repoRules.set(tabId, { listener, origin, repo });
    } catch (e) {
      console.warn('addRepoHeaderRule failed (FF)', e);
    }
  }
}

function removeRepoHeaderRule(tabId) {
  const rec = repoRules.get(tabId);
  if (!rec) return;
  if (rec.ruleId && isChromium() && chrome.declarativeNetRequest) {
    try { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [rec.ruleId], addRules: [] }, () => {}); } catch {}
  }
  if (rec.listener && browser.webRequest && browser.webRequest.onBeforeSendHeaders) {
    try { browser.webRequest.onBeforeSendHeaders.removeListener(rec.listener); } catch {}
  }
  repoRules.delete(tabId);
}

// Downloads
async function downloadAndMaybeOpen(url, filename, saveAs = true) {
  // Ensure permission first
  const has = await new Promise((resolve) => {
    browser.permissions.contains({ permissions: ['downloads'] }, (res) => resolve(Boolean(res)));
  });
  if (!has) {
    const ok = await ensureDownloadsPermission();
    if (!ok) throw new Error('downloads permission denied');
  }

  const id = await new Promise((resolve, reject) => {
    browser.downloads.download({ url, filename, saveAs }, (downloadId) => {
      if (browser.runtime.lastError || !downloadId) {
        reject(browser.runtime.lastError || new Error('download failed'));
      } else resolve(downloadId);
    });
  });

  const prefs = await get(KEYS.preferences, DEFAULTS.preferences);
  const shouldOpen = prefs?.openAfterDownload !== false;
  if (!shouldOpen) return { id, opened: false };

  const onChanged = (delta) => {
    if (delta.id === id && delta.state && delta.state.current === 'complete') {
      try { browser.downloads.open(id); } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('downloads.open failed', e);
      }
      browser.downloads.onChanged.removeListener(onChanged);
    }
  };
  browser.downloads.onChanged.addListener(onChanged);
  return { id, opened: true };
}

// qBittorrent health
async function qbtHealthy(base) {
  const url = new URL('/api/v2/app/version', base).toString();
  const res = await fetch(url, { credentials: 'include' });
  return res.ok;
}

// Transmission: minimal call to get session
async function transHealthy(base) {
  let r = await fetch(base, { method: 'POST', headers: { 'X-Transmission-Session-Id': '' }, body: '{}' });
  if (r.status === 409) return true; // session negotiation expected
  return r.ok;
}

// --- Streaming bridge helpers (minimal qBittorrent-first implementation) ---
async function getBackends() {
  return await get(KEYS.torrentBackends, DEFAULTS.torrentBackends);
}

async function streamingRefreshBackend() {
  const cfg = await getBackends();
  if (cfg?.qbt?.base) {
    const ok = await qbtHealthy(cfg.qbt.base).catch(() => false);
    if (ok) return { active: 'qbt' };
  }
  if (cfg?.trans?.base) {
    const ok = await transHealthy(cfg.trans.base).catch(() => false);
    if (ok) return { active: 'trans' };
  }
  return { active: null, error: 'no backend reachable' };
}

async function qbtAddMagnet(base, magnet) {
  const url = new URL('/api/v2/torrents/add', base).toString();
  const fd = new FormData();
  fd.set('urls', magnet);
  const res = await fetch(url, { method: 'POST', body: fd, credentials: 'include' });
  if (!res.ok) throw new Error('qbt add failed');
  return { ok: true };
}

async function qbtTorrentInfo(base, hash) {
  const url = new URL(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`, base).toString();
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('qbt info failed');
  const arr = await res.json();
  return Array.isArray(arr) && arr.length ? arr[0] : null;
}

async function qbtFiles(base, hash) {
  const url = new URL(`/api/v2/torrents/files?hash=${encodeURIComponent(hash)}`, base).toString();
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error('qbt files failed');
  const files = await res.json();
  return (files || []).map((f, i) => ({ index: i, path: f.name, length: f.size, downloaded: f.progress * f.size, is_media: /\.(mp4|mkv|avi|mov|webm)$/i.test(f.name) }));
}

async function streamingCall(method, args) {
  const cfg = await getBackends();
  switch (method) {
    case 'refreshBackend':
      return await streamingRefreshBackend();
    case 'addMagnet': {
      const magnet = args?.[0];
      if (cfg?.qbt?.base) return await qbtAddMagnet(cfg.qbt.base, magnet);
      return { error: 'no backend configured' };
    }
    case 'status': {
      const h = args?.[0];
      if (cfg?.qbt?.base) {
        const info = await qbtTorrentInfo(cfg.qbt.base, h);
        if (!info) return { state: 'unknown', downloaded: 0, size: 0 };
        return { state: info.state || info.state_enum || 'downloading', downloaded: Math.round(info.downloaded || info.completed || info.progress * info.size || 0), size: info.size || 0 };
      }
      return { error: 'no backend configured' };
    }
    case 'listFiles': {
      const h = args?.[0];
      if (cfg?.qbt?.base) return await qbtFiles(cfg.qbt.base, h);
      return { error: 'no backend configured' };
    }
    case 'requestPlay': {
      // naive: if any file is > 1% downloaded and is media, allow; return fake path (not accessible to extension unless downloaded via downloads API)
      const h = args?.[0]; const fileIndex = args?.[1];
      if (cfg?.qbt?.base) {
        const files = await qbtFiles(cfg.qbt.base, h);
        const pick = (fileIndex != null) ? files.find(f => f.index === fileIndex) : files.find(f => f.is_media);
        if (!pick) return { allow: false, reason: 'no media file' };
        const ratio = pick.length ? (pick.downloaded / pick.length) : 0;
        return { allow: ratio >= 0.01, reason: ratio >= 0.01 ? undefined : 'not enough downloaded', path: pick.path };
      }
      return { allow: false, reason: 'no backend configured' };
    }
    case 'openWithSystem': {
      const path = args?.[0] || '';
      const baseName = path.split(/[\\/]/).pop();
      if (!baseName) return { error: 'invalid path' };
      // Try to find a completed download with same filename and open it
      const download = await new Promise((resolve) => {
        try {
          browser.downloads.search({ query: [baseName], state: 'complete' }, (items) => resolve((items||[])[0]));
        } catch (e) { resolve(null); }
      });
      if (!download) return { error: 'not found in downloads' };
      try { browser.downloads.open(download.id); return { ok: true }; } catch (e) { return { error: String(e) }; }
    }
    case 'resumeWhenAvailable':
      return { error: 'not implemented' };
    case 'cancelResume':
      return { ok: true };
    default:
      return { error: 'unknown method' };
  }
}

// Managed torrents listing for Options page
async function listManagedTorrents() {
  const rows = [];
  const cfg = await getBackends();
  if (cfg?.qbt?.base) {
    try {
      const url = new URL('/api/v2/torrents/info', cfg.qbt.base).toString();
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const arr = await res.json();
        if (Array.isArray(arr)) {
          for (const t of arr) {
            rows.push({ backend: 'qbt', hash: t.hash, name: t.name, progress: t.progress, state: t.state });
          }
        }
      }
    } catch {}
  }
  if (cfg?.trans?.base) {
    try {
      const body = { method: 'torrent-get', arguments: { fields: ['id','hashString','name','percentDone','status'] } };
      // One round to get session id if needed
      let sid = '';
      let r = await fetch(cfg.trans.base, { method: 'POST', headers: { 'X-Transmission-Session-Id': sid }, body: JSON.stringify(body) });
      if (r.status === 409) {
        sid = r.headers.get('X-Transmission-Session-Id') || '';
        r = await fetch(cfg.trans.base, { method: 'POST', headers: { 'X-Transmission-Session-Id': sid }, body: JSON.stringify(body) });
      }
      if (r.ok) {
        const j = await r.json();
        const arr = j?.arguments?.torrents || [];
        for (const t of arr) {
          rows.push({ backend: 'trans', hash: t.hashString, name: t.name, progress: t.percentDone, state: String(t.status) });
        }
      }
    } catch {}
  }
  return rows;
}

// Message routing for popup/options
browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case 'fetchBranchesForActiveTab': {
        try {
          const [tab] = await new Promise((resolve) => browser.tabs.query({ active: true, currentWindow: true }, resolve));
          if (!tab || !tab.url) { sendResponse({ ok: false, error: 'no active tab' }); break; }
          const origin = new URL(tab.url).origin;
          // Best-effort: request host permission so OPTIONS is allowed on Firefox and locked-down Chromium
          try { await requestHostPermission(origin + '/*'); } catch (_) {}
          const res = await fetch(tab.url, { method: 'OPTIONS' });
          if (!res.ok) { sendResponse({ ok: false, error: `HTTP ${res.status}` }); break; }
          let json = null;
          try { json = await res.json(); } catch (_) { json = {}; }
          const branches = Array.isArray(json?.branches) ? json.branches : [];
          const capabilities = Array.isArray(json?.capabilities) ? json.capabilities : [];
          const repos = Array.isArray(json?.repos) ? json.repos : [];
          const currentBranch = typeof json?.currentBranch === 'string' ? json.currentBranch : null;
          const currentRepo = typeof json?.currentRepo === 'string' ? json.currentRepo : null;
          sendResponse({ ok: true, branches, repos, capabilities, currentBranch, currentRepo });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }
      case 'pageBranch': {
        const tabId = sender?.tab?.id;
        if (tabId != null) {
          const info = { origin: msg.origin || (sender?.origin || null), branch: msg.branch || null, repo: msg.repo || null };
          pageInfo.set(tabId, info);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'getActivePageInfo': {
        // Find active tab in current window
        const [tab] = await new Promise((resolve) => browser.tabs.query({ active: true, currentWindow: true }, resolve));
        if (!tab) { sendResponse({ ok: false }); break; }
        const info = pageInfo.get(tab.id) || {};
        sendResponse({ ok: true, tab: { id: tab.id, url: tab.url }, info });
        break;
      }
      case 'setActiveTabBranch': {
        const branch = (msg && msg.branch) || '';
        const [tab] = await new Promise((resolve) => browser.tabs.query({ active: true, currentWindow: true }, resolve));
        if (!tab || !tab.url) { sendResponse({ ok: false, error: 'no active tab' }); break; }
        try {
          const origin = new URL(tab.url).origin;
          // Request origin host permission just-in-time (optional; helps Firefox webRequest)
          try {
            await new Promise((resolve) => browser.permissions.contains({ origins: [origin + '/*'] }, (r) => resolve(r)));
          } catch {}
          try { await requestHostPermission(origin + '/*'); } catch {}
          await new Promise((resolve, reject) => {
            try {
              browser.cookies.set({ url: tab.url, name: 'relay-branch', value: branch, path: '/', sameSite: 'lax' }, (c) => {
                if (browser.runtime.lastError) reject(browser.runtime.lastError); else resolve(c);
              });
            } catch (e) { reject(e); }
          });
          // Remember in-memory until the content script reports the new page
          const prev = pageInfo.get(tab.id) || { origin };
          pageInfo.set(tab.id, { origin, branch, repo: prev.repo || null });
          // Install request header injection for this tab
          try { await addBranchHeaderRule(tab.id, origin, branch); } catch {}
          // Reload the tab to apply immediately
          await new Promise((resolve) => browser.tabs.reload(tab.id, {}, resolve));
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }
      case 'setActiveTabRepo': {
        const repo = (msg && msg.repo) || '';
        const [tab] = await new Promise((resolve) => browser.tabs.query({ active: true, currentWindow: true }, resolve));
        if (!tab || !tab.url) { sendResponse({ ok: false, error: 'no active tab' }); break; }
        try {
          const origin = new URL(tab.url).origin;
          try { await requestHostPermission(origin + '/*'); } catch {}
          await new Promise((resolve, reject) => {
            try {
              browser.cookies.set({ url: tab.url, name: 'relay-repo', value: repo, path: '/', sameSite: 'lax' }, (c) => {
                if (browser.runtime.lastError) reject(browser.runtime.lastError); else resolve(c);
              });
            } catch (e) { reject(e); }
          });
          const prev = pageInfo.get(tab.id) || { origin };
          pageInfo.set(tab.id, { origin, branch: prev.branch || null, repo });
          try { await addRepoHeaderRule(tab.id, origin, repo); } catch {}
          await new Promise((resolve) => browser.tabs.reload(tab.id, {}, resolve));
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ ok: false, error: String(e) });
        }
        break;
      }
      case 'getState': {
        const state = {
          trackerUrl: await get(KEYS.trackerUrl, DEFAULTS.trackerUrl),
          recentRepos: await listRecents(),
          torrentBackends: await get(KEYS.torrentBackends, DEFAULTS.torrentBackends),
          preferences: await get(KEYS.preferences, DEFAULTS.preferences),
        };
        sendResponse({ ok: true, state });
        break;
      }
      case 'setTrackerUrl': {
        await set({ [KEYS.trackerUrl]: msg.value });
        sendResponse({ ok: true });
        break;
      }
      case 'openRepo': {
        await openRepo(msg.url);
        sendResponse({ ok: true });
        break;
      }
      case 'fetchPeers': {
        const peers = await fetchPeers();
        sendResponse({ ok: true, peers });
        break;
      }
      case 'addRecent': {
        const list = await addRecent(msg.url);
        sendResponse({ ok: true, recentRepos: list });
        break;
      }
      case 'setPreferences': {
        const prefs = await get(KEYS.preferences, DEFAULTS.preferences);
        await set({ [KEYS.preferences]: { ...prefs, ...msg.value } });
        sendResponse({ ok: true });
        break;
      }
      case 'ensureDownloadsPermission': {
        const granted = await ensureDownloadsPermission();
        sendResponse({ ok: granted });
        break;
      }
      case 'download': {
        const result = await downloadAndMaybeOpen(msg.url, msg.filename, msg.saveAs);
        sendResponse({ ok: true, result });
        break;
      }
      case 'setBackends': {
        const cur = await get(KEYS.torrentBackends, DEFAULTS.torrentBackends);
        await set({ [KEYS.torrentBackends]: { ...cur, ...msg.value } });
        sendResponse({ ok: true });
        break;
      }
      case 'requestHost': {
        const granted = await requestHostPermission(msg.origin);
        sendResponse({ ok: granted });
        break;
      }
      case 'qbtHealthy': {
        const ok = await qbtHealthy(msg.base);
        sendResponse({ ok });
        break;
      }
      case 'transHealthy': {
        const ok = await transHealthy(msg.base);
        sendResponse({ ok });
        break;
      }
      case 'streamingCall': {
        const result = await streamingCall(msg.method, msg.args);
        sendResponse({ ok: true, result });
        break;
      }
      case 'listManagedTorrents': {
        const rows = await listManagedTorrents();
        sendResponse({ ok: true, rows });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })();
  // indicate async response
  return true;
});

// Try to capture response headers for branch detection (best-effort)
try {
  if (browser.webRequest && browser.webRequest.onHeadersReceived) {
    const listener = (details) => {
      if (details.type !== 'main_frame') return;
      const hdrs = details.responseHeaders || [];
      const hb = hdrs.find((x) => x.name && x.name.toLowerCase() === 'x-relay-branch');
      const hr = hdrs.find((x) => x.name && x.name.toLowerCase() === 'x-relay-repo');
      if ((hb || hr) && details.tabId != null) {
        const url = new URL(details.url);
        const prev = pageInfo.get(details.tabId) || { origin: url.origin };
        pageInfo.set(details.tabId, {
          origin: url.origin,
          branch: hb ? (hb.value || hb.binaryValue || null) : prev.branch || null,
          repo: hr ? (hr.value || hr.binaryValue || null) : prev.repo || null,
        });
      }
    };
    browser.webRequest.onHeadersReceived.addListener(listener, { urls: ['<all_urls>'] }, ['responseHeaders']);
  }
} catch (_) {}

// --- Streaming resume/cancel (basic polling implementation) ---
const resumeWaiters = new Map(); // hash -> { canceled: boolean }

async function streamingResumeWhenAvailable(infoHash, fileIndex) {
  const key = String(infoHash);
  const token = { canceled: false };
  resumeWaiters.set(key, token);
  const start = Date.now();
  const timeoutMs = 10 * 60 * 1000; // 10 minutes cap
  const intervalMs = 3000;
  while (!token.canceled && (Date.now() - start) < timeoutMs) {
    try {
      // Check either specific file or general readiness
      const files = await streamingCall('listFiles', [infoHash]);
      if (Array.isArray(files)) {
        let pick = null;
        if (fileIndex != null) pick = files.find((f) => f.index === fileIndex);
        else pick = files.find((f) => f.is_media);
        if (pick) {
          const ratio = pick.length ? (pick.downloaded / pick.length) : 0;
          if (ratio >= 0.01) { resumeWaiters.delete(key); return { ok: true }; }
        }
      }
    } catch (_) { /* ignore transient errors */ }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const wasCanceled = !!resumeWaiters.get(key)?.canceled;
  resumeWaiters.delete(key);
  if (wasCanceled) return { ok: false, canceled: true };
  return { ok: false, timeout: true };
}

function streamingCancelResume(infoHash) {
  const key = String(infoHash);
  const tok = resumeWaiters.get(key);
  if (tok) tok.canceled = true;
  return { ok: true };
}
