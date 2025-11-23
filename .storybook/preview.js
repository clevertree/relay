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
  globalTypes: {
    device: {
      name: 'Device',
      description: 'Switch device preview',
      defaultValue: 'desktop',
      toolbar: {
        icon: 'mirror',
        items: [
          { value: 'desktop', title: 'Desktop' },
          { value: 'mobile', title: 'Mobile' }
        ]
      }
    }
  },
  decorators: [
    (Story, context) => {
      const device = context.globals.device || 'desktop';
      document.documentElement.classList.toggle('mobile-mode', device === 'mobile');
      // Allow stories to have container width control by a wrapper element
      const el = Story();
      if (el && el.style) {
        el.style.maxWidth = device === 'mobile' ? '420px' : '';
        el.style.margin = device === 'mobile' ? '12px auto' : '24px auto';
      }
      // After the story mounts, run accessibility checks via axe
      Promise.resolve().then(async () => {
        try {
          if (!window.__STORYBOOK_RUN_A11Y__) {
            window.__STORYBOOK_RUN_A11Y__ = true;
          }
          // dynamically load axe-core from unpkg if not present
          if (!window.axe) {
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/axe-core@4.7.2/axe.min.js';
            script.async = true;
            document.head.appendChild(script);
            await new Promise((res, rej) => { script.onload = res; script.onerror = rej; });
          }
          // run axe on the story root (el or document.body)
          const root = el instanceof HTMLElement ? el : document.body;
          const options = { runOnly: { type: 'tag', values: ['wcag2aa', 'wcag21a'] } };
          const results = await window.axe.run(root, options);
          // filter for color-contrast or critical issues
          const contrast = results.violations.filter(v => v.id === 'color-contrast');
          if (results.violations.length) {
            console.group('[a11y] Storybook accessibility violations for', context.id || context.kind || 'story');
            console.log(results);
            console.groupEnd();
          }
          if (contrast.length) {
            console.warn('[a11y] color-contrast issues detected', contrast);
          }
          // emit event so automated runners can listen
          window.dispatchEvent(new CustomEvent('storybook:a11y', { detail: { story: context.id || context.kind, results } }));
        } catch (e) {
          console.warn('a11y check failed to run:', e);
        }
      });
      return el;
    }
  ],
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