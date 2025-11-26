/* Branch detector content script
 * Reads <meta name="relay-branch"> on the page and reports it to background.
 */
(function() {
  function report() {
    try {
      const meta = document.querySelector('meta[name="relay-branch"]');
      const branch = meta ? meta.getAttribute('content') : null;
      const metaRepo = document.querySelector('meta[name="relay-repo"]');
      const repo = metaRepo ? metaRepo.getAttribute('content') : null;
      const origin = location.origin;
      const msg = { type: 'pageBranch', branch, repo, origin };
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        chrome.runtime.sendMessage(msg, () => {});
      } else if (typeof browser !== 'undefined' && browser.runtime) {
        browser.runtime.sendMessage(msg).catch(() => {});
      }
    } catch (_) {}
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', report);
  } else {
    report();
  }
})();
