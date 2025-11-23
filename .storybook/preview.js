/** @type { import('@storybook/web-components-vite').Preview } */
const preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
};

  // Inject the compiled globals stylesheet (Tailwind output) so stories get the
  // same styles as the app template. This points at the compiled file produced
  // by `pnpm run tailwind:build` -> template/site/globals.generated.css served at /site/globals.generated.css
  if (typeof window !== 'undefined') {
    const ensureCss = (href) => {
      if ([...document.styleSheets].some(s => s.href && s.href.endsWith(href))) return;
      if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(l => (l.getAttribute('href')||'').endsWith(href))) return;
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      document.head.appendChild(link);
    };
    ensureCss('/site/globals.generated.css');

  // Provide simple stubs so components that perform fetches don't error in Storybook
  const originalFetch = window.fetch?.bind(window) || fetch;
  window.fetch = async (input, init = {}) => {
    try {
      const url = typeof input === 'string' ? input : (input?.url || '');
      const method = (init.method || (typeof input !== 'string' ? input?.method : '') || 'GET').toUpperCase();
      if (url.endsWith('/env') && method === 'POST') {
        return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'QUERY' || (url.includes('/query') && method === 'POST')) {
        const body = { items: [
          { _id: 'loc-1', title: 'Inception', release_year: 2010, genre: ['sci-fi','action'], meta_dir: 'data/2010/inception' },
          { _id: 'loc-2', title: 'Interstellar', release_year: 2014, genre: ['sci-fi','drama'], meta_dir: 'data/2014/interstellar' },
        ], total: 2, page: 0, pageSize: 25, branch: 'main' };
        return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'PUT') {
        // Accept any PUT in stories and return a WriteResponse-like shape
        const res = { commit: 'storybook-commit', branch: 'main', path: (typeof input === 'string' ? input : input?.url || '') };
        return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (method === 'GET' && /\/data\/.+\/meta\.json$/.test(url)) {
        const sample = {
          title: 'Inception', release_date: '2010-07-16', genre: ['sci-fi','action'],
          url_poster: 'https://image.tmdb.org/t/p/w500/qmDpIHrmpJINaRKAfWQfftjCdyi.jpg',
          url_backdrop: 'https://image.tmdb.org/t/p/w780/s3TBrRGB1iav7gFOCNx3H31MoES.jpg',
          overview: 'A thief who steals corporate secrets through use of dream-sharing technology...'
        };
        return new Response(JSON.stringify(sample), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return originalFetch(input, init);
    } catch (e) {
      return originalFetch(input, init);
    }
  };
}

export default preview;