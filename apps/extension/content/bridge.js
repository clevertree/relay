/* Page bridge that exposes window.Streaming and relays to background via runtime messaging. */
(function() {
  const API_METHODS = [
    'refreshBackend','addMagnet','status','listFiles','requestPlay','openWithSystem','resumeWhenAvailable','cancelResume'
  ];

  // Inject an in-page script that defines window.Streaming and communicates via window.postMessage
  const injected = document.createElement('script');
  injected.type = 'text/javascript';
  injected.textContent = `(() => {
    const CH = 'relay-streaming';
    const pending = new Map();
    function call(method, ...args) {
      return new Promise((resolve) => {
        const nonce = Math.random().toString(36).slice(2);
        pending.set(nonce, resolve);
        window.postMessage({ channel: CH, dir: 'page->cs', method, args, nonce }, '*');
      });
    }
    const api = {};
    ${API_METHODS.map(m => `api.${m} = (...a) => call('${m}', ...a);`).join('\n    ')}
    Object.defineProperty(window, 'Streaming', { value: api, writable: false });
    window.addEventListener('message', (ev) => {
      const d = ev && ev.data; if (!d || d.channel !== CH || d.dir !== 'cs->page') return;
      const fn = pending.get(d.nonce); if (fn) { pending.delete(d.nonce); fn(d.payload); }
    });
  })();`;
  (document.head || document.documentElement).appendChild(injected);
  injected.remove();

  const CH = 'relay-streaming';
  // Content script listens for page requests and forwards to background
  window.addEventListener('message', (ev) => {
    const d = ev && ev.data; if (!d || d.channel !== CH || d.dir !== 'page->cs') return;
    try {
      const method = d.method; const args = d.args;
      const send = (payload) => window.postMessage({ channel: CH, dir: 'cs->page', nonce: d.nonce, payload }, '*');
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage({ type: 'streamingCall', method, args }, (res) => {
          send(res && res.result !== undefined ? res.result : (res || {}));
        });
      } else if (typeof browser !== 'undefined' && browser.runtime) {
        browser.runtime.sendMessage({ type: 'streamingCall', method, args }).then((res) => send(res && res.result !== undefined ? res.result : (res || {}))).catch(() => send({ error: 'bridge failed' }));
      }
    } catch (e) {
      // swallow
    }
  });
})();
