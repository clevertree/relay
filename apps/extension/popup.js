/* global chrome */
const browser = typeof chrome !== 'undefined' ? chrome : browser;

function qs(id) { return document.getElementById(id); }

async function bg(msg) {
  return new Promise((resolve) => browser.runtime.sendMessage(msg, resolve));
}

function setOptionsVisible(v) {
  qs('peersWrap').style.display = v ? 'block' : 'none';
}

async function refreshState() {
  const res = await bg({ type: 'getState' });
  if (!res?.ok) return;
  const { recentRepos } = res.state;
  // Also ask background about the active page branch
  try {
    const info = await bg({ type: 'getActivePageInfo' });
    const elStatus = qs('relayStatus');
    const wrap = qs('branchWrap');
    const sel = qs('branch');
    const defaults = ['main','dev','staging'];
    if (info?.ok && info.info && (info.info.branch || (info.tab && info.tab.url))) {
      const b = info.info.branch || '';
      elStatus.textContent = b ? `Relay-ready • branch: ${b}` : 'Relay-ready • branch not specified';
      elStatus.style.color = '#0a0';
      wrap.style.display = 'block';
      // populate dropdown via live OPTIONS request (no caching)
      sel.innerHTML = '';
      const loading = document.createElement('option');
      loading.value = '';
      loading.textContent = 'Loading branches…';
      sel.appendChild(loading);
      let choices = [];
      try {
        const opt = await bg({ type: 'fetchBranchesForActiveTab' });
        if (opt?.ok && Array.isArray(opt.branches) && opt.branches.length) {
          choices = opt.branches;
        }
      } catch {}
      if (!choices.length) choices = defaults.slice();
      if (b && !choices.includes(b)) choices = [b, ...choices];
      sel.innerHTML = '';
      for (const name of choices) {
        const optEl = document.createElement('option');
        optEl.value = name;
        optEl.textContent = name;
        if (name === b) optEl.selected = true;
        sel.appendChild(optEl);
      }
    } else {
      elStatus.textContent = 'This page is not part of the relay network';
      elStatus.style.color = '#888';
      wrap.style.display = 'none';
    }
  } catch {}
  const recent = qs('recent');
  recent.innerHTML = '';
  if (!recentRepos || recentRepos.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No recent repositories';
    opt.value = '';
    recent.appendChild(opt);
  } else {
    for (const url of recentRepos) {
      const opt = document.createElement('option');
      opt.textContent = url;
      opt.value = url;
      recent.appendChild(opt);
    }
  }
}

async function refreshPeers() {
  qs('peersInfo').textContent = 'Fetching peers…';
  setOptionsVisible(true);
  try {
    const res = await bg({ type: 'fetchPeers' });
    if (!res?.ok) throw new Error('fetchPeers failed');
    const peers = res.peers || [];
    const sel = qs('peers');
    sel.innerHTML = '';
    for (const p of peers) {
      const opt = document.createElement('option');
      opt.textContent = p.socket;
      opt.value = p.socket;
      sel.appendChild(opt);
    }
    qs('peersInfo').textContent = peers.length ? `${peers.length} peer(s)` : 'No peers';
  } catch (e) {
    qs('peersInfo').textContent = 'Failed to fetch peers';
  }
}

function normalizeUrl(u) {
  try { return new URL(u).toString(); } catch { return u?.trim(); }
}

async function main() {
  await refreshState();
  setOptionsVisible(false);

  qs('openRecent').addEventListener('click', async () => {
    const url = qs('recent').value;
    if (!url) return;
    await bg({ type: 'openRepo', url });
    window.close();
  });

  qs('refreshPeers').addEventListener('click', refreshPeers);

  qs('options').addEventListener('click', () => {
    if (browser.runtime.openOptionsPage) browser.runtime.openOptionsPage();
    else window.open('options.html');
  });

  qs('openInput').addEventListener('click', async () => {
    const raw = qs('socket').value;
    const url = normalizeUrl(raw);
    if (!url) return;
    await bg({ type: 'openRepo', url });
    window.close();
  });

  qs('addRecent').addEventListener('click', async () => {
    const raw = qs('socket').value;
    const url = normalizeUrl(raw);
    if (!url) return;
    await bg({ type: 'addRecent', url });
    await refreshState();
  });

  qs('openPeer').addEventListener('click', async () => {
    const url = qs('peers').value;
    if (!url) return;
    await bg({ type: 'openRepo', url });
    window.close();
  });

  qs('applyBranch').addEventListener('click', async () => {
    const sel = qs('branch');
    const branch = sel.value;
    if (!branch) return;
    await bg({ type: 'setActiveTabBranch', branch });
    // Popup can close; the tab will reload
    window.close();
  });
}

document.addEventListener('DOMContentLoaded', main);
