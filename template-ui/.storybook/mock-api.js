async function loadMockResults() {
    try {
        const res = await fetch('/.storybook/tmdb-alien-page1.json');
        if (!res.ok) throw new Error('Mock JSON not found');
        const data = await res.json();
        // load genre map (offline cached)
        try {
            const gres = await fetch('/.storybook/tmdb-genres.json');
            if (gres.ok) {
                const gjson = await gres.json();
                const map = {};
                for (const g of (gjson.genres || [])) map[g.id] = g.name;
                window.__tmdbGenreMap = map;
            }
        } catch (e) {
        }
        const grid = document.getElementById('movies-grid');
        if (!grid) return;
        grid.innerHTML = '';
        // Load local results first (simulate local DB)
        let localData = {results: []};
        try {
            const lres = await fetch('/.storybook/local-results.json');
            if (lres.ok) localData = await lres.json();
        } catch (e) {
        }

        // Try to use the tmdb transform logic if available in the template repo
        let transformFn = null;
        try {
            const mod = await import('/template-ui/site/movies/tmdb/query_tmdb.js');
            transformFn = mod.transformSearchResult || mod.default?.transformSearchResult || null;
        } catch (e) {
            // ignore — fallback to inline mapping
        }

        const genreMap = {};
        // If a genre map exists on window (exposed by other tmdb code), use it
        if (window.__tmdbGenreMap) Object.assign(genreMap, window.__tmdbGenreMap);

        // Merge local and remote results, emit local first, remote after; de-dup preferring local
        const seen = new Set();

        function keyOf(r) {
            // prefer local id/meta if present
            if (r.id && String(r.id).startsWith('local-')) return `local:${r.id}`;
            return `${(r.title || '').toLowerCase()}::${(r.release_date || '').slice(0, 4)}
`;
        }


        // Render helper
        const renderRow = (mapped) => {
            const card = document.createElement('div');
            card.className = 'bg-[color:var(--panel)] overflow-hidden rounded-md shadow-[0_6px_18px_rgba(2,6,23,0.6)] hover:-translate-y-1.5 hover:shadow-[0_12px_34px_rgba(2,6,23,0.75)] transition-transform transition-shadow border border-[rgba(255,255,255,0.04)]';
            const img = document.createElement('img');
            img.className = 'w-full aspect-[2/3] object-cover block';
            img.src = mapped.poster_local || mapped.url_poster || 'https://image.tmdb.org/t/p/w500/qmDpIHrmpJINaRKAfWQfftjCdyi.jpg';
            img.alt = mapped.title || '';
            const meta = document.createElement('div');
            meta.className = 'px-3 py-2';
            meta.innerHTML = `<div class="font-semibold text-sm text-[color:var(--text)]">${mapped.title} ${mapped.release_year ? '(' + mapped.release_year + ')' : ''}</div><div class="text-[color:var(--muted)] text-xs mt-1">${(mapped.genre || []).join(', ')}</div>`;
            card.appendChild(img);
            card.appendChild(meta);
            grid.appendChild(card);
        };

        // Emit local results first
        for (const l of (localData.results || [])) {
            const k = keyOf(l);
            seen.add(k);
            renderRow({
                title: l.title,
                release_year: l.release_date ? Number(l.release_date.slice(0, 4)) : undefined,
                poster_local: l.poster_local,
                genre: l.genre
            });
        }

        // Now remote
        for (const item of (data.results || [])) {
            const mapped = transformFn ? transformFn(item, genreMap) : (function (r) {
                const title = r.title || r.original_title || '';
                const release_year = r.release_date ? Number((r.release_date || '').slice(0, 4)) : undefined;
                const id = r.id ? String(r.id) : undefined;
                const url_poster = r.poster_path ? ('https://image.tmdb.org/t/p/w500' + r.poster_path) : undefined;
                return {
                    id,
                    title,
                    release_year,
                    url_poster,
                    overview: r.overview,
                    genre: (r.genre_ids || []).slice(0, 3)
                };
            })(item);
            const k = `${(mapped.title || '').toLowerCase()}::${mapped.release_year || ''}`;
            if (seen.has(k)) continue; // dedupe prefer local
            seen.add(k);
            renderRow(mapped);
        }
    } catch (err) {
        console.error('Failed to load mock results', err);
    }
}

// Run on load in stories
if (typeof window !== 'undefined') {
    window.addEventListener('load', () => loadMockResults());
}
