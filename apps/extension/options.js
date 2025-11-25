/* global chrome */
const browser = typeof chrome !== 'undefined' ? chrome : browser;

function qs(id) { return document.getElementById(id); }
function setText(id, text, cls) {
  const el = qs(id);
  el.textContent = text || '';
  el.className = (el.className.replace(/\b(ok|bad)\b/g, '').trim() + ' ' + (cls || '')).trim();
}

async function bg(msg) {
  return new Promise((resolve) => browser.runtime.sendMessage(msg, resolve));
}

async function loadState() {
  const res = await bg({ type: 'getState' });
  if (!res?.ok) return;
  const { trackerUrl, torrentBackends, preferences } = res.state;
  qs('trackerUrl').value = trackerUrl || 'https://relaynet.online';
  qs('qbtBase').value = torrentBackends?.qbt?.base || '';
  qs('transBase').value = torrentBackends?.trans?.base || '';
  qs('autoOpen').checked = preferences?.openAfterDownload !== false;
  // initial managed list
  try { await refreshManaged(); } catch {}
}

function toOrigin(u) {
  try { return new URL(u).origin + '/*'; } catch { return ''; }
}

async function onSaveTracker() {
  const value = qs('trackerUrl').value.trim();
  const res = await bg({ type: 'setTrackerUrl', value });
  setText('saveTrackerStatus', res?.ok ? 'Saved' : 'Failed');
  setTimeout(() => setText('saveTrackerStatus', ''), 1500);
}

async function onAllowDownloads() {
  const res = await bg({ type: 'ensureDownloadsPermission' });
  setText('saveBackendsStatus', res?.ok ? 'Downloads permission granted' : 'Permission denied', res?.ok ? 'ok' : 'bad');
  setTimeout(() => setText('saveBackendsStatus', ''), 2000);
}

async function onToggleAutoOpen() {
  const value = !!qs('autoOpen').checked;
  await bg({ type: 'setPreferences', value: { openAfterDownload: value } });
}

async function onSaveBackends() {
  const qbtBase = qs('qbtBase').value.trim();
  const transBase = qs('transBase').value.trim();
  const res = await bg({ type: 'setBackends', value: { qbt: { base: qbtBase }, trans: { base: transBase } } });
  setText('saveBackendsStatus', res?.ok ? 'Saved' : 'Failed');
  setTimeout(() => setText('saveBackendsStatus', ''), 1500);
}

async function onQbtPerm() {
  const base = qs('qbtBase').value.trim();
  const origin = toOrigin(base);
  if (!origin) { setText('qbtStatus', 'Invalid URL', 'bad'); return; }
  const res = await bg({ type: 'requestHost', origin });
  setText('qbtStatus', res?.ok ? 'Permission granted' : 'Permission denied', res?.ok ? 'ok' : 'bad');
}

async function onTransPerm() {
  const base = qs('transBase').value.trim();
  const origin = toOrigin(base);
  if (!origin) { setText('transStatus', 'Invalid URL', 'bad'); return; }
  const res = await bg({ type: 'requestHost', origin });
  setText('transStatus', res?.ok ? 'Permission granted' : 'Permission denied', res?.ok ? 'ok' : 'bad');
}

async function onQbtHealth() {
  const base = qs('qbtBase').value.trim();
  if (!base) { setText('qbtStatus', 'Set Base URL', 'bad'); return; }
  setText('qbtStatus', 'Checking…');
  try {
    const res = await bg({ type: 'qbtHealthy', base });
    setText('qbtStatus', res?.ok ? 'Healthy' : 'Unreachable', res?.ok ? 'ok' : 'bad');
  } catch {
    setText('qbtStatus', 'Error', 'bad');
  }
}

async function onTransHealth() {
  const base = qs('transBase').value.trim();
  if (!base) { setText('transStatus', 'Set RPC URL', 'bad'); return; }
  setText('transStatus', 'Checking…');
  try {
    const res = await bg({ type: 'transHealthy', base });
    setText('transStatus', res?.ok ? 'Healthy' : 'Unreachable', res?.ok ? 'ok' : 'bad');
  } catch {
    setText('transStatus', 'Error', 'bad');
  }
}

async function refreshManaged() {
  setText('managedInfo', 'Loading…');
  const res = await bg({ type: 'listManagedTorrents' });
  const rows = (res && res.rows) || [];
  const tbody = qs('managedTable').querySelector('tbody');
  tbody.innerHTML = '';
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td style="padding:4px; border-bottom:1px solid #eee">${r.backend}</td>
      <td style="padding:4px; border-bottom:1px solid #eee">${(r.hash||'').slice(0,10)}…</td>
      <td style="padding:4px; border-bottom:1px solid #eee">${r.name||''}</td>
      <td style="padding:4px; border-bottom:1px solid #eee">${Math.round((r.progress||0)*100)}%</td>
      <td style="padding:4px; border-bottom:1px solid #eee">${r.state||''}</td>`;
    tbody.appendChild(tr);
  }
  setText('managedInfo', `${rows.length} item(s)`);
}

function main() {
  loadState();
  qs('saveTracker').addEventListener('click', onSaveTracker);
  qs('allowDownloads').addEventListener('click', onAllowDownloads);
  qs('autoOpen').addEventListener('change', onToggleAutoOpen);
  qs('saveBackends').addEventListener('click', onSaveBackends);
  qs('qbtPerm').addEventListener('click', onQbtPerm);
  qs('transPerm').addEventListener('click', onTransPerm);
  qs('qbtHealth').addEventListener('click', onQbtHealth);
  qs('transHealth').addEventListener('click', onTransHealth);
  qs('refreshManaged').addEventListener('click', refreshManaged);
}

document.addEventListener('DOMContentLoaded', main);
