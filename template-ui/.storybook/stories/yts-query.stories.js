// Storybook story to exercise the YTS spider in the browser
// Provides a simple UI to input a movie title, then logs and renders
// discovered torrent hashes with descriptions.

export default {title: 'Template/Movies/YTS Spider'};

export const QueryYts = () => {
    const root = document.createElement('div');
    root.className = 'themed max-w-[900px] p-4';
    root.innerHTML = `
    <article>
      <header class="site-header mb-4">
        <h1 class="text-2xl font-semibold">YTS Spider</h1>
        <p class="text-[color:var(--muted)] text-sm">Enter a movie title and fetch potential torrent hashes from YTS.</p>
      </header>
      <section class="grid gap-3">
        <div class="flex gap-2 items-center">
          <input id="yts-title" class="search-input flex-1" placeholder="e.g., Alien" value="Alien" />
          <button id="yts-run" class="btn">Search</button>
        </div>
        <div id="yts-status" class="text-[color:var(--muted)] text-sm"></div>
        <div id="yts-results" class="grid gap-2"></div>
      </section>
    </article>
  `;

    const $title = root.querySelector('#yts-title');
    const $run = root.querySelector('#yts-run');
    const $status = root.querySelector('#yts-status');
    const $results = root.querySelector('#yts-results');

    async function run() {
        $results.innerHTML = '';
        const t = String($title.value || '').trim();
        if (!t) return;
        $status.textContent = 'Loading…';
        try {
            const mod = await import('../../site/movies/yts/query_yts.js');
            const {queryYtsForTorrents} = mod;
            console.debug('[story:yts] querying for', t);
            const out = await queryYtsForTorrents(t);
            console.debug('[story:yts] result', out);
            $status.textContent = `Domain: ${out.domain || '-'} | Browse: ${out.browseUrl ? 'OK' : '—'} | Movie: ${out.movieUrl ? 'OK' : '—'} | Torrents: ${out.torrents.length}`;
            if (Array.isArray(out.torrents) && out.torrents.length) {
                for (const r of out.torrents) {
                    const card = document.createElement('div');
                    card.className = 'rounded border border-[rgba(255,255,255,0.08)] p-3 bg-[color:var(--panel)]';
                    const hashShort = (r.hash || '').slice(0, 12);
                    card.innerHTML = `
            <div class="text-sm font-mono text-[color:var(--text)]">${hashShort}…</div>
            <div class="text-xs text-[color:var(--muted)]">${r.description || ''}</div>
            <div class="mt-2 flex gap-3 text-xs">
              ${r.href_download ? `<a class="link" href="${r.href_download}" target="_blank" rel="noreferrer">download</a>` : ''}
              ${r.href_magnet ? `<a class="link" href="${r.href_magnet}" target="_blank" rel="noreferrer">magnet</a>` : ''}
            </div>
          `;
                    $results.appendChild(card);
                }
            } else {
                const empty = document.createElement('div');
                empty.className = 'text-[color:var(--muted)] text-sm';
                empty.textContent = 'No torrents found.';
                $results.appendChild(empty);
            }
        } catch (e) {
            console.debug('[story:yts] error', e);
            $status.textContent = 'Error — see console for details';
        }
    }

    $run.addEventListener('click', run);
    // Run once on load
    setTimeout(run, 0);
    return root;
};
