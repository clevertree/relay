class MovieUpsert extends HTMLElement {
  constructor() {
    super();
    this._onSubmit = this._onSubmit.bind(this);
    this._insertTemplate = null;
  }

  connectedCallback() {
    this.innerHTML = `
      <form novalidate class="grid gap-3 text-sm">
        <div class="grid gap-1">
          <label for="title" class="font-semibold">Title</label>
          <input class="rounded-lg border border-black/15 dark:border-white/15 px-3 py-2" id="title" name="title" required minlength="1" autocomplete="off" />
        </div>
        <div class="grid gap-1">
          <label for="release_date" class="font-semibold">Release date</label>
          <input class="rounded-lg border border-black/15 dark:border-white/15 px-3 py-2" id="release_date" name="release_date" type="date" required pattern="\\d{4}-\\d{2}-\\d{2}" />
          <div class="text-neutral-600">YYYY-MM-DD</div>
        </div>
        <div class="grid gap-1">
          <label for="genre" class="font-semibold">Genres</label>
          <input class="rounded-lg border border-black/15 dark:border-white/15 px-3 py-2" id="genre" name="genre" placeholder="comma, separated, genres" required />
          <div class="text-neutral-600">Example: sci-fi, action</div>
        </div>
        <div class="grid gap-1">
          <label for="extra" class="font-semibold">Extra meta (optional JSON)</label>
          <textarea class="rounded-lg border border-black/15 dark:border-white/15 px-3 py-2" id="extra" name="extra" rows="3" placeholder='{"rating": 8.5}'></textarea>
          <div class="text-neutral-600">This will be merged into meta.json</div>
        </div>
        <div class="text-red-600" id="error" role="alert" aria-live="assertive"></div>
        <div class="flex items-center justify-end gap-2 mt-1">
          <button type="button" class="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-neutral-100 dark:bg-neutral-800" id="cancel">Cancel</button>
          <button type="submit" class="px-3 py-2 rounded-md border border-black/15 dark:border-white/15 bg-blue-600 text-white">Create</button>
        </div>
      </form>
    `;
    this.$form = this.querySelector('form');
    this.$err = this.querySelector('#error');
    this.querySelector('#cancel')?.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('movie-upsert:cancel', { bubbles: true, composed: true }));
    });
    this.$form?.addEventListener('submit', this._onSubmit);
    this._loadInsertTemplate().catch(() => {});
  }

  disconnectedCallback() {
    this.$form?.removeEventListener('submit', this._onSubmit);
  }

    _branch() {
        const meta = document.querySelector('meta[name="relay-branch"]');
        return meta?.getAttribute('content') || 'main';
    }

    async _loadInsertTemplate() {
        try {
            const res = await fetch('/relay.yaml', {headers: {'X-Relay-Branch': this._branch()}});
            if (!res.ok) return;
            const txt = await res.text();
            const m = txt.match(/insertTemplate:\s*"([^"]+)"/);
            if (m) this._insertTemplate = m[1];
        } catch {
        }
    }

    _computeInsertDir(meta) {
        // If we managed to fetch the template, use it as a JS template literal with fields in scope
        const title = meta.title || '';
        const release_date = meta.release_date || '';
        if (this._insertTemplate) {
            try {
                // Evaluate as template literal safely scoped to provided fields
                // eslint-disable-next-line no-new-func
                const fn = new Function('title', 'release_date', `return \`${this._insertTemplate}\`;`);
                let out = fn(title, release_date);
                out = String(out || '').replace(/^\/+/, '').replace(/\/+/g, '/');
                if (out && !out.endsWith('/')) out += '/';
                return out;
            } catch (e) {
                console.warn('insertTemplate eval failed, falling back', e);
            }
        }
        // Fallback matches the default provided by this template repo
        const year = (String(release_date).match(/\d{4}/) || [''])[0];
        const slug = String(title).trim().replace(/ +/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
        let out = `data/${year}/${slug}/`;
        return out.replace(/^\/+/, '');
    }

    _validate() {
        this.$err.textContent = '';
        const fd = new FormData(this.$form);
        const title = (fd.get('title') || '').toString().trim();
        const release_date = (fd.get('release_date') || '').toString().trim();
        const genre = (fd.get('genre') || '').toString().split(',').map(s => s.trim()).filter(Boolean);
        const extraTxt = (fd.get('extra') || '').toString().trim();
        if (!title) return {ok: false, msg: 'Title is required.'};
        if (!/^\d{4}-\d{2}-\d{2}$/.test(release_date)) return {ok: false, msg: 'Release date must be YYYY-MM-DD.'};
        if (!genre.length) return {ok: false, msg: 'At least one genre is required.'};
        let extra = {};
        if (extraTxt) {
            try {
                extra = JSON.parse(extraTxt);
            } catch {
                return {ok: false, msg: 'Extra meta must be valid JSON.'};
            }
        }
        const meta = {title, release_date, genre, ...extra};
        return {ok: true, meta};
    }

    async _onSubmit(e) {
        e.preventDefault();
        const v = this._validate();
        if (!v.ok) {
            this.$err.textContent = v.msg;
            return;
        }
        const meta = v.meta;
        const dir = this._computeInsertDir(meta);
        const path = `${dir}meta.json`;
        try {
            const res = await fetch(`/${encodeURIComponent(path)}`, {
                method: 'PUT',
                headers: {'Content-Type': 'application/json', 'X-Relay-Branch': this._branch()},
                body: JSON.stringify(meta)
            });
            if (!res.ok) {
                const t = await res.text();
                throw new Error(t || `PUT failed: ${res.status}`);
            }
            const json = await res.json();
            this.dispatchEvent(new CustomEvent('movie-upsert:success', {detail: json, bubbles: true, composed: true}));
            // Reset form for next insert
            this.$form.reset();
        } catch (err) {
            this.$err.textContent = err.message || String(err);
        }
    }

    // Public: populate form fields from a meta-like object
    // Expected fields: title (string), release_date (YYYY-MM-DD) or release_year (number),
    // genre (array[string]), overview, url_poster, url_backdrop, and any extra fields to merge.
    populate(meta) {
        const $title = this.querySelector('#title');
        const $date = this.querySelector('#release_date');
        const $genre = this.querySelector('#genre');
        const $extra = this.querySelector('#extra');
        if ($title && meta?.title) $title.value = String(meta.title);
        // Prefer full release_date; fallback to release_year-01-01 if available
        let rd = meta?.release_date;
        if ((!rd || !/^\d{4}-\d{2}-\d{2}$/.test(rd)) && meta?.release_year) {
            const yr = String(meta.release_year).padStart(4, '0');
            rd = `${yr}-01-01`;
        }
        if ($date && rd) $date.value = rd;
        if ($genre && Array.isArray(meta?.genre)) $genre.value = meta.genre.join(', ');
        // Merge extra fields into JSON textarea
        const extras = {};
        if (meta?.overview) extras.overview = meta.overview;
        if (meta?.url_poster) extras.url_poster = meta.url_poster;
        if (meta?.url_backdrop) extras.url_backdrop = meta.url_backdrop;
        // Preserve existing extra JSON if any
        try {
            const existing = ($extra?.value || '').trim();
            if (existing) Object.assign(extras, JSON.parse(existing));
        } catch {}
        if ($extra) $extra.value = Object.keys(extras).length ? JSON.stringify(extras, null, 2) : '';
    }
}

customElements.define('movie-upsert', MovieUpsert);
