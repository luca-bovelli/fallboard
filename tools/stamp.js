/* Stamps the deploy copy of dist/index.html with a version: node tools/stamp.js <version>

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
