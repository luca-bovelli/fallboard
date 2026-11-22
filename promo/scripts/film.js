'use strict';
/* Renders promo/film/film.html: frames, the soundtrack, and the finished cut.

   node promo/scripts/film.js --format=16x9 --stills=12.4,16.0,24.5   stills (promo/_preview/film-…png)
   node promo/scripts/film.js --format=16x9 --shots=0,1               shots → promo/film/out/<format>/NN-name.mp4 + .json
   node promo/scripts/film.js --format=16x9 --chunk=2/12              the 3rd of 12 groups of shots (for CI)
   node promo/scripts/film.js --cut=hook --only=youtube-3,fallboard-4  just these shots
   node promo/scripts/film.js --format=16x9 --all                     every shot
   node promo/scripts/film.js --format=16x9 --assemble                audio from the shots' logs, joined → promo/exports/
   node promo/scripts/film.js --cut=hook --assemble --mixes=A,B,C     one export per sound mix, on the same picture
*/
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const arg = (k) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : null; };
const has = (k) => process.argv.includes('--' + k);
const FORMAT = arg('format') || '16x9';
const CUT = arg('cut') || 'main';
const FPS = +(arg('fps') || 60);
const SCALE = +(arg('scale') || 1);   // below 1: a quick low-resolution draft
const HLV = arg('hl');                // the hook's chord highlight, 1–4
const VERT = FORMAT === '9x16';
const VIEW = VERT ? { width: 360, height: 640, dpr: 3 } : { width: 1280, height: 720, dpr: 1.5 };
const TAG = CUT === 'main' ? FORMAT : `${CUT}-${FORMAT}`;
const OUT = path.join(ROOT, 'promo', 'film', 'out', TAG);
const PREVIEW = path.join(ROOT, 'promo', '_preview');
const EXPORTS = path.join(ROOT, 'promo', 'exports');
for (const d of [OUT, PREVIEW, EXPORTS]) fs.mkdirSync(d, { recursive: true });

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.musicxml': 'application/xml', '.xml': 'application/xml', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.wasm': 'application/wasm', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.css': 'text/css', '.mxl': 'application/octet-stream' };
function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let url = decodeURIComponent(req.url.split('?')[0]);
      if (url.endsWith('/')) url += 'index.html';
      const root = url.startsWith('/promo/') ? ROOT : DIST;
      const file = path.normalize(path.join(root, url));
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function encoder(file) {
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(FPS), '-i', '-',
    '-c:v', 'libx264', '-preset', SCALE < 1 ? 'veryfast' : 'slow', '-crf', SCALE < 1 ? '20' : '15', '-tune', 'film', '-x264-params', 'aq-mode=3',
    '-pix_fmt', 'yuv420p', '-r', String(FPS), '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c)))));
  return {
    async write(buf) { if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r)); },
    async end() { ff.stdin.end(); await done; },
  };
}

async function open() {
  const srv = await serve();
  const browser = await launchBrowser();
  const ctx = await browser.newContext({ viewport: { width: VIEW.width, height: VIEW.height }, deviceScaleFactor: VIEW.dpr });
  await ctx.addInitScript({ path: path.join(ROOT, 'promo', 'film', 'app-runtime.js') });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.text()); });
  page.on('pageerror', (e) => console.log('[page error]', e.message));
  const url = `http://127.0.0.1:${srv.address().port}/promo/film/film.html?format=${FORMAT}&cut=${CUT}&fps=${FPS}${HLV ? '&hl=' + HLV : ''}`;
  await page.goto(url, { waitUntil: 'load' });
  const info = await page.evaluate(() => window.FILM.ready());
  const cdp = await ctx.newCDPSession(page);
  return { srv, browser, page, cdp, info, close: async () => { await browser.close(); srv.close(); } };
}

async function shoot(cdp, format = 'jpeg') {
  const { data } = await cdp.send('Page.captureScreenshot', { format, quality: format === 'jpeg' ? 95 : undefined, optimizeForSpeed: true, fromSurface: true, clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: VIEW.dpr * SCALE } });
  return Buffer.from(data, 'base64');
}

async function renderShots(ids) {
  const s = await open();
  try {
    for (const i of ids) {
      const sh = s.info.shots[i];
      const name = String(i).padStart(2, '0') + '-' + sh.name;
      const t0 = Date.now();
      await s.page.evaluate((k) => window.FILM.begin(k), i);
      const enc = encoder(path.join(OUT, name + '.mp4'));
      await s.page.evaluate((k) => window.FILM.frame(k), sh.f0);
      console.log(`${name} starts:`, JSON.stringify(await s.page.evaluate(() => window.FILM.probe())));
      for (let f = sh.f0; f < sh.f1; f++) {
        await s.page.evaluate((k) => window.FILM.frame(k), f);
        await enc.write(await shoot(s.cdp));
        if ((f - sh.f0) % 60 === 0) process.stdout.write(`\r${name} ${f - sh.f0}/${sh.f1 - sh.f0}`);
      }
      await enc.end();
      console.log(`
${name} ends:  `, JSON.stringify(await s.page.evaluate(() => window.FILM.probe())));
      const events = await s.page.evaluate(() => window.FILM.drain());
      fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(events));
      console.log(`\r${name}: ${sh.f1 - sh.f0} frames, ${events.length} sounds, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  } finally { await s.close(); }
}

async function stills(times) {
  const s = await open();
  try {
    const want = times.map((t) => Math.round(t * s.info.fps)).sort((a, b) => a - b);
    const byShot = new Map();
    for (const f of want) {
      const i = s.info.shots.findIndex((sh) => f >= sh.f0 && f < sh.f1);
      if (i < 0) continue;
      if (!byShot.has(i)) byShot.set(i, []);
      byShot.get(i).push(f);
    }
    for (const [i, frames] of byShot) {
      const sh = s.info.shots[i];
      await s.page.evaluate((k) => window.FILM.begin(k), i);
      const last = Math.max(...frames);
      for (let f = sh.f0; f <= last; f++) {
        if (!frames.includes(f) && !frames.includes(f + 1)) { await s.page.evaluate((k) => window.FILM.skip(k), f); continue; }
        await s.page.evaluate((k) => window.FILM.frame(k), f);
        if (frames.includes(f)) {
          const file = path.join(PREVIEW, `film-${TAG}${HLV ? '-hl' + HLV : ''}-${(f / s.info.fps).toFixed(2)}.png`);
          fs.writeFileSync(file, await shoot(s.cdp, 'png'));
          console.log(file);
        }
      }
    }
  } finally { await s.close(); }
}

async function assemble() {
  for (const mix of (arg('mixes') || '').split(',')) await assembleMix(mix);
}
async function assembleMix(mix) {
  const files = fs.readdirSync(OUT).filter((f) => /^\d\d-.*\.mp4$/.test(f)).sort();
  const events = [];
  for (const f of files) {
    const j = path.join(OUT, f.replace('.mp4', '.json'));
    if (fs.existsSync(j)) events.push(...JSON.parse(fs.readFileSync(j, 'utf8')));
  }
  const s = await open();
  let wav;
  try {
    wav = await s.page.evaluate(([ev, d, m]) => window.FILM.renderAudio(ev, d, m || 'A'), [events, s.info.duration + 0.5, mix]);
  } finally { await s.close(); }
  const wavFile = path.join(OUT, `sound${mix ? '-' + mix : ''}.wav`);
  fs.writeFileSync(wavFile, Buffer.from(wav, 'base64'));
  const list = path.join(OUT, 'list.txt');
  fs.writeFileSync(list, files.map((f) => `file '${path.join(OUT, f).replace(/\\/g, '/')}'`).join('\n'));
  const out = path.join(EXPORTS, `fallboard-${TAG}${mix ? '-' + mix : ''}.mp4`);
  await new Promise((res, rej) => {
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-i', wavFile,
      '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
    ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg exited ' + c))));
  });
  console.log(out);
}

(async () => {
  if (arg('stills')) return stills(arg('stills').split(',').map(Number));
  if (has('assemble')) return assemble();
  if (arg('shots')) return renderShots(arg('shots').split(',').map(Number));
  if (arg('chunk') || has('all')) {
    const s = await open();
    const n = s.info.shots.length;
    await s.close();
    let ids = [...Array(n).keys()];
    if (arg('only')) { const want = arg('only').split(','); ids = ids.filter((i) => want.includes(s.info.shots[i].name)); }
    if (arg('chunk')) { const [k, of] = arg('chunk').split('/').map(Number); ids = ids.filter((_, j) => j % of === k); }
    if (!ids.length) return console.log('no shots in this chunk');
    return renderShots(ids);
  }
  console.log('nothing to do; see the header of promo/scripts/film.js');
})().catch((e) => { console.error(e); process.exit(1); });
