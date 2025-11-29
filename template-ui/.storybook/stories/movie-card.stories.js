export default { title: 'Template/Movies/Card' };

export const Card = () => {
  const root = document.createElement('div');
  root.className = 'themed max-w-[400px]';
  root.innerHTML = `
    <div class="bg-[color:var(--panel)] overflow-hidden rounded-md shadow-[0_6px_18px_rgba(2,6,23,0.6)] hover:-translate-y-1.5 hover:shadow-[0_12px_34px_rgba(2,6,23,0.75)] transition-transform transition-shadow border border-[rgba(255,255,255,0.04)]">
      <img class="w-full aspect-[2/3] object-cover block" src="https://image.tmdb.org/t/p/w500/qmDpIHrmpJINaRKAfWQfftjCdyi.jpg" alt="Poster" />
      <div class="px-3 py-2">
        <div class="font-semibold text-sm text-[color:var(--text)]">Inception <span class="text-[color:var(--muted)] text-xs">(2010)</span></div>
        <div class="text-[color:var(--muted)] text-xs mt-1">sci-fi, action</div>
      </div>
    </div>
  `;
  return root;
};
