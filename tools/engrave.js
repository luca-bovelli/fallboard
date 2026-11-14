/* Pre-engraves the built-in scores with MuseScore's engine (webmscore) at every layout width.

     npm run engrave                every score in dist/scores whose engravings are missing or stale
     npm run engrave -- --force     all of them
     npm run engrave -- <name> ...  just these (dist/scores/<name>.musicxml), always

   Each <name>.musicxml gets <name>.narrow.json, .medium.json and .wide.json at the widths in
   LAYOUTS (dist/js/engrave-core.js), so every piece has the same staff size. Each file carries a
   stamp (src) hashing the score, engrave-core.js and the engine version; when any of them
   changes, the piece is stale and gets engraved again. The GitHub workflow runs this on every
   push, so a new piece only needs its .musicxml committed. */
'use strict';
// webmscore's Node build predates Node's own fetch and read-only navigator
globalThis.fetch = undefined;
Object.defineProperty(globalThis, 'navigator', { value: {}, writable: true, configurable: true });

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCORES = path.join(ROOT, 'dist', 'scores');
const CORE = path.join(ROOT, 'dist', 'js', 'engrave-core.js');
const core = require(CORE);

function engine() {
  const file = require.resolve('webmscore/webmscore.nodejs.cjs', { paths: [ROOT] });
  const version = require(require.resolve('webmscore/package.json', { paths: [ROOT] })).version;
  return { file, version };
}

/* line endings are normalised so a Windows checkout (CRLF) and GitHub's (LF) agree */
function stampOf(xmlFile, version) {
  const text = (f) => fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
  const h = crypto.createHash('sha256');
  h.update(text(xmlFile));
  h.update('\0');
  h.update(text(CORE));
  h.update('\0' + version);
  return h.digest('hex').slice(0, 16);
}

function isCurrent(name, stamp) {
  return core.LAYOUTS.every((l) => {
    try { return JSON.parse(fs.readFileSync(path.join(SCORES, `${name}.${l.key}.json`), 'utf8')).src === stamp; } catch (e) { return false; }
  });
}

/* one layout of one score, in its own process: the engine does not survive loading a second score */
async function child(xmlFile, out, layoutKey, stamp) {
  // MuseScore logs every bar too dense for the width; the summary line reports those systems instead
  for (const k of ['log', 'warn', 'error']) {
    const f = console[k].bind(console);
    console[k] = (...a) => { if (!/justifySystem/.test(String(a[0]))) f(...a); };
  }
  const { file } = engine();
  const mod = require(file);
  const WebMscore = mod.default || mod;
  await WebMscore.ready;
  const layout = core.LAYOUTS.find((l) => l.key === layoutKey);
  const t0 = Date.now();
  const eng = await core.engrave(WebMscore, fs.readFileSync(xmlFile, 'utf8'), layout.wsp);
  eng.src = stamp;
  const json = JSON.stringify(eng);
  fs.writeFileSync(out, json);
  const heads = eng.pages.reduce((n, p) => n + p.heads.length / 2, 0);
  const fitted = eng.pages.filter((p) => p.w).length;
  console.log(path.relative(ROOT, out) + ': ' + eng.pages.length + ' systems' + (fitted ? ` (${fitted} scaled to fit)` : '') + ', ' +
    eng.meas.length + ' bars, ' + heads + ' noteheads, ' + (json.length / 1024).toFixed(0) + ' KB, ' + (Date.now() - t0) + ' ms');
}

function main(args) {
  const { version } = engine();
  const force = args.includes('--force');
  const named = args.filter((a) => !a.startsWith('--'));
  const all = fs.readdirSync(SCORES).filter((f) => f.endsWith('.musicxml')).map((f) => f.slice(0, -9)).sort();
  for (const n of named) if (!all.includes(n)) { console.error(`dist/scores/${n}.musicxml not found`); process.exit(1); }
  let done = 0;
  for (const name of named.length ? named : all) {
    const xmlFile = path.join(SCORES, name + '.musicxml');
    const stamp = stampOf(xmlFile, version);
    if (!force && !named.length && isCurrent(name, stamp)) continue;
    for (const layout of core.LAYOUTS) {
      const out = path.join(SCORES, `${name}.${layout.key}.json`);
      // the engine very occasionally crashes on load; a fresh process usually gets through
      for (let attempt = 1; ; attempt++) {
        try {
          execFileSync(process.execPath, [__filename, '--child', xmlFile, out, layout.key, stamp], { stdio: ['ignore', 'inherit', 'pipe'] });
          break;
        } catch (e) {
          if (attempt >= 3) {
            process.stderr.write(String(e.stderr || e.message));
            console.error(`${name} (${layout.key}) failed after 3 attempts`);
            process.exit(1);
          }
          console.log(`${name} (${layout.key}) crashed, retrying`);
        }
      }
    }
    done++;
  }
  console.log(done ? `${done} score${done === 1 ? '' : 's'} engraved` : 'All engravings are up to date');
}

if (process.argv[2] === '--child') {
  const [, , , xmlFile, out, layoutKey, stamp] = process.argv;
  child(xmlFile, out, layoutKey, stamp).then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
} else {
  main(process.argv.slice(2));
}
