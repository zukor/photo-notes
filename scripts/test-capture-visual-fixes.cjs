const assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { chromium, webkit } = require('playwright');

(async () => {
  const app = express();
  app.use(express.static(path.join(__dirname, '../public')));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch();
      try {
        for (const width of [390, 1440]) {
          const page = await browser.newPage({ viewport: { width, height: 1000 }, serviceWorkers: 'block' });
          await page.addInitScript(() => localStorage.setItem('pn_install_prompt_dismissed_v1', 'dismissed'));
          await page.route('**/api/**', route => {
            const pathname = new URL(route.request().url()).pathname;
            const json = pathname === '/api/me'
              ? { id: 1, name: 'Capture Test', role: 'user', plan: 'pro', pro_type: 'general', edition_access: ['pro'] }
              : [];
            return route.fulfill({ json });
          });
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          await page.waitForFunction(() => state.me && document.getElementById('tabCapture'));
          await page.evaluate(() => {
            const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+VvYxWQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0));
            state.view = 'capture';
            state.photoFile = new File([bytes], 'capture.png', { type: 'image/png' });
            state.location = { lat: 29.55655, lng: -98.55486 };
            state.address = '47 Villa Jardin, San Antonio, TX 78230';
            renderApp();
          });
          await page.locator('#preview').waitFor({ state: 'visible' });
          const result = await page.evaluate(() => {
            const style = selector => getComputedStyle(document.querySelector(selector));
            const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
            return {
              captureBackground: style('#tabCapture').backgroundColor,
              captureText: style('#tabCapture').color,
              qualityDisplay: style('#qualityStatus').display,
              gpsBackground: style('#gps').backgroundColor,
              gpsBorder: style('#gps').borderTopWidth,
              addrBackground: style('#addr').backgroundColor,
              addrBorder: style('#addr').borderTopWidth,
              image: rect('#preview'),
              actions: rect('.capture-preview-actions'),
              retake: rect('#retakePhoto'),
              cancel: rect('#cancelPhoto'),
              overflow: document.documentElement.scrollWidth > innerWidth + 2
            };
          });
          assert.equal(result.captureBackground, 'rgb(29, 78, 216)');
          assert.equal(result.captureText, 'rgb(255, 255, 255)');
          assert.equal(result.qualityDisplay, 'none');
          assert.equal(result.gpsBackground, 'rgba(0, 0, 0, 0)');
          assert.equal(result.gpsBorder, '0px');
          assert.equal(result.addrBackground, 'rgba(0, 0, 0, 0)');
          assert.equal(result.addrBorder, '0px');
          assert(result.actions.top >= result.image.bottom + 8, 'photo must not overlap its actions');
          assert(result.retake.height > 0 && result.cancel.height > 0, 'photo actions must remain visible');
          assert.equal(result.overflow, false);
          if (engine === chromium && width === 390) await page.screenshot({ path: '/tmp/photo-notes-capture-visual-fixes.png', fullPage: true });
          console.log(`${engine.name()} ${width}: Capture color, metadata and preview actions PASS`);
          await page.close();
        }
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
