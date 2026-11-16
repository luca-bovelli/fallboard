/* The catalogue search for the browser: dist/js/catalog.js, vocab.js as a global, then search.js.

     node tools/catalog/build-search.js            write it (publish.js does this too)
     node tools/catalog/build-search.js --check    fail if it differs from its sources (the tests) */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'dist', 'js', 'catalog.js');
function build() {
  const vocab = fs.readFileSync(path.join(__dirname, 'vocab.js'), 'utf8').replace(/^'use strict';\s*$/m, '').replace(/module\.exports\s*=\s*/, 'self.CatalogVocab = ');
  const search = fs.readFileSync(path.join(__dirname, 'search.js'), 'utf8');
  return '/* Built by tools/catalog/publish.js from tools/catalog/vocab.js and search.js: do not edit. */\n(function () {\n\'use strict\';\n' + vocab + '\n})();\n' + search;
}
module.exports = { build, OUT };

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === build();
    if (!same) { console.error('dist/js/catalog.js is out of date: run node tools/catalog/build-search.js'); process.exit(1); }
    console.log('dist/js/catalog.js matches its sources');
  } else {
    fs.writeFileSync(OUT, build());
    console.log('wrote dist/js/catalog.js');
  }
}
