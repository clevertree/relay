import { chromium } from 'playwright';

// Simple script: open Storybook, iterate through story links on the manager, and
// listen for the `storybook:a11y` event dispatched by preview after each story.
(async function main(){
  const base = process.env.STORYBOOK_URL || 'http://localhost:6006';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base);

  // wait for storybook manager to load
  await page.waitForSelector('#storybook-root, #root');

  // collect story links from the manager tree
  const stories = await page.evaluate(() => {
    const anchors = Array.from(document.querySelectorAll('a[role="treeitem"]'));
    return anchors.map(a => ({ href: a.getAttribute('href'), title: a.textContent.trim() }));
  });

  const failures = [];

  const schemes = ['light', 'dark'];
  for (const s of stories) {
    if (!s.href) continue;
    const url = new URL(s.href, base).toString();
    for (const scheme of schemes) {
      console.log('Visiting', s.title, url, 'scheme:', scheme);
      const storyPage = await browser.newContext({
        colorScheme: scheme,
      }).newPage();
      // listen for a11y event
      const results = await storyPage.evaluate(({url}) => new Promise((resolve, reject) => {
        window.addEventListener('storybook:a11y', function handler(e){
          // give the browser a tick to ensure logging
          setTimeout(() => { resolve(e.detail.results); }, 10);
        }, { once: true });
        window.location.href = url;
        setTimeout(() => reject(new Error('a11y event timeout')), 10000);
      }), { url });

      if (results.violations && results.violations.length) {
        failures.push({ story: s.title, scheme, violations: results.violations });
        console.warn('Accessibility violations for', s.title, scheme, results.violations.length);
      } else {
        console.log('No accessibility violations for', s.title, scheme);
      }
      await storyPage.close();
    }
  }

  await browser.close();
  if (failures.length) {
    console.error('Accessibility check failed for some stories');
    console.error(JSON.stringify(failures, null, 2));
    process.exit(2);
  }
  console.log('Accessibility checks passed for all visited stories');
})();
