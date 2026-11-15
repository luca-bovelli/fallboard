/* Matches the ASAP dataset's scores to catalogue entries and fetches them into .data/asap/.

     node tools/catalog/match-asap.js

   ASAP (github.com/fosfrancesco/asap-dataset, CC BY-NC-SA 4.0) holds 235 MusicXML scores of
   piano repertoire, checked against recorded performances. Titles there read "Fugue_bwv_846",
   "Ballade_1" or "Sonata_14_1st_mvt": each is read as a catalogue search with its composer, and
   kept when its catalogue numbers match, or every word matches with no rival piece. The files
   go through the same repairs and checks as every other source (check-scores.js). */
'use strict';
const fs = require('fs');
const path = require('path');
const { create } = require('./search');
const { movementOf } = require('./movement');

const ROOT = path.join(__dirname, '..', '..');
const DIR = path.join(ROOT, '.data', 'asap');
const RAW = 'https://raw.githubusercontent.com/fosfrancesco/asap-dataset/master/';
const HEADERS = { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)' };
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const search = create(catalog);

/* ASAP names sonata movements by the sonata's number in its series and the movement:
   "Piano_Sonatas_27-1" is Beethoven's Sonata No. 27, first movement; Haydn's numbers are
   Hob. XVI, Schubert's are D. numbers; "Sonata_2_3rd" is the third movement. The movement is
   found by its number, not by search, which would read "27 1" as a catalogue pair. */
function readTitle(composer, title) {
  let m = /^(?:Piano|Keyboard)_Sonatas_(\d+)-(\d+)/.exec(title);
  if (m) {
    if (composer === 'Haydn') return { words: `Hob XVI:${m[1]}`, movement: +m[2] };
    if (composer === 'Schubert') return { words: `D ${m[1]}`, movement: +m[2] };
    return { words: `piano sonata no ${m[1]}`, sonata: +m[1], movement: +m[2] };
  }
  m = /^Sonata_(\d+)_(\d)(?:st|nd|rd|th)$/.exec(title);
  if (m) return { words: `piano sonata no ${m[1]}`, sonata: +m[1], movement: +m[2] };
  m = /^(Polonaises|Scherzos)_(\d+)$/.exec(title);
  if (m) return { words: `${m[1].replace(/s$/, '')} op ${m[2]}` };
  /* "Prelude_bwv_870": the pair is found by its number, the half by its word */
  m = /^(Prelude|Fugue)_bwv_(\d+)$/.exec(title);
  if (m) return { words: `bwv ${m[2]}`, half: m[1] };
  m = /^Transcendental_Etudes_(\d+)$/.exec(title);
  if (m) return { words: `S 139 no ${m[1]}` };
  return { words: SAME[composer + ' ' + title] || title.replace(/_/g, ' ') };
}
/* titles the search cannot place alone */
const SAME = {
  'Liszt Sonata': 'sonata b minor',
  'Liszt Annees_de_pelerinage_2_1_Gondoliera': 'S 162 no 1',
  'Liszt Gran_Etudes_de_Paganini_2_La_campanella': 'S 141 no 3',
  'Liszt Mephisto_Waltz': 'S 514',
  'Schumann Toccata_repeat': 'toccata op 7',
};
/* "Piano Sonata No. 22" by title: a search for "sonata no 22" also finds Op. 22 */
const sonataNo = (composer, n) => {
  const re = new RegExp('^Piano Sonata No\\. ' + n + '(?!\\d)');
  const hits = catalog.entries.filter((e) => e.composer === composer && e.kind === 'work' && !e.variant && re.test(e.title));
  return hits.length === 1 ? hits[0] : null;
};

async function main() {
  fs.mkdirSync(DIR, { recursive: true });
  const csv = path.join(DIR, 'metadata.csv');
  if (!fs.existsSync(csv)) fs.writeFileSync(csv, await (await fetch(RAW + 'metadata.csv', { headers: HEADERS })).text());
  const rows = fs.readFileSync(csv, 'utf8').trim().split('\n').slice(1).map((l) => l.split(','));
  const scores = new Map();
  for (const r of rows) if (!scores.has(r[3])) scores.set(r[3], { composer: r[0], title: r[1], file: r[3] });
  const matches = {};
  let found = 0;
  const missed = [];
  for (const s of scores.values()) {
    const { words, movement, sonata, half } = readTitle(s.composer, s.title);
    let res = search.find(s.composer + ' ' + words, 3);
    const byNo = sonata && sonataNo(s.composer.toLowerCase(), sonata);
    /* "bwv 875" also finds a set listing "BWV 875/a-76" among others; the piece numbered
       exactly so is the one */
    const cat = /^bwv (\d+)$/.exec(words);
    const byCat = cat && catalog.entries.filter((e) => e.composer === 'bach' && !e.variant && e.kind !== 'set' && (e.cat || []).includes('BWV ' + cat[1]));
    if (byNo) res = [{ entry: byNo, score: 100, why: { groups: 1, words: 0, matched: 0, named: 0 } }];
    else if (byCat && byCat.length === 1) res = [{ entry: byCat[0], score: 100, why: { groups: 1, words: 0, matched: 0, named: 0 } }];
    const top = res[0] && { ...res[0] };
    if (top && movement) {
      const mv = catalog.entries.find((e) => e.parent === top.entry.id && e.kind === 'movement' && e.number === movement);
      if (mv) top.entry = mv;
    } else if (top && half) {
      const mv = movementOf(catalog, top.entry, half);
      if (mv) top.entry = mv;
    }
    const w = top && top.why;
    /* ASAP is curated, so a title whose every word matches and that no other piece matches as well
       is enough ("Barcarolle", "Toccata") */
    const related = (x, y) => x.id.startsWith(y.id + '/') || y.id.startsWith(x.id + '/');
    const rival = top && res.slice(1).find((x) => !related(x.entry, top.entry) && x.score >= top.score - 6);
    const ok = top && top.entry.composer === s.composer.toLowerCase() && (w.groups > 0 || (w.words && w.matched === w.words && (w.named > 0 || !rival)));
    if (!ok) { missed.push(s.composer + ' ' + s.title); continue; }
    const local = path.join(DIR, s.file);
    if (!fs.existsSync(local)) {
      const res2 = await fetch(RAW + s.file.split('/').map(encodeURIComponent).join('/'), { headers: HEADERS });
      if (!res2.ok) { missed.push(s.file + ' (HTTP ' + res2.status + ')'); continue; }
      fs.mkdirSync(path.dirname(local), { recursive: true });
      fs.writeFileSync(local, await res2.text());
      await new Promise((r) => setTimeout(r, 150));
    }
    (matches[top.entry.id] = matches[top.entry.id] || []).push({ mxl: s.file, title: s.title.replace(/_/g, ' '), how: w.groups > 0 ? 'number' : 'title', quality: 80, source: 'asap', license: 'CC BY-NC-SA 4.0' });
    found++;
  }
  fs.writeFileSync(path.join(DIR, 'matches.json'), JSON.stringify({ built: new Date().toISOString().slice(0, 10), source: 'ASAP dataset (github.com/fosfrancesco/asap-dataset), CC BY-NC-SA 4.0', matches }, null, 1));
  console.log(`${found} of ${scores.size} ASAP scores matched to ${Object.keys(matches).length} entries`);
  if (missed.length) console.log('not matched: ' + missed.join(' | '));
}

main().catch((e) => { console.error(e); process.exit(1); });
