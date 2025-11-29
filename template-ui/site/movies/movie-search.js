import {queryAllHybrid} from './tmdb/query_tmdb.js';

class MovieSearch extends HTMLElement {
    constructor() {
        super();
        this._debounce = null;
        this._page = 1;
        this._filterText = '';
        this._currentRun = 0;
        this._onInput = this._onInput.bind(this);
        this._onRefresh = this._onRefresh.bind(this);
    }

    connectedCallback() {
        this.innerHTML = `
      <div class="flex items-center gap-2">
        <input class="flex-1 min-w-[220px] rounded-lg border border-black/15 dark:border-white/15 px-3 py-2" type="search" placeholder="Search movies (title or year)" aria-label="Search movies" />
      </div>
      <div class="mt-3 border border-black/10 dark:border-white/10 rounded-xl overflow-hidden bg-white dark:bg-neutral-900" aria-live="polite" data-el="results"></div>
      <div class="mt-2 flex items-center justify-end gap-2 text-sm" data-el="pager">
        <button id="prev" class="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-neutral-100 dark:bg-neutral-800">Prev</button>
        <span id="page">1</span>
        <button id="next" class="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-neutral-100 dark:bg-neutral-800">Next</button>
      </div>
    `;
        this.$input = this.querySelector('input[type="search"]');
        this.$results = this.querySelector('[data-el="results"]');
        this.$prev = this.querySelector('#prev');
        this.$next = this.querySelector('#next');
        this.$page = this.querySelector('#page');
        this.$input?.addEventListener('input', this._onInput);
        this.$prev?.addEventListener('click', () => {
            if (this._page > 1) {
                this._page--;
                this._query();
            }
        });
        this.$next?.addEventListener('click', () => {
            this._page++;
            this._query();
        });
        this.addEventListener('movie-search:refresh', this._onRefresh);
        this._query();
    }

    disconnectedCallback() {
        this.$input?.removeEventListener('input', this._onInput);
        this.removeEventListener('movie-search:refresh', this._onRefresh);
    }

    _onRefresh() {
        this._query();
    }

    _onInput(e) {
        this._filterText = (e.target?.value || '').trim();
        this._page = 1;
        clearTimeout(this._debounce);
        this._debounce = setTimeout(() => this._query(), 200);
    }

    _branch() {
        const meta = document.querySelector('meta[name="relay-branch"]');
        return meta?.getAttribute('content') || 'main';
    }

    async _query() {
        const branch = this._branch();
        const run = ++this._currentRun;
        this.$page.textContent = String(this._page);
        this.$results.innerHTML = `<div class="px-3 py-2 text-neutral-600">Searching…</div>`;
        const onPartial = (_src, _res) => {
            if (run !== this._currentRun) return;
            this._render(_res.rows || []);
        };
        try {
            const res = await queryAllHybrid({
                text: this._filterText,
                page: this._page - 1,
                limit: 25,
                branch
            }, onPartial);
            if (run !== this._currentRun) return;
            const t = this._filterText.replace(/\"/g, '').toLowerCase();
            let items = res.rows || [];
            if (t && !(this._filterText.startsWith('"') && this._filterText.endsWith('"'))) {
                items = items.filter(it => String(it.title || '').toLowerCase().includes(t) || String(it.release_year || '') === t);
            }
            this._render(items);
        } catch (e) {
            console.error(e);
            if (run !== this._currentRun) return;
            this.$results.innerHTML = `<div class="px-3 py-2 text-red-600">Query error.</div>`;
        }
    }

    _render(items) {
        this.$page.textContent = String(this._page);
        if (!items.length) {
            this.$results.innerHTML = `<div class="px-3 py-2 italic text-neutral-600">No results.</div>`;
            return;
        }
        const header = `
      <div class="grid [grid-template-columns:1.5fr_1fr_120px_120px] text-sm font-semibold bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100">
        <div class="px-3 py-2">Title</div>
        <div class="px-3 py-2">Genres</div>
        <div class="px-3 py-2">Source</div>
        <div class="px-3 py-2">Actions</div>
      </div>`;
        const rows = items.map(it => {
            const title = it.title ?? '(untitled)';
            const year = it.release_year ?? '';
            const genres = Array.isArray(it.genre) ? it.genre.join(', ') : '';
            const dir = it.meta_dir || it._meta_dir || '';
            const source = it.source || (dir ? 'local' : 'tmdb');
            const dataId = it.id ? String(it.id) : (dir || `${title}::${year}`);
            const link = dir ? `<a class="text-blue-600 hover:underline" href="/${dir}" target="_blank">/${dir}</a>` : '';
            const badge = source === 'local'
                ? `<span class="inline-block text-xs px-2 py-1 rounded-full border border-emerald-300 text-emerald-800 bg-emerald-50 uppercase">local</span>`
                : `<span class="inline-block text-xs px-2 py-1 rounded-full border border-blue-300 text-blue-800 bg-blue-50 uppercase">tmdb</span>`;
            return `
        <div class="grid [grid-template-columns:1.5fr_1fr_120px_120px] items-center border-t border-black/5 dark:border-white/10 hover:bg-neutral-50 dark:hover:bg-neutral-800/50" data-source="${source}" data-id="${encodeURIComponent(dataId)}" data-dir="${dir}">
          <div class="px-3 py-2"><strong>${title}</strong> ${year ? `(${year})` : ''} ${link}</div>
          <div class="px-3 py-2">${genres || ''}</div>
          <div class="px-3 py-2">${badge}</div>
          <div class="px-3 py-2">
            <button class="btn-view px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-blue-600 text-white hover:bg-blue-700" aria-label="View ${title}">View</button>
          </div>
        </div>`;
        }).join('');
        this.$results.innerHTML = header + rows;
        this.$results.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const row = btn.closest('[data-source]');
                const source = row?.getAttribute('data-source') || 'local';
                const id = decodeURIComponent(row?.getAttribute('data-id') || '');
                const meta_dir = row?.getAttribute('data-dir') || '';
                const payload = {source, id, meta_dir};
                this.dispatchEvent(new CustomEvent('movie-search:open', {
                    detail: payload,
                    bubbles: true,
                    composed: true
                }));
            });
        });
    }
}

customElements.define('movie-search', MovieSearch);
