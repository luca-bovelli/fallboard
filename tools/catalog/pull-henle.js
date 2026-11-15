/* Pulls the G. Henle Verlag's levels of difficulty for piano solo: 1 to 9, graded by Rolf Koenen
   per piece (a sonata movement, a piece in a cycle). Each edition's page in the Henle shop lists
   its pieces, each with its level.

     node tools/catalog/pull-henle.js          resumable; about one page a second

   The editions come from the shop's sitemap (robots.txt allows product pages), less those whose
   names say they are for other instruments, and the study scores (HN 9000 on), which repeat the
   main editions. Each page is boiled down to its edition, composer, instrumentation and pieces
   in .data/henle/hn/ (git-ignored), so a stopped run carries on where it left off; the piano solo
   editions' pieces go to catalog/raw/henle.json, which match-henle.js joins to the catalogue. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CACHE = path.join(ROOT, '.data', 'henle');
const PAGES = path.join(CACHE, 'hn');
const OUT = path.join(ROOT, 'catalog', 'raw', 'henle.json');
const UA = 'Mozilla/5.0 (compatible; fallboard-catalogue/1.0)';
const SITEMAP = 'https://www.henle.de/sitemap/salesChannel-0cb0024164614b6294ee03320d7f6070-2fbb5fe2e29a4d70aa5854ce7ce3e20b/0cb0024164614b6294ee03320d7f6070-sitemap-www-henle-de-en-1.xml.gz';
const GAP = 1200;   // ms between requests
const NOT_PIANO = /violin|viola|violoncello|cello|flute|oboe|clarinet|bassoon|horn|trumpet|trombone|guitar|harp(?!sichord)|organ|string|quartet|quintet|trio|sextet|septet|octet|nonet|song|lieder|voice|vocal|choir|chor|concert(o|ino)|duo|four-hands|4-hands|two-pianos|2-pianos|mandolin|saxophone|bass|gamba|recorder|symphon|serenade-for|divertimento|orchestra|wind|ensemble|sinfonia-concertante|mass|requiem|opera|aria|duets?/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function get(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (res.ok) return res;
    if (res.status === 404) return null;
    await sleep(30000 * (i + 1));   // too many requests, or the server is busy: back off
  }
  throw new Error('gave up on ' + url);
}

const text = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;/g, "'")
  .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();
/* an edition's page: its title, composer, instrumentation, and its pieces with their levels,
   under the headings that group them ("4 Impromptus op. 90 D 899") */
function parse(html, url) {
  const meta = (p) => ((html.match(new RegExp('<meta\\s+property="' + p + '"\\s+content="([^"]*)"')) || [])[1] || '');
  const edition = text((html.match(/<title[^>]*>([^<]*)</) || [])[1] || '').replace(/\s*\|.*$/, '');
  const props = [...html.matchAll(/class="product-detail-properties-container">\s*<span>([^<]*)<\/span>/g)].map((m) => text(m[1]));
  const pieces = [];
  const start = html.indexOf('cms-element-title-works');
  if (start >= 0) {
    const end = html.indexOf('cms-section ', start + 100);
    const chunks = html.slice(start, end > 0 ? end : start + 400000).split('<div class="mws-henle-work ').slice(1);
    let group = '';
    for (const c of chunks) {
      if (c.startsWith('is-header')) continue;
      const t = c.match(/mws-henle-work--title( bold)?\s*">([\s\S]*?)<\/div>/);
      if (!t) continue;
      const title = text(t[2]);
      const grade = c.match(/mws-henle-work--grade-numeric">\s*(\d)\s*</);
      const abrsm = (text(c).match(/ABRSM: ([^]*?)(?:$)/) || [])[1];
      if (t[1] && !grade) { group = title; continue; }
      pieces.push({ title, level: grade ? +grade[1] : null, group: group || undefined, abrsm: abrsm || undefined });
    }
  }
  return { hn: +url.match(/HN-(\d+)$/)[1], url, edition, composer: meta('product:brand'), props, pieces };
}

(async () => {
  fs.mkdirSync(PAGES, { recursive: true });
  const map = path.join(CACHE, 'sitemap-en.xml');
  if (!fs.existsSync(map)) {
    const res = await get(SITEMAP);
    fs.writeFileSync(map, require('zlib').gunzipSync(Buffer.from(await res.arrayBuffer())));
  }
  const urls = [...fs.readFileSync(map, 'utf8').matchAll(/<loc>([^<]*\/HN-(\d+))<\/loc>/g)]
    .filter((m) => +m[2] < 9000 && !NOT_PIANO.test(m[1].split('/en/')[1])).map((m) => m[1]);
  let fetched = 0;
  for (const [i, url] of urls.entries()) {
    const file = path.join(PAGES, 'HN-' + url.match(/HN-(\d+)$/)[1] + '.json');
    if (fs.existsSync(file)) continue;
    const res = await get(url);
    const page = res ? parse(await res.text(), url) : { hn: +url.match(/HN-(\d+)$/)[1], url, missing: true };
    fs.writeFileSync(file, JSON.stringify(page));
    fetched++;
    if (fetched % 25 === 0) console.log(`${i + 1}/${urls.length} pages (${fetched} fetched this run)`);
    await sleep(GAP);
  }
  /* the piano solo editions' pieces, for the catalogue */
  const editions = fs.readdirSync(PAGES).map((f) => JSON.parse(fs.readFileSync(path.join(PAGES, f), 'utf8')))
    .filter((p) => !p.missing && p.props.some((x) => /^piano solo$/i.test(x)) && p.pieces.some((x) => x.level))
    .sort((a, b) => a.hn - b.hn)
    .map(({ hn, url, edition, composer, pieces }) => ({ hn, url, edition, composer, pieces }));
  fs.writeFileSync(OUT, JSON.stringify({ source: 'G. Henle Verlag, levels of difficulty (Rolf Koenen), from henle.de', pulled: new Date().toISOString().slice(0, 10), editions }, null, 1) + '\n');
  const n = editions.reduce((s, e) => s + e.pieces.filter((p) => p.level).length, 0);
  console.log(`done: ${editions.length} piano solo editions, ${n} pieces with a level -> catalog/raw/henle.json`);
})().catch((err) => { console.error(err); process.exit(1); });
