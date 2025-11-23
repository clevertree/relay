import '../template/site/movies/movie-search.js';
import '../template/site/modal/modal.js';

export default { title: 'Template/Movies/Search' };

export const Search = () => {
  const root = document.createElement('div');
  root.className = 'themed max-w-[1100px]';
  root.innerHTML = `
    <article>
      <header class="site-header mb-4">
         <h1 class="text-2xl font-semibold">Movies</h1>
         <div class="flex items-center gap-3">
           <movie-search></movie-search>
         </div>
      </header>
      <section id="search-results" class="movies-grid">
        <!-- movie-search will render results here -->
      </section>
    </article>
  `;

  // Let the search component render into the page as it normally would.
  return root;
};
