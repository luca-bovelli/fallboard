'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const SRC = path.join(ROOT, 'promo', 'src');
const OUT16 = path.join(ROOT, 'promo', 'clips', '16x9');
const OUT9 = path.join(ROOT, 'promo', 'clips', '9x16');
const PREV = path.join(ROOT, 'promo', '_preview');
[OUT16, OUT9, PREV].forEach((d) => fs.mkdirSync(d, { recursive: true }));

// Remove retired/old clips if present locally
for (const dir of [OUT16, OUT9]) {
  for (const old of ['01-pain-youtube.mp4', '02-pain-frankenstein.mp4', '04-hook-ledger.mp4', '06-bumper-step.mp4', '07-bumper-sync.mp4', '08-bumper-library.mp4']) {
    const p = path.join(dir, old);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
  '.musicxml': 'application/xml; charset=utf-8',
};

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const clean = decodeURIComponent((req.url || '/').split('?')[0]);
      const p = clean.startsWith('/_promo/')
        ? path.join(SRC, clean.slice('/_promo/'.length))
        : path.join(DIST, clean === '/' ? 'index.html' : clean);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
        fs.createReadStream(p).pipe(res);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

function encodePipe(outFile, fps) {
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(fps),
    '-i', '-',
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d.toString(); });
  const done = new Promise((res, rej) => {
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg failed ' + code + ': ' + err.slice(-400)))));
  });
  return { ff, done };
}

const FPS = 60;
const SCENES = [
  { name: '03-hook-purist', id: 'hook-purist', dur: 3.2, previewT: 2.15 },
  { name: '05-endcard', id: 'endcard', dur: 2.6, previewT: 1.4 },
];

const PREVIEW_ONLY = process.argv.includes('--preview-only');
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const FORMAT = process.argv.find((a) => a.startsWith('--format='))?.slice(9);

async function renderFormat(browser, port, vertical) {
  const ctxOpts = vertical
    ? { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 };
  const outDir = vertical ? OUT9 : OUT16;
  const tag = vertical ? '9x16' : '16x9';

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${port}/_promo/scenes.html`, { waitUntil: 'networkidle' });
  await page.evaluate(async (v) => {
    window.configureLayout(v);
    if (window.initPromoData) await window.initPromoData();
    if (document.fonts) await document.fonts.ready;
  }, vertical);

  const cdp = await ctx.newCDPSession(page);
  const clip = { x: 0, y: 0, width: ctxOpts.viewport.width, height: ctxOpts.viewport.height, scale: ctxOpts.deviceScaleFactor };

  for (const sc of SCENES) {
    if (ONLY && !ONLY.includes(sc.name)) continue;

    if (PREVIEW_ONLY) {
      await page.evaluate(([id, sec, opts]) => window.renderScene(id, sec, opts), [sc.id, sc.previewT, sc.opts || {}]);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      await page.evaluate(([id, sec, opts]) => window.renderScene(id, sec, opts), [sc.id, sc.previewT, sc.opts || {}]);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, clip });
      fs.writeFileSync(path.join(PREV, `${tag}-${sc.name}.jpg`), Buffer.from(data, 'base64'));
      console.log(`[preview ${tag}] ${sc.name}.jpg`);
      continue;
    }

    const outFile = path.join(outDir, `${sc.name}.mp4`);
    const frames = Math.round(sc.dur * FPS);
    const previewFrame = Math.round(sc.previewT * FPS);
    const tStart = Date.now();
    const { ff, done } = encodePipe(outFile, FPS);

    await page.evaluate(([id, opts]) => window.renderScene(id, 0, opts), [sc.id, sc.opts || {}]);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

    for (let f = 0; f < frames; f++) {
      const t = f / FPS;
      await page.evaluate(([id, sec, opts]) => window.renderScene(id, sec, opts), [sc.id, t, sc.opts || {}]);
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 94, clip });
      const buf = Buffer.from(data, 'base64');
      if (f === previewFrame) fs.writeFileSync(path.join(PREV, `${tag}-${sc.name}.jpg`), buf);
      if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await done;
    console.log(`[${tag}] ${sc.name}.mp4 (${frames}f @ ${FPS}fps) in ${((Date.now() - tStart) / 1000).toFixed(1)}s`);
  }

  await ctx.close();
}

(async () => {
  const { srv, port } = await startServer();
  const browser = await launchBrowser();
  try {
    if (!FORMAT || FORMAT === '16x9') await renderFormat(browser, port, false);
    if (!FORMAT || FORMAT === '9x16') await renderFormat(browser, port, true);
  } finally {
    await browser.close();
    srv.close();
  }
  console.log('DONE.');
})();
