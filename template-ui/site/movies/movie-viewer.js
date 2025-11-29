import {getTmdbById} from './tmdb/get_tmdb.js';
import {queryLocalViaServer} from './tmdb/query_tmdb.js';

class MovieViewer extends HTMLElement {
    constructor() {
        super();
        this._tabs = [];
    }

    connectedCallback() {
        this.innerHTML = `
      <div class="viewer flex flex-col gap-2 my-3">
        <div class="tabs flex gap-1 flex-wrap border-b border-black/10 dark:border-white/10 pb-1"></div>
        <div class="panes border border-black/10 dark:border-white/10 rounded-b-md bg-white dark:bg-neutral-900 p-3"></div>
      </div>
    `;
        this.$tabs = this.querySelector('.tabs');
        this.$panes = this.querySelector('.panes');
        // Listen globally for open events
        this._onOpen = (ev) => {
            const det = ev.detail || {};
            if (!det || (!det.id && !det.meta_dir)) return;
            this.openMovie(det);
        };
        document.addEventListener('movie-search:open', this._onOpen);
        this.addEventListener('movie-search:open', this._onOpen);
        // Listen for successful upserts to update any open TMDB tab state
        this._onUpsertSuccess = (ev) => {
            const detail = ev.detail || {};
            const path = (detail.path || '').toString().replace(/\\/g, '/');
            let dir = path;
            if (dir.endsWith('meta.json')) dir = dir.slice(0, -'meta.json'.length);
            dir = dir.replace(/\/+$/, '');
            const active = this._tabs.find(t => t.active && t.source === 'tmdb');
            if (active && !active.localMetaDir && dir) {
                active.localMetaDir = dir;
                this._renderTabs();
                this._renderPaneContent(active);
            }
        };
        document.addEventListener('movie-upsert:success', this._onUpsertSuccess);
    }

    disconnectedCallback() {
        document.removeEventListener('movie-search:open', this._onOpen);
        this.removeEventListener('movie-search:open', this._onOpen);
        document.removeEventListener('movie-upsert:success', this._onUpsertSuccess);
    }

    _branch() {
        const meta = document.querySelector('meta[name="relay-branch"]');
        return meta?.getAttribute('content') || 'main';
    }

    async openMovie({source = 'local', id, meta_dir, data: preloadedData = null}) {
        const key = source === 'local' && meta_dir ? `local:${meta_dir}` : `tmdb:${id}`;
        let tab = this._tabs.find(t => t.key === key);
        if (!tab) {
            tab = {key, title: 'Loading…', source, id, meta_dir, paneId: `pane-${Math.random().toString(36).slice(2)}`};
            this._tabs.push(tab);
            this._renderTabs();
            this._renderPanes();
        }
        this._activate(key);
        // Load data (allow preloaded data to short-circuit network calls)
        try {
            let data = null;
            if (preloadedData) {
                data = preloadedData;
            } else if (source === 'local' && meta_dir) {
                const headers = {};
                const meta = document.querySelector('meta[name="relay-branch"]');
                const branch = meta?.getAttribute('content') || 'main';
                headers['X-Relay-Branch'] = branch;
                const res = await fetch(`/${meta_dir.replace(/^\/+/, '')}/meta.json`, {headers});
                data = res.ok ? await res.json() : null;
                if (data) data.source = 'local';
            } else if (source === 'tmdb' && id) {
                data = await getTmdbById(id);
                // Also check for an existing local entry (prefer exact title + year)
                try {
                    if (data && data.title && data.release_year != null) {
                        const body = {
                            params: {title: {eq: data.title}, release_year: {eq: Number(data.release_year)}},
                            page: 0
                        };
                        const local = await queryLocalViaServer(body, this._branch());
                        const first = (local && Array.isArray(local.rows) && local.rows[0]) ? local.rows[0] : null;
                        if (first && (first.meta_dir || first._meta_dir)) {
                            tab.localMetaDir = first.meta_dir || first._meta_dir;
                        }
                    }
                } catch {
                }
            }
            if (!data) throw new Error('Not found');
            tab.data = data;
            tab.title = data.title || 'Untitled';
            this._renderTabs();
            this._renderPaneContent(tab);
        } catch (e) {
            // Show an error pane but keep the tab available; provide a refresh button
            tab.title = 'Error';
            this._renderTabs();
            const pane = this.querySelector(`#${CSS.escape(tab.paneId)}`);
            if (pane) {
                const msg = (e && e.message) ? e.message : String(e);
                pane.innerHTML = `
                <div class="text-red-600">Failed to load movie details: ${msg}</div>
                <div style="margin-top:8px">
                <button class="btn-refresh px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-white dark:bg-neutral-800">Refresh</button>
                </div>
              `;
                const btn = pane.querySelector('.btn-refresh');
                if (btn) btn.addEventListener('click', async () => {
                    pane.innerHTML = `<div class="text-neutral-600">Retrying…</div>`;
                    try {
                        await this.openMovie({source: tab.source, id: tab.id, meta_dir: tab.meta_dir});
                    } catch (err) {
                        pane.innerHTML = `<div class="text-red-600">Retry failed: ${err && err.message ? err.message : String(err)}</div>`;
                    }
                });
            }
        }
    }

    _activate(key) {
        this._tabs.forEach(t => t.active = (t.key === key));
        this._renderTabs();
        this._renderPanes();
    }

    _close(key) {
        const idx = this._tabs.findIndex(t => t.key === key);
        if (idx >= 0) this._tabs.splice(idx, 1);
        this._renderTabs();
        this._renderPanes();
    }

    _renderTabs() {
        this.$tabs.innerHTML = this._tabs.map(t => `
        <div class="tab ${t.active ? 'active' : ''} flex items-center gap-1 px-2 py-1 rounded-t-md border border-black/10 dark:border-white/10 border-b-0 cursor-pointer ${t.active ? 'bg-white dark:bg-neutral-900' : 'bg-neutral-100 dark:bg-neutral-800'}" data-key="${t.key}">
          <span>${t.title}</span>
          <button class="close text-neutral-600 hover:text-neutral-900" title="Close" aria-label="Close">×</button>
        </div>
      `).join('');
        this.$tabs.querySelectorAll('.tab').forEach(el => {
            const key = el.getAttribute('data-key');
            el.addEventListener('click', (ev) => {
                if (ev.target.classList.contains('close')) return; // handled below
                this._activate(key);
            });
            el.querySelector('.close')?.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this._close(key);
            });
        });
    }

    _renderPanes() {
        const existing = new Set(this._tabs.map(t => t.paneId));
        this.$panes.querySelectorAll('.pane').forEach(p => {
            if (!existing.has(p.id)) p.remove();
        });
        for (const t of this._tabs) {
            let pane = this.querySelector(`#${CSS.escape(t.paneId)}`);
            if (!pane) {
                pane = document.createElement('div');
                pane.id = t.paneId;
                pane.className = 'pane';
                this.$panes.appendChild(pane);
            }
            pane.classList.toggle('hidden', !t.active);
            if (t.data) this._renderPaneContent(t);
            else pane.innerHTML = `<div class=\"text-neutral-600\">Loading…</div>`;
        }
    }

    _renderPaneContent(tab) {
    const d = tab.data || {};
    const pane = this.querySelector(`#${CSS.escape(tab.paneId)}`);
    if (!pane) return;
        const title = d.title || 'Untitled';
        const year = d.release_year || d.releaseYear || '';
        const genres = Array.isArray(d.genre) ? d.genre.join(', ') : '';
        const overview = d.overview || '';
        const urlPoster = d.url_poster || d.poster || '';
        const urlBackdrop = d.url_backdrop || '';
        const localMetaDir = tab.localMetaDir || tab.meta_dir;
        pane.innerHTML = `
      <div class="grid [grid-template-columns:160px_1fr] gap-4 items-start">
        <div>
          ${urlPoster ? `<img class="max-w-[160px] rounded-lg border border-black/10 dark:border-white/10" src="${urlPoster}" alt="Poster">` : ''}
        </div>
        <div>
          <h3 class="m-0 mb-1 text-lg font-semibold">${title} ${year ? `(${year})` : ''}</h3>
          ${urlBackdrop ? `<img class="w-full max-h-[240px] object-cover rounded-lg border border-black/10 dark:border-white/10" src="${urlBackdrop}" alt="Backdrop">` : ''}
          ${genres ? `<div class="text-neutral-600">Genres: ${genres}</div>` : ''}
          ${overview ? `<p class="text-neutral-700 dark:text-neutral-300">${overview}</p>` : ''}
          <div class="text-neutral-600">Source: ${tab.source}</div>
          ${localMetaDir ? `<div class="text-neutral-600">Local: <a class="text-blue-600 hover:underline" href="/${localMetaDir}" target="_blank">/${localMetaDir}</a></div>` : ''}
          ${tab.source === 'tmdb' && !localMetaDir ? `<div class="mt-2"><button class="btn-create px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-blue-600 text-white">Create local entry</button></div>` : ''}

          <div class="mt-3 p-2 rounded border border-black/10 dark:border-white/10 bg-neutral-50 dark:bg-neutral-800" id="streaming-panel">
            <div class="font-semibold mb-1">Streaming</div>
            <div class="text-sm text-neutral-600" id="streaming-hint"></div>
            <div class="grid gap-2 mt-2" id="streaming-controls"></div>
            <div class="text-xs text-neutral-500 mt-2" id="streaming-status"></div>
          </div>
        </div>
      </div>
    `;
        // Wire Create button to open the modal prefilled
        if (tab.source === 'tmdb' && !localMetaDir) {
            const btn = pane.querySelector('.btn-create');
            if (btn) {
                // Notify listeners that a create button is available for this tab
                try {
                    this.dispatchEvent(new CustomEvent('movie-viewer:create-ready', {
                        detail: {
                            key: tab.key,
                            id: tab.id,
                            source: tab.source
                        }, bubbles: true, composed: true
                    }));
                } catch (e) {
                }
                btn.addEventListener('click', async () => {
                    const modal = document.getElementById('create-modal');
                    const metaToPopulate = {
                        title: d.title,
                        release_date: d.release_date,
                        release_year: d.release_year,
                        genre: Array.isArray(d.genre) ? d.genre : [],
                        overview: d.overview,
                        url_poster: d.url_poster,
                        url_backdrop: d.url_backdrop
                    };
                    // Try to find upsert immediately
                    let upsert = modal?.querySelector('movie-upsert');
                    // If not found, allow custom element upgrade / insertion to run and try again
                    if (!upsert) {
                        try {
                            // Wait for the movie-upsert element to be defined (if script loads later)
                            if (window.customElements && typeof window.customElements.whenDefined === 'function') {
                                await window.customElements.whenDefined('movie-upsert');
                            }
                        } catch (e) {
                        }
                        // microtask yield to allow connectedCallback to move children into modal
                        await new Promise(r => setTimeout(r, 0));
                        upsert = modal?.querySelector('movie-upsert') || document.querySelector('movie-upsert');
                    }
                    if (upsert && typeof upsert.populate === 'function') {
                        try {
                            upsert.populate(metaToPopulate);
                        } catch (e) {
                            console.error('populate failed', e);
                        }
                        // Notify that the upsert form has been populated
                        try {
                            modal?.dispatchEvent(new CustomEvent('movie-upsert:populated', {
                                detail: metaToPopulate,
                                bubbles: true,
                                composed: true
                            }));
                        } catch (e) {
                        }
                    } else {
                        console.warn('movie-upsert element not found to populate');
                    }
                    modal?.open?.();
                });
            }
        }

        // Wire up streaming panel
        try {
            const panel = pane.querySelector('#streaming-panel');
            const controls = pane.querySelector('#streaming-controls');
            const statusEl = pane.querySelector('#streaming-status');
            const hint = pane.querySelector('#streaming-hint');
            const hasBridge = !!(window && window.Streaming);
            if (!hasBridge) {
                hint.textContent = 'Desktop-only: streaming requires the Relay desktop app.';
            } else {
                hint.textContent = '';
                const meta = d || {};
                const ht = Array.isArray(meta.hash_torrent) ? meta.hash_torrent : [];

                const waiting = new Map(); // info_hash -> boolean (waiting)

                function remediationText(msg) {
                    const s = String(msg || '').toLowerCase();
                    if (s.includes('rpc') || s.includes('qbt') || s.includes('transmission')) {
                        return ' • Tip: Ensure qBittorrent WebUI (http://127.0.0.1:8080) or Transmission RPC (http://127.0.0.1:9091/transmission/rpc) is running. On localhost, enable WebUI and bypass auth for 127.0.0.1 during development.';
                    }
                    return '';
                }

                // Utility to render a per-hash file list container id
                const filesContainerId = (h) => `files-${h}`;

                async function checkBackend() {
                    try {
                        const res = await window.Streaming.refreshBackend();
                        if (res?.error) {
                            statusEl.textContent = `Backend: ${res.active || '-'} — ${res.error}${remediationText(res.error)}`;
                        } else {
                            statusEl.textContent = `Backend: ${res.active || 'unknown'} — OK`;
                        }
                    } catch (e) {
                        statusEl.textContent = 'Backend check failed.' + remediationText(e?.message || e);
                    }
                }

                function renderHashControls() {
                    controls.innerHTML = '';
                    if (ht.length) {
                        ht.forEach((entry, idx) => {
                            const hash = (entry && (entry.hash || entry)) || '';
                            const desc = (entry && entry.description) || '';
                            const row = document.createElement('div');
                            row.className = 'flex flex-wrap items-center gap-2 text-sm';
                            row.innerHTML = `
                              <span class="font-mono">${String(hash).slice(0, 10)}…</span>
                              <span class="text-neutral-600">${desc}</span>
                              <button class="btn-st-status px-2 py-1 rounded bg-green-600 text-white" data-h="${hash}">Status</button>
                              <button class="btn-st-files px-2 py-1 rounded bg-indigo-600 text-white" data-h="${hash}">Files…</button>
                              <button class="btn-st-play px-2 py-1 rounded bg-purple-600 text-white" data-h="${hash}">Request Play</button>
                              <button class="btn-st-open px-2 py-1 rounded bg-rose-600 text-white" data-h="${hash}">Open with System Player</button>
                              <button class="btn-st-resume px-2 py-1 rounded bg-amber-600 text-white hidden" data-h="${hash}">Resume when available</button>
                              <button class="btn-st-cancel px-2 py-1 rounded bg-amber-700 text-white hidden" data-h="${hash}">Cancel resume</button>
                              <button class="btn-st-backend px-2 py-1 rounded bg-gray-600 text-white" data-h="${hash}">Check backend</button>
                              <div class="w-full mt-2" id="${filesContainerId(hash)}"></div>
                            `;
                            controls.appendChild(row);
                        });
                    } else {
                        const findWrap = document.createElement('div');
                        findWrap.className = 'flex items-center gap-2';
                        findWrap.innerHTML = `<button class="px-3 py-2 rounded bg-blue-600 text-white" id="btn-find-yts">Find Torrents (YTS)</button>`;
                        controls.appendChild(findWrap);
                        const btn = findWrap.querySelector('#btn-find-yts');
                        btn?.addEventListener('click', async () => {
                            statusEl.textContent = 'Searching YTS…';
                            try {
                                const mod = await import('./yts/query_yts.js');
                                const out = await mod.queryYtsForTorrents(d.title || '');
                                statusEl.textContent = `YTS: ${out.torrents?.length || 0} found`;
                                if (out.torrents && out.torrents.length) {
                                    // Prefer magnet when available; add first magnet result
                                    const mag = out.torrents.find(t => t.href_magnet)?.href_magnet;
                                    if (mag) {
                                        try {
                                            await window.Streaming.addMagnet(mag);
                                            statusEl.textContent += ' — magnet added.';
                                        } catch (e) {
                                            statusEl.textContent += ' — add failed.';
                                        }
                                    }
                                }
                            } catch (e) {
                                statusEl.textContent = 'YTS search failed.';
                            }
                        });
                    }

                    // Wire buttons
                    controls.querySelectorAll('.btn-st-status').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            statusEl.textContent = 'Loading status…';
                            try {
                                const st = await window.Streaming.status(h);
                                statusEl.textContent = `State: ${st.state}, ${st.downloaded}/${st.size} bytes`;
                            } catch (e) {
                                statusEl.textContent = 'Status failed.' + remediationText(e?.message || e);
                            }
                        });
                    });
                    controls.querySelectorAll('.btn-st-files').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            statusEl.textContent = 'Loading files…';
                            try {
                                const fs = await window.Streaming.listFiles(h);
                                statusEl.textContent = `Files: ${fs.length}`;
                                const container = controls.querySelector(`#${filesContainerId(h)}`);
                                if (container) {
                                    container.innerHTML = '';
                                    if (!fs.length) {
                                        container.innerHTML = '<div class="text-xs text-neutral-500">No files.</div>';
                                    } else {
                                        // build radio list and a per-file play button
                                        const list = document.createElement('div');
                                        list.className = 'grid gap-1';
                                        fs.forEach(f => {
                                            const id = `sel-${h}-${f.index}`;
                                            const row = document.createElement('label');
                                            row.className = 'flex items-start gap-2 text-xs';
                                            row.innerHTML = `
                                              <input type="radio" name="sel-file-${h}" id="${id}" value="${f.index}">
                                              <div>
                                                <div class="font-mono break-all">${f.path}</div>
                                                <div class="text-neutral-500">${f.downloaded} / ${f.length} bytes ${f.is_media ? '• media' : ''}</div>
                                              </div>
                                            `;
                                            list.appendChild(row);
                                        });
                                        const actions = document.createElement('div');
                                        actions.className = 'mt-2 flex gap-2';
                                        actions.innerHTML = `
                                          <button class="btn-st-play-file px-2 py-1 rounded bg-purple-700 text-white" data-h="${h}">Request Play (selected file)</button>
                                          <button class="btn-st-open-file px-2 py-1 rounded bg-rose-700 text-white" data-h="${h}">Open with System Player (selected)</button>
                                          <button class="btn-st-resume-file px-2 py-1 rounded bg-amber-700 text-white" data-h="${h}">Resume when available (selected)</button>
                                        `;
                                        container.appendChild(list);
                                        container.appendChild(actions);

                                        actions.querySelector('.btn-st-play-file')?.addEventListener('click', async (ev2) => {
                                            const h2 = ev2.currentTarget.getAttribute('data-h');
                                            const sel = container.querySelector(`input[name="sel-file-${h2}"]:checked`);
                                            const idx = sel ? Number(sel.value) : undefined;
                                            if (idx == null) { statusEl.textContent = 'Select a file first.'; return; }
                                            statusEl.textContent = 'Requesting play…';
                                            try {
                                                const dec = await window.Streaming.requestPlay(h2, idx);
                                                if (dec.allow) statusEl.textContent = 'Play allowed — opening on desktop (if enabled).';
                                                else statusEl.textContent = 'Not yet playable: ' + (dec.reason || '');
                                            } catch (e) {
                                                statusEl.textContent = 'Request failed.' + remediationText(e?.message || e);
                                            }
                                        });

                                        actions.querySelector('.btn-st-open-file')?.addEventListener('click', async (ev2) => {
                                            const h2 = ev2.currentTarget.getAttribute('data-h');
                                            const sel = container.querySelector(`input[name="sel-file-${h2}"]:checked`);
                                            const idx = sel ? Number(sel.value) : undefined;
                                            if (idx == null) { statusEl.textContent = 'Select a file first.'; return; }
                                            statusEl.textContent = 'Requesting play…';
                                            try {
                                                const dec = await window.Streaming.requestPlay(h2, idx);
                                                if (dec.allow && dec.path) {
                                                    await window.Streaming.openWithSystem(dec.path);
                                                    statusEl.textContent = 'Opened with system player.';
                                                } else {
                                                    statusEl.textContent = 'Not yet playable: ' + (dec.reason || '');
                                                }
                                            } catch (e) {
                                                statusEl.textContent = 'Open-with-system failed.' + remediationText(e?.message || e);
                                            }
                                        });

                                        actions.querySelector('.btn-st-resume-file')?.addEventListener('click', async (ev2) => {
                                            const h2 = ev2.currentTarget.getAttribute('data-h');
                                            const sel = container.querySelector(`input[name="sel-file-${h2}"]:checked`);
                                            const idx = sel ? Number(sel.value) : undefined;
                                            if (idx == null) { statusEl.textContent = 'Select a file first.'; return; }
                                            try {
                                                statusEl.textContent = 'Waiting until playable…';
                                                await window.Streaming.resumeWhenAvailable(h2, idx);
                                                const dec = await window.Streaming.requestPlay(h2, idx);
                                                if (dec.allow) statusEl.textContent = 'Now playable — opening player (desktop).';
                                                else statusEl.textContent = 'Still not playable: ' + (dec.reason || '');
                                            } catch (e) {
                                                statusEl.textContent = 'Resume failed or canceled.';
                                            }
                                        });
                                    }
                                }
                            } catch (e) {
                                statusEl.textContent = 'Files failed.' + remediationText(e?.message || e);
                            }
                        });
                    });
                    controls.querySelectorAll('.btn-st-play').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            statusEl.textContent = 'Requesting play…';
                            try {
                                const dec = await window.Streaming.requestPlay(h);
                                const row = ev.currentTarget.closest('div');
                                const btnResume = row?.querySelector('.btn-st-resume');
                                const btnCancel = row?.querySelector('.btn-st-cancel');
                                if (dec.allow) {
                                    statusEl.textContent = 'Play allowed (player may open on desktop).';
                                    if (btnResume) btnResume.classList.add('hidden');
                                    if (btnCancel) btnCancel.classList.add('hidden');
                                    waiting.delete(h);
                                } else {
                                    statusEl.textContent = 'Not yet playable: ' + (dec.reason || '');
                                    if (btnResume && !waiting.get(h)) btnResume.classList.remove('hidden');
                                    if (btnCancel && waiting.get(h)) btnCancel.classList.remove('hidden');
                                }
                            } catch (e) {
                                statusEl.textContent = 'Request failed.' + remediationText(e?.message || e);
                            }
                        });
                    });

                    // Open with system (per-hash)
                    controls.querySelectorAll('.btn-st-open').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            statusEl.textContent = 'Requesting play…';
                            try {
                                const dec = await window.Streaming.requestPlay(h);
                                if (dec.allow && dec.path) {
                                    await window.Streaming.openWithSystem(dec.path);
                                    statusEl.textContent = 'Opened with system player.';
                                    waiting.delete(h);
                                } else {
                                    statusEl.textContent = 'Not yet playable: ' + (dec.reason || '');
                                }
                            } catch (e) {
                                statusEl.textContent = 'Open-with-system failed.' + remediationText(e?.message || e);
                            }
                        });
                    });

                    // Resume when available handlers
                    controls.querySelectorAll('.btn-st-resume').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            const row = ev.currentTarget.closest('div');
                            const btnResume = row?.querySelector('.btn-st-resume');
                            const btnCancel = row?.querySelector('.btn-st-cancel');
                            try {
                                waiting.set(h, true);
                                if (btnResume) btnResume.classList.add('hidden');
                                if (btnCancel) btnCancel.classList.remove('hidden');
                                statusEl.textContent = 'Waiting until playable…';
                                await window.Streaming.resumeWhenAvailable(h);
                                // When resolved, request play again (confirmation/autoplay handled in desktop)
                                const dec = await window.Streaming.requestPlay(h);
                                if (dec.allow) statusEl.textContent = 'Now playable — opening player (desktop).';
                                else statusEl.textContent = 'Still not playable: ' + (dec.reason || '');
                            } catch (e) {
                                statusEl.textContent = 'Resume failed or canceled.';
                            } finally {
                                waiting.delete(h);
                                if (btnCancel) btnCancel.classList.add('hidden');
                                if (btnResume) btnResume.classList.remove('hidden');
                            }
                        });
                    });

                    controls.querySelectorAll('.btn-st-cancel').forEach(btn => {
                        btn.addEventListener('click', async (ev) => {
                            const h = ev.currentTarget.getAttribute('data-h');
                            const row = ev.currentTarget.closest('div');
                            const btnResume = row?.querySelector('.btn-st-resume');
                            const btnCancel = row?.querySelector('.btn-st-cancel');
                            try {
                                await window.Streaming.cancelResume(h);
                                statusEl.textContent = 'Resume canceled.';
                            } catch (e) {
                                statusEl.textContent = 'Cancel failed.';
                            } finally {
                                waiting.delete(h);
                                if (btnCancel) btnCancel.classList.add('hidden');
                                if (btnResume) btnResume.classList.remove('hidden');
                            }
                        });
                    });

                    // Backend check buttons
                    controls.querySelectorAll('.btn-st-backend').forEach(btn => {
                        btn.addEventListener('click', () => checkBackend());
                    });
                }

                renderHashControls();
            }
        } catch (e) {
        }

        // Dispatch an event after pane content is rendered so tests/stories can react
        try {
            this.dispatchEvent(new CustomEvent('movie-viewer:rendered', {
                detail: {
                    key: tab.key,
                    id: tab.id,
                    source: tab.source
                }, bubbles: true, composed: true
            }));
        } catch (e) {
        }
    }
}

customElements.define('movie-viewer', MovieViewer);


// Mount a movie viewer just below the main header if present
window.addEventListener('DOMContentLoaded', () => {
    const article = document.querySelector('article.themed') || document.querySelector('article');
    if (!article) return;
    // Avoid duplicates
    if (article.querySelector('movie-viewer')) return;
    const header = article.querySelector('header');
    const viewer = document.createElement('movie-viewer');
    if (header && header.nextSibling) {
        article.insertBefore(viewer, header.nextSibling);
    } else {
        article.appendChild(viewer);
    }
});
