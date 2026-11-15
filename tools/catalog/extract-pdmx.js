/* Fetches the matched PDMX files into .data/pdmx/mxl/, without keeping the 1.9 GB archive.

     node tools/catalog/extract-pdmx.js [top]      the best <top> files of each entry (default 2)

   PDMX's mxl.tar.gz is streamed from Zenodo through gunzip and a small tar reader; only the files
   named in .data/pdmx/matches.json are written. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const https = require('https');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, '.data', 'pdmx');
const URL = 'https://zenodo.org/api/records/15571083/files/mxl.tar.gz/content';
const top = +process.argv[2] || 2;

const { matches } = JSON.parse(fs.readFileSync(path.join(DATA, 'matches.json'), 'utf8'));
const want = new Set();
for (const list of Object.values(matches)) for (const f of list.slice(0, top)) want.add(f.mxl.replace(/^\.?\//, ''));
const missing = [...want].filter((p) => !fs.existsSync(path.join(DATA, p)));
console.log(`${want.size} files wanted, ${missing.length} not yet here`);
if (!missing.length) process.exit(0);
const need = new Set(missing);

function get(url, cb) {
  https.get(url, { headers: { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)' } }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) return get(new URL(res.headers.location, url).href, cb);
    if (res.statusCode !== 200) { console.error('HTTP ' + res.statusCode); process.exit(1); }
    cb(res);
  }).on('error', (e) => { console.error(e); process.exit(1); });
}

/* tar: 512-byte headers, each followed by its data rounded up to 512 bytes. A GNU long-name
   entry ('L') carries the next entry's name as its data. */
let buf = Buffer.alloc(0), cur = null, left = 0, pad = 0, got = 0, seen = 0, bytes = 0, longName = null;
const t0 = Date.now();
function done(entry) {
  const data = Buffer.concat(entry.parts);
  if (entry.kind === 'name') { longName = data.toString('utf8').replace(/\0.*$/s, ''); return; }
  fs.mkdirSync(path.dirname(entry.out), { recursive: true });
  fs.writeFileSync(entry.out, data);
  got++;
  need.delete(entry.name);
}
function feed(chunk) {
  buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
  for (;;) {
    if (left > 0) {
      const n = Math.min(left, buf.length);
      if (cur) cur.parts.push(buf.subarray(0, n));
      buf = buf.subarray(n); left -= n;
      if (left > 0) return;
      if (cur) done(cur);
      cur = null;
      continue;
    }
    if (pad > 0) { const n = Math.min(pad, buf.length); buf = buf.subarray(n); pad -= n; if (pad > 0) return; continue; }
    if (buf.length < 512) return;
    const h = buf.subarray(0, 512);
    buf = buf.subarray(512);
    if (h.every((b) => b === 0)) continue;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const name = (longName || ((str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100))).replace(/^\.?\//, '').replace(/^PDMX\//, '');
    longName = null;
    left = size; pad = (512 - (size % 512)) % 512;
    if (type === 'L') cur = { kind: 'name', parts: [] };
    else if (type === '0' || type === '\0') { seen++; cur = need.has(name) ? { kind: 'file', name, parts: [], out: path.join(DATA, name) } : null; }
    else cur = null;
  }
}

get(URL, (res) => {
  const total = +res.headers['content-length'] || 0;
  res.on('data', (c) => { bytes += c.length; });
  const gz = res.pipe(zlib.createGunzip());
  let last = 0;
  gz.on('data', (c) => {
    feed(c);
    if (Date.now() - last > 15000) { last = Date.now(); console.log(`${(bytes / 1e6).toFixed(0)} of ${(total / 1e6).toFixed(0)} MB read, ${got} files kept`); }
    if (!need.size) { console.log(`all ${got} files kept after ${(bytes / 1e6).toFixed(0)} MB, ${((Date.now() - t0) / 1000).toFixed(0)} s`); process.exit(0); }
  });
  gz.on('end', () => { console.log(`${got} files kept, ${need.size} not found in the archive (${seen} entries read)`); process.exit(0); });
});
