import '../template/site/movies/movie-viewer.js';

export default { title: 'Template/Movies/Viewer' };

export const Viewer = () => {
  const root = document.createElement('div');
  root.className = 'themed max-w-[1100px]';
  root.innerHTML = `
    <article>
      <header class="site-header mb-4">
        <h1 class="text-2xl font-semibold">Movie Viewer</h1>
      </header>

      <section class="movies-grid" id="viewer-grid">
        <movie-viewer></movie-viewer>
      </section>
    </article>
  `;
  return root;
};
