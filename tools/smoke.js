/* A smoke test in a real browser (headless Chromium, through Playwright): serves dist/, opens the
   player, the library, a piece page with its sheet music, a search and the score view, at a
   phone's size and a desktop's, and fails on any script error. Screenshots of each go to
   .data/smoke/, which the test workflow (.github/workflows/test.yml) keeps for viewing.

     npm install --no-save playwright && npx playwright install chromium
     node tools/smoke.js */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, '.data', 'smoke');
const PORT = 5199;
const BASE = 'http://localhost:' + PORT + '/';

const SIZES = { phone: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, desktop: { width: 1280, height: 800 } };
/* each step: where to go, what must appear, and how long it may take (ms) */
const STEPS = [
  { name: 'player', url: '', wait: '#roll canvas, canvas', timeout: 20000 },
  { name: 'library', url: '#library', wait: '.explore-tabs', timeout: 20000 },
  { name: 'search', url: '#library/~search/chopin%20fm', wait: '#libPage .row', timeout: 30000 },
  { name: 'piece', url: '#library/chopin/op-28/4', wait: '.sheet-page img', timeout: 90000 },
  { name: 'work', url: '#library/chopin/op-10', wait: '#libPage .row .lvl', timeout: 20000 },
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const server = spawn(process.execPath, [path.join(ROOT, 'dev-server.js')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 800));
  const browser = await chromium.launch();
  const failures = [];
  try {
    for (const [size, viewport] of Object.entries(SIZES)) {
      const context = await browser.newContext({ ...viewport, viewport: { width: viewport.width, height: viewport.height } });
      for (const step of STEPS) {
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
        const label = `${size} ${step.name}`;
        try {
          await page.goto(BASE + step.url, { waitUntil: 'load' });
          await page.waitForSelector(step.wait, { timeout: step.timeout, state: 'attached' });
          await page.waitForTimeout(800);
        } catch (e) { errors.push('did not show ' + step.wait + ': ' + e.message.split('\n')[0]); }
        await page.screenshot({ path: path.join(OUT, `${size}-${step.name}.png`) });
        /* the score view, from the player */
        if (step.name === 'player' && !errors.length) {
          try {
            await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^\s*Score\s*$/.test(b.textContent)).click());
            await page.waitForSelector('.sys svg', { timeout: 90000 });
            await page.waitForTimeout(500);
            await page.screenshot({ path: path.join(OUT, `${size}-score.png`) });
          } catch (e) { errors.push('score view: ' + e.message.split('\n')[0]); }
        }
        console.log((errors.length ? 'FAIL ' : 'ok   ') + label + (errors.length ? '\n     ' + errors.join('\n     ') : ''));
        if (errors.length) failures.push(label);
        await page.close();
      }
      await context.close();
    }
  } finally {
    await browser.close();
    server.kill();
  }
  if (failures.length) { console.error(`${failures.length} failed: ${failures.join(', ')}`); process.exit(1); }
  console.log('all steps passed; screenshots in .data/smoke/');
})().catch((e) => { console.error(e); process.exit(1); });
