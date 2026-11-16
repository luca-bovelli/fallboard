/* Puts the catalogue in the app: dist/library/catalog.json, dist/library/scores/<id>.mxl and
   dist/js/catalog.js (the search, for the browser).

     node tools/catalog/publish.js

   Every entry with a usable file (.data/checks.json, verdict "ok") gets one score: the repaired
   file (.data/scores, written by check-scores.js) of its best candidate, zipped as .mxl. The best
   candidate is the source's quality less what the checks found: bars that overflow, a key that
   disagrees with the catalogue, a wrong length weigh most. The pieces built into the player
   (dist/scores, engraved ahead of time) are marked so the library opens those instead.

   The catalogue is trimmed to what the library shows and the search reads. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { fixedPath } = require('./check-scores');

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(DIST, 'library');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const checks = JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'checks.json'), 'utf8'));

/* the player's own pieces, by catalogue id (their files are in dist/scores) */
const BUILTIN = {
  'chopin/op-23': 'ballade-op23',
  'rachmaninoff/op-3/2': 'rach-cs',
  'rachmaninoff/op-23/5': 'rach-gm',
  'rachmaninoff/op-23/2': 'rach-bb',
  'chopin/op-10/12': 'revolutionary',
};

/* ---------- the best file per entry ---------- */
const COST = { overfull: 25, key: 25, range: 30, length: 10, 'short-bars': 6, voices: 4, 'hidden-notes': 4 };
/* a file MuseScore's engine cannot engrave (.data/engrave.json, from check-engrave.js) still plays
   in the roll, so it is kept when nothing better exists */
const engraved = fs.existsSync(path.join(ROOT, '.data', 'engrave.json')) ? JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'engrave.json'), 'utf8')) : {};
const worth = (c) => (c.quality || 0) - (c.flags || []).reduce((a, f) => a + (COST[f] || 0), 0) - (engraved[c.key] && !engraved[c.key].ok ? 60 : 0);
/* files and pieces found wrong by ear or eye, even if the checks have not run since */
const REJECTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'rejects.json'), 'utf8'));
const best = new Map();
for (const c of checks) {
  if (c.verdict !== 'ok' || REJECTS.files[c.key] || !fs.existsSync(fixedPath(c.mxl, c.source))) continue;
  const was = best.get(c.id);
  if (!was || worth(c) > worth(was)) best.set(c.id, c);
}

/* ---------- .mxl: the MusicXML file and its container, deflated ---------- */
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of files) {
    const raw = Buffer.from(text, 'utf8');
    const data = zlib.deflateRawSync(raw, { level: 9 });
    const crc = zlib.crc32(raw);
    const n = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(n.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, n, data);
    centrals.push(central, n);
    offset += 30 + n.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
const CONTAINER = '<?xml version="1.0" encoding="UTF-8"?>\n<container><rootfiles><rootfile full-path="score.musicxml" media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n';

/* ---------- write ---------- */
const scoresDir = path.join(OUT, 'scores');
fs.rmSync(scoresDir, { recursive: true, force: true });
let bytes = 0;
const scoreOf = new Map();
for (const [id, c] of best) {
  const rel = id + '.mxl';
  const file = path.join(scoresDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const z = zip([['META-INF/container.xml', CONTAINER], ['score.musicxml', fs.readFileSync(fixedPath(c.mxl, c.source), 'utf8')]]);
  fs.writeFileSync(file, z);
  bytes += z.length;
  scoreOf.set(id, { s: rel, lic: c.license === 'CC BY-NC-SA 4.0' ? 'by-nc-sa' : undefined, from: c.source });
}

const KEEP = ['id', 'composer', 'kind', 'parent', 'number', 'title', 'en', 'alt', 'nick', 'cat', 'key', 'genre', 'tempo', 'pop', 'variant', 'year', 'pub'];
/* short notes for the piece pages (catalog/about.json) */
const ABOUT = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'about.json'), 'utf8'));
/* Henle's levels of difficulty (catalog/henle.json, from match-henle.js): h, the level, and hn,
   the Henle edition it is graded in, whose page name goes to library/henle.json for the link */
const HENLE_FILE = path.join(ROOT, 'catalog', 'henle.json');
const HENLE = fs.existsSync(HENLE_FILE) ? JSON.parse(fs.readFileSync(HENLE_FILE, 'utf8')) : { levels: {}, editions: {} };
const entries = catalog.entries.map((e) => {
  const o = {};
  for (const k of KEEP) if (e[k] !== undefined && e[k] !== null && !(Array.isArray(e[k]) && !e[k].length)) o[k] = e[k];
  if (ABOUT[e.id]) o.about = ABOUT[e.id];
  if (HENLE.levels[e.id]) [o.h, o.hn] = HENLE.levels[e.id];
  /* must not open through its set's file: that copy is wrong too */
  if (REJECTS.entries[e.id]) o.own = 1;
  const sc = scoreOf.get(e.id);
  if (sc) { o.s = sc.s; o.from = sc.from; if (sc.lic) o.lic = sc.lic; }
  if (BUILTIN[e.id]) o.b = BUILTIN[e.id];
  return o;
});
const composers = catalog.composers.map(({ id, name, full, born, died, names, catalogues }) => ({ id, name, full, born, died, names, catalogues }));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'catalog.json'), JSON.stringify({ built: catalog.built, composers, entries }));
fs.writeFileSync(path.join(OUT, 'henle.json'), JSON.stringify(HENLE.editions || {}));

/* ---------- the search, for the browser (build-search.js) ---------- */
const searchBuild = require('./build-search');
fs.writeFileSync(searchBuild.OUT, searchBuild.build());

const playable = new Set();
const byId = new Map(entries.map((e) => [e.id, e]));
for (const e of entries) if (e.s || e.b) playable.add(e.id);
console.log(`${best.size} scores, ${(bytes / 1e6).toFixed(1)} MB; catalogue ${(fs.statSync(path.join(OUT, 'catalog.json')).size / 1e6).toFixed(2)} MB; ${playable.size} entries open in the player`);
