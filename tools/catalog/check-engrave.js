/* Engraves every checked score file once, at the medium width, into .data/engrave.json.

     node tools/catalog/check-engrave.js [jobs]     jobs: files engraved at once (default 4)

   Each repaired file (.data/scores/, written by check-scores.js) runs in its own process (the
   engine does not survive a second score) with a ten-minute limit. Recorded per file: whether it engraved, the time, the systems, how many systems
   were too dense for the width and had to be drawn smaller, and the first system's SVG for a
   visual review. */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, '.data', 'pdmx');
const XML = path.join(DATA, 'xml');
const OUT = path.join(ROOT, '.data', 'engrave.json');

if (process.argv[2] === '--child') {
  // webmscore's Node build predates Node's own fetch and read-only navigator
  globalThis.fetch = undefined;
  Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });
  for (const k of ['log', 'warn', 'error']) { const f = console[k].bind(console); console[k] = (...a) => { if (!/justifySystem/.test(String(a[0]))) f(...a); }; }
  const core = require(path.join(ROOT, 'dist', 'js', 'engrave-core.js'));
  const mod = require(require.resolve('webmscore/webmscore.nodejs.cjs', { paths: [ROOT] }));
  const W = mod.default || mod;
  (async () => {
    await W.ready;
    const t0 = Date.now();
    const eng = await core.engrave(W, fs.readFileSync(process.argv[3], 'utf8'), core.LAYOUTS.find((l) => l.key === 'medium').wsp);
    const first = eng.pages[0];
    process.stdout.write('\n@@' + JSON.stringify({
      ok: true, ms: Date.now() - t0, systems: eng.pages.length, scaled: eng.pages.filter((p) => p.w).length,
      bars: eng.meas.filter(Boolean).length, w: eng.w, first: first && { y0: first.y0, h: first.h, w: first.w, svg: first.svg }, defs: eng.defs,
    }) + '\n');
    process.exit(0);
  })().catch((e) => { process.stdout.write('\n@@' + JSON.stringify({ ok: false, error: String(e && e.message || e) }) + '\n'); process.exit(0); });
  return;
}

const { fixedPath } = require('./check-scores');
const checks = JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'checks.json'), 'utf8'));
const jobs = +process.argv[2] || 4;
fs.mkdirSync(XML, { recursive: true });
/* results are keyed by source and path ("pdmx:mxl/..."); an older run kept PDMX paths alone */
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const older = path.join(DATA, 'engrave.json');
if (fs.existsSync(older)) for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(older, 'utf8')))) if (!done['pdmx:' + k]) done['pdmx:' + k] = v;
const todo = checks.filter((c) => !done[c.key] && c.verdict !== 'reject' && fs.existsSync(fixedPath(c.mxl, c.source)));
console.log(`${todo.length} files to engrave, ${jobs} at a time`);

function one(c) {
  return new Promise((resolve) => {
    /* the repaired file, as the app gets it */
    const file = fixedPath(c.mxl, c.source);
    const child = spawn(process.execPath, [__filename, '--child', file], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => child.kill(), 600000);
    child.on('exit', () => {
      clearTimeout(timer);
      const m = out.match(/@@(.*)\n/);
      resolve(m ? JSON.parse(m[1]) : { ok: false, error: err.trim().split('\n').slice(-2).join(' ') || 'timed out or crashed' });
    });
  });
}

(async () => {
  let i = 0, n = 0;
  const t0 = Date.now();
  const save = () => fs.writeFileSync(OUT, JSON.stringify(done));
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (i < todo.length) {
      const c = todo[i++];
      done[c.key] = await one(c);
      if (++n % 25 === 0) { save(); console.log(`${n}/${todo.length} after ${((Date.now() - t0) / 60000).toFixed(1)} min`); }
    }
  }));
  save();
  const all = Object.values(done);
  const failed = all.filter((r) => !r.ok);
  console.log(`${all.length} engraved: ${failed.length} failed; ${all.filter((r) => r.scaled).length} with systems too dense for the width`);
  for (const f of failed.slice(0, 10)) console.log('  failed: ' + f.error);
})();
