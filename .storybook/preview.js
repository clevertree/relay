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
}

export default preview;