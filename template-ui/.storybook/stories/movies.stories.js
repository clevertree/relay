import '../../site/modal/modal.js';
import '../../site/movies/movie-search.js';
import '../../site/movies/movie-upsert.js';
import '../../site/movies/movie-viewer.js';

export default {title: 'Template/Movies'};

export const SearchAndViewer = () => {
    const root = document.createElement('div');
    root.innerHTML = `
    <article class="themed" style="--max-width: 1100px;">
      <header class="flex items-center justify-between gap-2 mb-3">
        <h1 class="m-0 text-lg font-semibold">Movies</h1>
        <button id="open-create-modal" class="px-3 py-2 rounded-md border border-black/15 bg-blue-600 text-white">New Movie</button>
      </header>

      <movie-search></movie-search>

      <relay-modal id="create-modal" title="Add New Movie">
        <movie-upsert></movie-upsert>
      </relay-modal>

      <movie-viewer></movie-viewer>
    </article>
  `;
    const openBtn = root.querySelector('#open-create-modal');
    const modal = root.querySelector('#create-modal');
    openBtn?.addEventListener('click', () => modal?.open());
    modal?.addEventListener('movie-upsert:success', () => {
        // refresh any search components on success
        root.querySelectorAll('movie-search').forEach(el => el.dispatchEvent(new CustomEvent('movie-search:refresh')));
    });
    return root;
};
