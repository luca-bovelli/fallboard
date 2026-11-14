/* Pulls each catalogue composer's solo keyboard works from IMSLP into catalog/raw/imslp/<id>.json.

     node tools/catalog/pull-imslp.js            every composer whose raw file is missing
     node tools/catalog/pull-imslp.js chopin ... just these, always

   A work counts when IMSLP files it under "For 1 player" and under piano, keyboard, harpsichord
   or clavichord. Only the page's work-info block (title, alternative titles, catalogue numbers,
   key, movements, dates, instrumentation, tags, Wikidata id) is kept, not its file and recording
   listings, so the raw files stay small enough to commit and the build never needs the network.
   Requests go one at a time with a pause between them. */
'use strict';
const fs = require('fs');
const path = require('path');
const { COMPOSERS } = require('./composers');

const OUT = path.join(__dirname, '..', '..', 'catalog', 'raw', 'imslp');
const API = 'https://imslp.org/api.php?format=json&';
const HEADERS = { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)' };
const SOLO = ['Category:For piano', 'Category:For keyboard', 'Category:For harpsichord', 'Category:For clavichord', 'Category:For 1 player'];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(API + query, { headers: HEADERS });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      await pause(500);
      return body;
    } catch (err) {
      if (attempt >= 4) throw err;
      await pause(2000 * attempt);
    }
  }
}

/* MediaWiki's continuation token, old style (query-continue) or new (continue) */
function nextToken(body, key) {
  const old = body['query-continue'];
  if (old) for (const v of Object.values(old)) if (v[key]) return v[key];
  return body.continue ? body.continue[key] : undefined;
}

async function soloPages(category) {
  const pages = [];
  let token;
  do {
    const body = await api('action=query&generator=categorymembers&gcmnamespace=0&gcmlimit=500&gcmtitle=' +
      encodeURIComponent('Category:' + category) + '&prop=categories&cllimit=max&clcategories=' +
      encodeURIComponent(SOLO.join('|')) + (token ? '&gcmcontinue=' + encodeURIComponent(token) : ''));
    for (const p of Object.values((body.query && body.query.pages) || {})) {
      const cats = (p.categories || []).map((c) => c.title.replace('Category:For ', ''));
      if (cats.includes('1 player') && cats.length > 1) pages.push({ title: p.title, pageid: p.pageid, for: cats.filter((c) => c !== '1 player') });
    }
    token = nextToken(body, 'gcmcontinue');
  } while (token);
  return pages.sort((a, b) => a.title.localeCompare(b.title));
}

/* how many score files and recordings the page has: a rough measure of how much a work is
   played, used to rank search results */
function counts(text) {
  const at = (m) => { const i = text.indexOf(m); return i < 0 ? text.length : i; };
  const files = text.slice(at('*****FILES*****'), at('*****WORK INFO*****'));
  const audio = text.slice(at('*****AUDIO*****'), at('*****FILES*****'));
  const n = (s) => (s.match(/\|File Name \d+=/g) || []).length;
  return { files: n(files), audio: n(audio) };
}

/* the work-info block: from the WORK INFO marker to the comments marker */
function workInfo(text) {
  const from = text.indexOf('*****WORK INFO*****');
  if (from < 0) return '';
  const to = text.indexOf('*****COMMENTS*****', from);
  return text.slice(from + 19, to < 0 ? undefined : to).replace(/\|\s*$/, '').trim();
}

/* 20 pages a request; a response too large for the API leaves some pages without content, and
   those simply come round again in the next batch */
async function fillInfo(pages) {
  for (;;) {
    const batch = pages.filter((p) => p.info === undefined).slice(0, 20);
    if (!batch.length) return;
    const body = await api('action=query&prop=revisions&rvprop=content&titles=' + encodeURIComponent(batch.map((p) => p.title).join('|')));
    let got = 0;
    for (const p of Object.values(body.query.pages)) {
      const page = batch.find((b) => b.pageid === p.pageid || b.title === p.title);
      if (page && p.revisions) { Object.assign(page, counts(p.revisions[0]['*'])); page.info = workInfo(p.revisions[0]['*']); got++; }
    }
    if (!got) throw new Error('no content returned for ' + batch[0].title);
    process.stdout.write('.');
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const asked = process.argv.slice(2);
  for (const c of COMPOSERS) {
    const file = path.join(OUT, c.id + '.json');
    if (asked.length ? !asked.includes(c.id) : fs.existsSync(file)) continue;
    process.stdout.write(c.id + ' ');
    /* IMSLP files the composer's own collections (the Well-Tempered Clavier, say) under a
       "/Collections" category beside the main one; it also holds editors' anthologies, which
       the build drops */
    const pages = await soloPages(c.imslp);
    for (const p of await soloPages(c.imslp + '/Collections')) if (!pages.some((q) => q.pageid === p.pageid)) pages.push({ ...p, collection: true });
    pages.sort((a, b) => a.title.localeCompare(b.title));
    const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).pages : [];
    for (const p of pages) { const old = before.find((q) => q.pageid === p.pageid); if (old && old.files !== undefined) Object.assign(p, { info: old.info, files: old.files, audio: old.audio }); }
    await fillInfo(pages);
    fs.writeFileSync(file, JSON.stringify({ composer: c.imslp, pulled: new Date().toISOString().slice(0, 10), pages }, null, 1) + '\n');
    console.log(' ' + pages.length + ' works');
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
