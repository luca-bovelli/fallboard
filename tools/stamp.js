/* Stamps the deploy copy of dist/index.html, and dist/sw.js, with a version: node tools/stamp.js <version>

   GitHub Pages lets browsers keep files for 10 minutes, so after a deploy a returning visitor
   could mix new and old scripts. The workflow runs this on its own checkout (never committed):
   every script URL gets ?v=<version>, and window.FB_VERSION lets app.js do the same for the
   score files it fetches. Without it (local preview, other hosts) nothing is stamped. */
'use strict';
const fs = require('fs');
const path = require('path');

const v = String(process.argv[2] || '').replace(/[^\w.-]/g, '').slice(0, 12);
if (!v) {
  console.error('usage: node tools/stamp.js <version>');
  process.exit(1);
}
const file = path.join(__dirname, '..', 'dist', 'index.html');
let html = fs.readFileSync(file, 'utf8');
let n = 0;
html = html.replace(/<script src="(js\/[\w.-]+\.js)"><\/script>/g, (all, src) => { n++; return `<script src="${src}?v=${v}"></script>`; });
if (!n) {
  console.error('no script tags found in dist/index.html');
  process.exit(1);
}
html = html.replace(/<script src="js\//, `<script>window.FB_VERSION = '${v}';</script>\n$&`);
fs.writeFileSync(file, html);
console.log(`stamped ${n} scripts with ${v}`);

/* the service worker (dist/sw.js): this version, and what it keeps the moment it is installed:
   the page, every script as the page asks for it, the piano's samples, the covers' self-hosted
   face, the small icons. The engraving engine (17 MB) and the scores are kept as they are first
   used */
const dist = path.join(__dirname, '..', 'dist'), swFile = path.join(dist, 'sw.js');
const list = (dir, ext) => fs.readdirSync(path.join(dist, dir)).filter((x) => x.endsWith(ext)).map((x) => dir + '/' + x);
const keep = ['./', 'manifest.webmanifest', ...list('js', '.js').map((x) => x + '?v=' + v), ...list('samples', '.mp3'), ...list('fonts/nyght', '.woff2'),
  'icons/favicon-16.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png', 'icons/icon-192.png'];
let sw = fs.readFileSync(swFile, 'utf8');
if (!sw.includes("const VERSION = 'dev';") || !sw.includes('const PRECACHE = [];')) {
  console.error('dist/sw.js has no VERSION or PRECACHE to stamp');
  process.exit(1);
}
sw = sw.split("const VERSION = 'dev';").join(`const VERSION = '${v}';`).split('const PRECACHE = [];').join(`const PRECACHE = ${JSON.stringify(keep)};`);
fs.writeFileSync(swFile, sw);
console.log(`stamped the service worker: ${keep.length} files kept`);
