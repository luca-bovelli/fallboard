/* Fills the two gaps IMSLP leaves, from English Wikipedia's work lists, into catalog/raw/wikipedia/.

     node tools/catalog/pull-wikipedia.js

   scarlatti.json     all 555 sonatas (IMSLP has a page for only some of them): K, L, P and CZ
                      numbers, key and tempo, from "List of solo keyboard sonatas by Domenico Scarlatti"
   shostakovich.json  the solo piano works (IMSLP has few, since they are still in copyright in
                      Canada): opus, title and year, from the chronological table of "List of
                      compositions by Dmitri Shostakovich", rows whose instrumentation is "Piano"

   Only these facts are saved, not the articles' text. */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', '..', 'catalog', 'raw', 'wikipedia');
const HEADERS = { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)' };

async function wikitext(page) {
  const url = 'https://en.wikipedia.org/w/api.php?action=parse&format=json&formatversion=2&prop=wikitext|revid&redirects=1&page=' + encodeURIComponent(page);
  const body = await (await fetch(url, { headers: HEADERS })).json();
  if (!body.parse) throw new Error('no page ' + page);
  return { text: body.parse.wikitext, revid: body.parse.revid };
}

/* wiki markup to plain text: links keep their label, templates for sharps and flats become signs,
   references, footnotes and other templates go */
function plain(s) {
  return s
    .replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
    .replace(/\{\{music\|(flat|b)\}\}/gi, '♭').replace(/\{\{music\|(sharp|#)\}\}/gi, '♯').replace(/\{\{music\|natural\}\}/gi, '♮')
    .replace(/\{\{(sfn|efn|refn|nbsp)[^{}]*\}\}/gi, '')
    .replace(/\{\{ill\|([^|}]+)[^}]*\}\}/g, '$1')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/'''?/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

/* the rows of the first wikitable after `from`, each as its cells' raw text */
function tableRows(text, from = 0) {
  const start = text.indexOf('{|', from);
  const end = text.indexOf('\n|}', start);
  const rows = [];
  for (const chunk of text.slice(start, end).split(/\n\|-[^\n]*/).slice(1)) {
    const cells = [];
    for (const line of chunk.split('\n')) {
      if (/^\s*!/.test(line) || /^\s*\|\+/.test(line)) { cells.length = 0; cells.header = true; break; }
      if (/^\s*\|/.test(line)) cells.push(...line.replace(/^\s*\|/, '').split('||').map((c) => c.replace(/^[^|[{]*?\|(?!\|)/, (m) => (/=/.test(m) ? '' : m)).trim()));
      else if (cells.length) cells[cells.length - 1] += '\n' + line;
    }
    if (!cells.header && cells.length) rows.push(cells);
  }
  return rows;
}

async function scarlatti() {
  const { text, revid } = await wikitext('List of solo keyboard sonatas by Domenico Scarlatti');
  const sonatas = tableRows(text).map((c) => ({ K: plain(c[0]), L: plain(c[1]), P: plain(c[2]), CZ: plain(c[3]), key: plain(c[4]), tempo: plain(c[5]) }))
    .filter((s) => /^\d+[a-z]?$/.test(s.K));
  return { source: 'https://en.wikipedia.org/wiki/List_of_solo_keyboard_sonatas_by_Domenico_Scarlatti', revid, sonatas };
}

async function shostakovich() {
  const { text, revid } = await wikitext('List of compositions by Dmitri Shostakovich');
  const rows = tableRows(text, text.indexOf('==In chronological order=='));
  const works = rows.filter((c) => plain(c[2] || '') === 'Piano')
    .map((c) => ({ op: plain(c[0]), title: plain(c[1]), year: plain(c[3] || ''), notes: plain(c[4] || '') }));
  return { source: 'https://en.wikipedia.org/wiki/List_of_compositions_by_Dmitri_Shostakovich', revid, works };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [name, pull] of [['scarlatti', scarlatti], ['shostakovich', shostakovich]]) {
    const data = await pull();
    fs.writeFileSync(path.join(OUT, name + '.json'), JSON.stringify(data, null, 1) + '\n');
    console.log(name, (data.sonatas || data.works).length);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
