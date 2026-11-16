/* Joins Henle's levels of difficulty (catalog/raw/henle.json, from pull-henle.js) to the catalogue.

     node tools/catalog/match-henle.js        -> catalog/henle.json
     node tools/catalog/match-henle.js -v     and every piece it could not place

   catalog/henle.json: { levels: { <entry id>: [level, HN number] }, editions: { HN number: the
   page's name on henle.de } }, which publish.js puts in the app.

   Henle names a piece by its title, key and catalogue numbers: "Etude a minor op. 10,2",
   "Toccata f sharp minor BWV 910", "Impromptu c minor op. 90,1 D 899". Each is looked up with the
   catalogue search by its composer, key and numbers, and the best of the first five results whose
   catalogue number matches one of Henle's exactly is taken (so "op. 10" never lands on "Op. 10
   No. 2"); pieces the catalogue does not have are left out. In
   anthologies each piece starts with its composer's name ("Wolfgang Amadeus Mozart Minuet K. 1e").
   A set or a sonata Henle grades as a whole ("12 Waltzes op. 18 D 145", "Piano Sonata C major
   K. 279") passes its level on to its pieces and movements that have none of their own. Where
   editions disagree on a piece, the level given most often wins, then the higher. */
'use strict';
const fs = require('fs');
const path = require('path');
const { create, catSeq, fold } = require('./search');

const ROOT = path.join(__dirname, '..', '..');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'raw', 'henle.json'), 'utf8'));
const verbose = process.argv.includes('-v');
const search = create(catalog);
const byId = new Map(catalog.entries.map((e) => [e.id, e]));
const kids = new Map();
for (const e of catalog.entries) if (e.parent) { if (!kids.has(e.parent)) kids.set(e.parent, []); kids.get(e.parent).push(e); }

/* the composer: named at the start of the title (anthologies), or the edition's ("Schubert_Franz") */
function composerOf(brand, title) {
  for (const c of catalog.composers) if (title.startsWith(c.full + ' ')) return { c, title: title.slice(c.full.length + 1) };
  const sur = fold(brand.split('_')[0]);
  const c = catalog.composers.find((x) => fold(x.name) === sur || fold(x.full).split(' ').pop() === sur || (x.names || []).some((n) => fold(n) === sur));
  return { c, title };
}
/* Henle's title as a query: its key and catalogue numbers ("op. 90,1" is Op. 90 No. 1; "op. post."
   is an opus; numbers in brackets are older catalogues', "K. 279 (189d)") */
const CAT = /\b(op\.|bwv|kk|kv?\.?|d\.?|hob\.|woo|hwv|l\.|s\.|sz|bb|th|m\.|fp|wq|h\.|lw)\s*[\dIVX]/i;
const KEY = /\b[A-Ga-g]( sharp| flat)? (major|minor)\b/;
const norm = (s) => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();
function query(name, title) {
  let t = title.replace(/\bop\.\s*post\.\s*/gi, 'op. ').replace(/\([^)]*\)/g, ' ').replace(/(\d+[a-z]?)\s*,\s*(\d+)/g, '$1 no $2');
  const key = (t.match(/\b([A-Ga-g])( sharp| flat)? (major|minor)\b/) || [''])[0];
  const at = t.search(CAT);
  if (at < 0) return null;
  return { q: name + ' ' + key + ' ' + t.slice(at), groups: search.parse(t.slice(at)).groups.filter((g) => g.name) };
}
/* Kobylańska's catalogue of Chopin's works without opus, written many ways ("KK IVa,13" at Henle;
   "KK IVa: No. 5", "KK IVc/13", "KK.VIIb/7–8" in the catalogue): as one token, "iva-13" */
const KK = /\bKK\.?\s*(Anh\.?\s*)?([IVX]+[a-c]?)\s*[:/,]?\s*(?:No\.\s*)?(\d+)/i;
const kkOf = (s) => { const m = s && s.match(KK); return m ? (m[1] ? 'anh-' : '') + m[2].toLowerCase() + '-' + m[3] : null; };
/* does one of the entry's catalogue numbers equal one of the query's, all its numbers */
const num = (n) => String(n).replace(/^0+(?=\d)/, '');
function exact(e, groups) {
  const seqs = (e.cat || []).map(catSeq).filter(Boolean);
  return groups.some((g) => seqs.some((s) => s.name === g.name && s.nums.length === g.nums.length && s.nums.every((n, i) => num(n) === num(g.nums[i]))));
}

const found = new Map();   // id -> [[level, hn], ...]
const missed = [];
const byTitle = [];   // placed by title alone, for checking by eye (-v)
let tried = 0;
for (const ed of raw.editions) {
  for (const p of ed.pieces) {
    if (!p.level) continue;
    tried++;
    const { c, title } = composerOf(ed.composer, p.title);
    const q = c && query(c.name, title);
    let hit = null;
    const kk = c && c.id === 'chopin' && kkOf(title);
    if (kk) {
      const same = catalog.entries.filter((e) => e.composer === 'chopin' && (e.cat || []).some((x) => kkOf(x) === kk));
      if (same.length === 1) hit = same[0];
    }
    if (!hit && !kk && q && q.groups.length) {
      for (const text of [q.q, q.q.replace(/\b[A-Ga-g]( sharp| flat)? (major|minor)\b/, '')]) {
        /* the best result whose number is exactly Henle's (the search may rank "K. 1f" above "K. 1e") */
        const top = search.find(text, 5).find((r) => r.entry.composer === c.id && exact(r.entry, q.groups));
        if (top) { hit = top.entry; break; }
      }
    }
    /* no catalogue number to go by ("Jimbo's Lullaby", "Il Penseroso", "Warum? op. 12 Heft 1"):
       the title, with its key and numbers, then with its key, then alone, taken only when a word
       that is not just a genre matched, two thirds of the words matched, and the entry found is
       well ahead of the next ("Waltz a minor" fits three of Chopin's, so it is left out) */
    if (!hit && c && !kk && !(q && q.groups.length)) {
      /* the title before any catalogue number: words in a number ("KK IVa") would match an
         entry's other names and count as a name */
      const cut = title.search(CAT);
      const t = (cut >= 0 ? title.slice(0, cut) : title).replace(/\([^)]*\)/g, ' ').replace(/\bop\.\s*post\.?\s*/gi, 'op. ').replace(/["“”„]/g, ' ');
      const keyless = t.replace(KEY, ' ');
      /* Henle's key, which the entry must have when it has one on record */
      const hk = (t.match(KEY) || [])[0];
      const want = hk && search.parse(hk).key;
      const keyOk = (e) => !want || !e.key || e.key === want.tonic + ' ' + want.mode;
      /* the title alone, as a name: an entry called exactly that wins ("Clair de lune" is the
         movement of the Suite bergamasque, not "La terrasse des audiences du clair de lune") */
      const name = norm(keyless.replace(/\b(no|nr)\.?\s*\d+/gi, ' ').replace(/\bop\.?\s*\d+.*$/i, ' ').replace(/^appendix:\s*/i, ''));
      for (const text of [t, t.replace(/\d+/g, ' '), keyless.replace(/\d+/g, ' ')]) {
        const res = search.find(c.name + ' ' + text, 5).filter((r) => r.entry.composer === c.id);
        const named = res.filter((r) => keyOk(r.entry) && [r.entry.title, r.entry.en, ...(r.entry.alt || []), ...(r.entry.nick || [])].some((x) => x && norm(x) === name));
        const [top, next] = res;
        const w = top && top.why;
        if (named.length === 1) hit = named[0].entry;
        else if (top && keyOk(top.entry) && (!want || w.key) && w.named >= 1 && w.words && w.matched * 3 >= w.words * 2 && (!next || top.score - next.score >= 15)) hit = top.entry;
        /* a year in Henle's title ("Images (1894)") must be the entry's, or its work's: "Images
           (1894)" are the Images oubliées, not the Images of 1901 */
        const year = +((p.title.match(/\((1[5-9]\d\d)\)/) || [])[1] || 0);
        const its = hit && (hit.year || (byId.get(hit.parent) || {}).year);
        if (hit && year && its && Math.abs(its - year) > 1) hit = null;
        if (hit) { byTitle.push(`${p.title} -> ${search.label(hit)}`); break; }
      }
    }
    if (hit) { if (!found.has(hit.id)) found.set(hit.id, []); found.get(hit.id).push([p.level, ed.hn]); }
    else missed.push(`${(c && c.name) || ed.composer}: ${p.title} (HN ${ed.hn})`);
  }
}

/* one level per entry: the most frequent, then the higher; the edition is the first that gives it */
const levels = {};
for (const [id, list] of found) {
  const count = new Map();
  for (const [l] of list) count.set(l, (count.get(l) || 0) + 1);
  const level = [...count].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
  levels[id] = [level, list.find(([l]) => l === level)[1]];
}
/* a set or sonata graded whole lends its level to its parts */
let lent = 0;
const lend = (id, lv) => { for (const k of kids.get(id) || []) { if (!levels[k.id]) { levels[k.id] = lv; lent++; } lend(k.id, levels[k.id]); } };
for (const id of Object.keys(levels)) lend(id, levels[id]);

const editions = {};
for (const ed of raw.editions) editions[ed.hn] = ed.url.split('/en/')[1].replace(/\/HN-\d+$/, '');
const sorted = Object.fromEntries(Object.entries(levels).sort(([a], [b]) => (a < b ? -1 : 1)));
fs.writeFileSync(path.join(ROOT, 'catalog', 'henle.json'), JSON.stringify({ source: raw.source, pulled: raw.pulled, levels: sorted, editions }, null, 0).replace(/\],"/g, '],\n"') + '\n');

const pieces = catalog.entries.filter((e) => !kids.has(e.id) && e.kind !== 'set');
const withLevel = pieces.filter((e) => levels[e.id]).length;
console.log(`${found.size} entries graded from ${tried - missed.length} of ${tried} Henle pieces; ${lent} parts take their set's level`);
console.log(`${withLevel} of ${pieces.length} catalogue pieces now have a level`);
console.log(`${new Set(byTitle).size} placed by title alone`);
if (verbose) {
  for (const m of new Set(byTitle)) console.log('  by title: ' + m);
  for (const m of missed) console.log('  not placed: ' + m);
}
