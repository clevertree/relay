export default {
  title: 'Template/Viewport',
  tags: ['autodocs'],
};

function makeContainer(mode = 'desktop'){
  const wrap = document.createElement('div');
  wrap.className = 'themed mx-auto px-5 pb-16';
  wrap.style.maxWidth = mode === 'mobile' ? '420px' : '1100px';

  const header = document.createElement('header');
  header.className = 'site-header mb-4 flex-wrap';
  header.innerHTML = `<div class="flex items-center gap-2 flex-1 min-w-[260px]"><h1 class="m-0 text-2xl font-semibold">Movie Library</h1></div><div class="flex items-center gap-3 header-controls"><input placeholder="Search movies (title or year)" class="px-3 py-2 rounded-md border bg-[color:var(--panel)] text-[color:var(--text)] search-el" style="width:${mode==='mobile'?'100%':'360px'}" /><button class="px-3 py-2 rounded-md border border-black/15 bg-[color:var(--accent)] text-white">New Movie</button></div>`;

  const section = document.createElement('section');
  section.className = 'movies-grid';

  // populate from mock JSON served at /.storybook/tmdb-alien-page1.json
  (async () => {
    try {
      const res = await fetch('/.storybook/tmdb-alien-page1.json');
      const data = res.ok ? await res.json() : { results: [] };
      data.results.forEach(item => {
        const card = document.createElement('div');
        card.className = 'bg-[color:var(--panel)] overflow-hidden rounded-md shadow-[0_6px_18px_rgba(2,6,23,0.6)] hover:-translate-y-1.5 hover:shadow-[0_12px_34px_rgba(2,6,23,0.75)] transition-transform transition-shadow border border-[rgba(255,255,255,0.04)]';
        const img = document.createElement('img');
        img.className = 'w-full aspect-[2/3] object-cover block';
        img.src = item.poster_path ? ('https://image.tmdb.org/t/p/w500' + item.poster_path) : 'https://image.tmdb.org/t/p/w500/qmDpIHrmpJINaRKAfWQfftjCdyi.jpg';
        img.alt = item.title;
        const meta = document.createElement('div');
        meta.className = 'px-3 py-2';
        meta.innerHTML = `<div class="font-semibold text-sm text-[color:var(--text)]">${item.title} ${item.release_date ? '('+item.release_date.split('-')[0]+')' : ''}</div><div class="text-[color:var(--muted)] text-xs mt-1">${(item.genre_ids||[]).join(', ')}</div>`;
        card.appendChild(img);
        card.appendChild(meta);
        section.appendChild(card);
      });
    } catch (e) {
      console.error('Failed to load mock JSON for story', e);
    }
  })();

  wrap.appendChild(header);
  wrap.appendChild(section);
  return wrap;
}

export const Desktop = () => makeContainer('desktop');
export const Mobile = () => makeContainer('mobile');
