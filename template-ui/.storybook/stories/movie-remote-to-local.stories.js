export default {
  title: 'Template/Remote→Local Test',
};

export const RemoteToLocal = () => {
  const wrap = document.createElement('div');
  wrap.style.maxWidth = '900px';
  wrap.style.margin = '24px auto';

  wrap.innerHTML = `
    <article class="themed mx-auto">
      <header class="site-header mb-4 flex-wrap">
        <div class="flex items-center gap-2 flex-1 min-w-[260px]"><h1 class="m-0 text-2xl font-semibold">Test</h1></div>
        <div class="flex items-center gap-3 header-controls">
          <movie-search class="w-[360px] search-el"></movie-search>
          <button id="open-create-modal" class="px-3 py-2 rounded-md">New Movie</button>
        </div>
      </header>
      <relay-modal id="create-modal" title="Add New Movie"><movie-upsert></movie-upsert></relay-modal>
      <div id="viewer-mount"></div>
    </article>`;

  // Append synchronously so Storybook gets a DOM node back immediately
  document.body.appendChild(wrap);

  // Run async interactions after mount without using top-level await
  (async () => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement('script');
      s.type = 'module';
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (err) => reject(err);
      document.head.appendChild(s);
    });
    try { await loadScript('/site/movies/movie-viewer.js'); } catch (e) { /* ignore */ }
    try { await loadScript('/site/movies/movie-upsert.js'); } catch (e) { }
    try { await loadScript('/site/modal/modal.js'); } catch (e) { }

    const viewer = document.createElement('movie-viewer');
    document.getElementById('viewer-mount').appendChild(viewer);

    const mockRes = await fetch('/.storybook/tmdb-alien-page1.json');
    const mock = mockRes.ok ? await mockRes.json() : { results: [] };
    const candidates = (mock.results || []).filter(r => r && r.id);
    if (!candidates.length) {
      const m = document.createElement('div'); m.textContent = 'No mock TMDB items found'; wrap.appendChild(m); return;
    }
    const localRes = await fetch('/.storybook/local-results.json');
    const local = localRes.ok ? await localRes.json() : { results: [] };
    const localKeys = new Set((local.results||[]).map(l => (l.title||'').toLowerCase() + '::' + (l.release_date||'').slice(0,4)));
    let pick = candidates.find(c => !localKeys.has(((c.title||'').toLowerCase() + '::' + ((c.release_date||'')||'').slice(0,4))));
    if (!pick) pick = candidates[0];

    // Provide the mock item as preloaded data to avoid needing network fetch inside the viewer
    const mapped = {
      id: String(pick.id),
      title: pick.title || pick.original_title || '',
      release_date: pick.release_date || '',
      release_year: pick.release_date ? Number(pick.release_date.slice(0,4)) : undefined,
      url_poster: pick.poster_path ? ('https://image.tmdb.org/t/p/w500' + pick.poster_path) : undefined,
      url_backdrop: pick.backdrop_path ? ('https://image.tmdb.org/t/p/w780' + pick.backdrop_path) : undefined,
      overview: pick.overview || '',
      genre: (pick.genre_ids || []).slice(0,3)
    };
    // Prepare listener for create-ready before opening the movie (avoid race)
    try {
      await new Promise((resolve, reject) => {
        const to = setTimeout(() => reject(new Error('viewer did not signal create-ready in time')), 3000);
        const onReady = (ev) => {
          if (ev.detail && ev.detail.id && String(ev.detail.id) === String(pick.id)) {
            clearTimeout(to);
            viewer.removeEventListener('movie-viewer:create-ready', onReady);
            resolve();
          }
        };
        viewer.addEventListener('movie-viewer:create-ready', onReady);
        // Now open the movie after listener is attached
        viewer.dispatchEvent(new CustomEvent('movie-search:open', { detail: { source: 'tmdb', id: String(pick.id), data: mapped }, bubbles: true, composed: true }));
      });
    } catch (e) {
      const m = document.createElement('div'); m.textContent = `Create-ready not emitted: ${e.message}`; wrap.appendChild(m); return;
    }

    const createBtn = viewer.querySelector('.btn-create');
    if (!createBtn) {
      const m = document.createElement('div'); m.textContent = 'Create button not found (movie may already be local)'; wrap.appendChild(m); return;
    }
    createBtn.click();

    const populated = await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('upsert not populated in time')), 3000);
      const onPop = (ev) => {
        clearTimeout(to);
        window.removeEventListener('movie-upsert:populated', onPop);
        resolve(ev.detail || {});
      };
      window.addEventListener('movie-upsert:populated', onPop);
    }).catch((e) => {
      const m = document.createElement('div'); m.textContent = `movie-upsert:populated not received: ${e.message}`; wrap.appendChild(m); return null;
    });

    if (!populated) return;

    const modal = document.getElementById('create-modal');
    const upsert = modal?.querySelector('movie-upsert');
    if (!upsert) {
      const m = document.createElement('div'); m.textContent = 'movie-upsert not mounted'; wrap.appendChild(m); return;
    }

    const title = upsert.querySelector('#title')?.value || '';
    const date = upsert.querySelector('#release_date')?.value || '';
    const genre = upsert.querySelector('#genre')?.value || '';

    const result = document.createElement('div');
    result.style.marginTop = '12px';
    result.innerHTML = `<strong>Picked:</strong> ${pick.title} (${pick.release_date||'?'} )<br/><strong>Form:</strong> ${title} | ${date} | ${genre}`;
    wrap.appendChild(result);
  })();

  return wrap;
};
