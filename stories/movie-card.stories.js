export default { title: 'Template/Movies/Card' };

export const Card = () => {
  const root = document.createElement('div');
  root.className = 'themed max-w-[400px]';
  root.innerHTML = `
    <div class="movie-card">
      <img class="movie-poster" src="https://image.tmdb.org/t/p/w500/qmDpIHrmpJINaRKAfWQfftjCdyi.jpg" alt="Poster" />
      <div class="movie-meta">
        <div class="movie-title">Inception <span class="movie-sub">(2010)</span></div>
        <div class="movie-sub">sci-fi, action</div>
      </div>
    </div>
  `;
  return root;
};
