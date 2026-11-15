/* Matches PDMX's MuseScore files to catalogue entries, into .data/pdmx/matches.json.

     node tools/catalog/match-pdmx.js

   Needs .data/pdmx/PDMX.csv (PDMX v9, zenodo.org/records/15571083). A file is a candidate when it
   is by one of the catalogue's composers, for piano or harpsichord alone, and its title does not
   mark it as an arrangement, a simplification or an excerpt. Its title and subtitle are read as a
   catalogue search; the match is kept when the search is sure:
     number   the title's catalogue numbers matched (and its key, if it gave one)
     title    every word of the title matched, including a title or nickname word, and no other
              piece matched as well
   Each entry keeps its best few files, ranked by MuseScore's "official" mark, ratings, favourites
   and views. Nothing is downloaded here; extract-pdmx.js fetches the chosen files. */
'use strict';
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { create, fold } = require('./search');
const { COMPOSERS } = require('./composers');

const ROOT = path.join(__dirname, '..', '..');
const CSV = path.join(ROOT, '.data', 'pdmx', 'PDMX.csv');
const OUT = path.join(ROOT, '.data', 'pdmx', 'matches.json');
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const search = create(catalog);
const byId = new Map(catalog.entries.map((e) => [e.id, e]));

/* UTF-8 read as Latin-1 somewhere upstream: "Dâ\x99\xad major" is "D♭ major" */
const unmangle = (s) => (s || '').replace(/[âÃ][\u0080-¿]{1,2}/g, (m) => { try { const t = Buffer.from(m, 'latin1').toString('utf8'); return /�/.test(t) ? m : t; } catch (e) { return m; } });
/* the surnames in other scripts, which titles from Russia, Japan and China use */
const SCRIPT = {
  bach: /бах|バッハ|巴赫/, beethoven: /бетховен|ベートー[ヴベ]ェ?ン|贝多芬|貝多芬/, mozart: /моцарт|モーツァルト|莫扎特|莫札特/, chopin: /шопен|ショパン|肖邦|蕭邦/,
  liszt: /лист[^ь]|リスト|李斯特/, schubert: /шуберт|シューベルト|舒伯特/, schumann: /шуман|シューマン|舒曼/, brahms: /брамс|ブラームス|勃拉姆斯|布拉姆斯/,
  debussy: /дебюсси|ドビュッシー|德彪西|德布西/, rachmaninoff: /рахманинов|ラフマニノフ|拉赫玛尼诺夫|拉赫曼尼诺夫/, scriabin: /скрябин|スクリャービン|斯克里亚宾/,
  ravel: /равель|ラヴェル|ラベル|拉威尔|拉威爾/, grieg: /григ|グリーグ|格里格/, prokofiev: /прокофьев|プロコフィエフ|普罗科菲耶夫/, scarlatti: /скарлатти|スカルラッティ|斯卡拉蒂/,
  haydn: /гайдн|ハイドン|海顿|海頓/, mendelssohn: /мендельсон|メンデルスゾーン|门德尔松|孟德爾頌/, tchaikovsky: /чайковск|チャイコフスキー|柴可夫斯基/, shostakovich: /шостакович|ショスタコーヴィチ|肖斯塔科维奇/,
};
/* the surnames as people write them, and the relatives who share them */
const WHO = [
  ['bach', /\bbach\b/, /c\.?\s?p\.?\s?e|carl philipp|johann christian|j\.?\s?c\.? bach|wilhelm friedemann|w\.?\s?f\.? bach|p\.?\s?d\.?\s?q|anna magdalena/],
  ['beethoven', /\bbee?tho(v|f)en\b/],
  ['mozart', /\bmozart\b/, /leopold|franz xaver/],
  ['chopin', /\bchopin\b|\bszopen\b/],
  ['liszt', /\bliszt\b/],
  ['schubert', /\bschubert\b/],
  ['schumann', /\bschuman+\b/, /clara/],
  ['brahms', /\bbrahms\b/],
  ['debussy', /\bdebussy\b/],
  ['rachmaninoff', /\br[ae]c?h?k?h?maninof+\b|\br[ae]c?h?k?h?maninov\b|\brachmaninow\b/],
  ['scriabin', /\bs(c|k)r[iy]a?bine?\b|\bskrjabin\b/],
  ['ravel', /\bravel\b/],
  ['grieg', /\bgrieg\b/],
  ['prokofiev', /\bprokofi?e?(v|ff|w)\b|\bprokofjew\b/],
  ['scarlatti', /\bscarlatti\b/, /alessandro/],
  ['haydn', /\bhaydn\b/, /michael/],
  ['mendelssohn', /\bmendels+ohn\b/, /fanny|hensel/],
  ['tchaikovsky', /\b(t|ts)?ch?aik?ov?sk(y|i|ij)\b|\btschaikowsky\b|\btchaikowsky\b/],
  ['shostakovich', /\bs(h|ch)ostakovi(t)?ch\b|\bschostakowitsch\b|\bchostakovitch\b/],
];
const NOT_ORIGINAL = /\b(easy|easier|simplif|simple version|beginner|arr\.?|arranged|arrangement|transcri(pt|bed)|reduction|duet|4 hands|four hands|piano 4|2 pianos|two pianos|orchestra|guitar|violin|cello|flute|organ|choir|vocal|voice|ukulele|harp\b|synthesia|cover|medley|remix|lo-?fi|jazz|rock|metal|theme from|excerpt|short version|abridged|fragment|intro\b|right hand|left hand|only|part 1|exercise|practice|accompaniment|backing|karaoke|anime|game|undertale|minecraft|trio|quartet|quintet|symphon(y|ie)|twist|style of|in the style|reimagined|variation on|remake|parody|mashup|chord reduction|comparative|analysis|transposed|clarinet|oboe|bassoon|trumpet|horn|sax(ophone)?|viola|strings|ensemble|band|marimba|xylophone|music box|8-?bit|chiptune)\b/;
/* words in titles that say nothing about which piece it is */
const NOISE = /\b(piano|pianoforte|solo|for|sheet|music|score|full|complete|original|musescore|version|edition|urtext|with|fingering|fingerings|pedal|pedals|by|composed|composer|famous|beautiful|classical|the|in|op\.?\s*$)\b/g;

function split(line) {
  const out = [];
  let i = 0;
  while (i <= line.length) {
    if (line[i] === '"') {
      let v = '';
      i++;
      for (;;) {
        const q = line.indexOf('"', i);
        if (q < 0) { v += line.slice(i); i = line.length; break; }
        v += line.slice(i, q);
        if (line[q + 1] === '"') { v += '"'; i = q + 2; } else { i = q + 1; break; }
      }
      out.push(v);
      i++;
    } else {
      const c = line.indexOf(',', i);
      if (c < 0) { out.push(line.slice(i)); break; }
      out.push(line.slice(i, c));
      i = c + 1;
    }
  }
  return out;
}

function composerOf(r) {
  const own = fold([r.composer_name, r.artist_name].join(' '));
  const all = fold([r.composer_name, r.artist_name, r.title, r.subtitle, r.song_name].join(' '));
  for (const [id, re, not] of WHO) if (re.test(own) && !(not && not.test(own))) return id;
  for (const [id, re, not] of WHO) if (re.test(all) && !(not && not.test(all))) return id;
  for (const [id, re] of Object.entries(SCRIPT)) if (re.test(all)) return id;
  return null;
}

function quality(r) {
  const n = (k) => +r[k] || 0;
  return (r.is_official === 'True' ? 60 : 0) + Math.min(n('n_ratings'), 30) * Math.max(0, n('rating') - 3) * 2 +
    10 * Math.log10(1 + n('n_views')) + 8 * Math.log10(1 + n('n_favorites')) + (r['subset:deduplicated'] === 'True' ? 5 : 0);
}

/* the title read as a catalogue search, with the composer's name in front so only their works match */
function matchOf(r, composer) {
  const comp = COMPOSERS.find((c) => c.id === composer);
  let text = fold([r.title, r.subtitle].filter((x) => x && x !== 'NA').join(' '));
  for (const n of [comp.name, comp.full, ...comp.names]) text = text.split(fold(n)).join(' ');
  for (const [, re] of WHO) text = text.replace(new RegExp(re.source, 'g'), ' ');
  for (const re of Object.values(SCRIPT)) text = text.replace(new RegExp(re.source, 'g'), ' ');
  /* tuning and sound notes: "(A = 415 Hz)", "harpsichord sound" */
  text = text.replace(/\(?\s*a\s*=\s*\d+\s*hz\s*\)?/g, ' ').replace(/\b\d+\s*hz\b/g, ' ').replace(/\b(harpsichord|piano|organ) sound\b/g, ' ');
  text = text.replace(/[()[\]{}|/\\_–—-]+/g, ' ').replace(NOISE, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const res = search.find(comp.name + ' ' + text, 3);
  const top = res[0];
  if (!top || top.entry.composer !== composer) return null;
  const w = top.why;
  const related = (a, b) => a.id.startsWith(b.id + '/') || b.id.startsWith(a.id + '/');
  const rival = res.slice(1).find((x) => !related(x.entry, top.entry) && x.score >= top.score - 6);
  let found = null;
  /* a catalogue number found it; bare numbers ("Waltz No.2") are not enough without a name */
  if (w.groups > 0 && (w.named > 0 || w.key || /\b(op|opus|bwv|kv?|d|s|hob|woo|l|m|b|kk|mwv|th|cd)\.?\s*\d/.test(text))) found = 'number';
  /* by title alone: every word matched, and two distinctive words or a nickname ("Round",
     "Arietta" or "Air by Haydn" alone match too much) */
  else if (w.words && w.matched === w.words && (w.named >= 2 || w.nicked > 0) && !rival) found = 'title';
  if (!found) return null;
  return { entry: movementOf(top.entry, text) || top.entry, how: found, query: text };
}

/* a file of one movement belongs to the movement: "Movement I", "1- Allemande" */
function movementOf(work, text) {
  const kids = catalog.entries.filter((e) => e.parent === work.id && e.kind === 'movement');
  if (!kids.length) return null;
  const n = (text.match(/\b(?:movement|mvt|mvmt|satz|mouvement)\s*([ivx]+|\d+)\b|\b(\d)(?:st|nd|rd|th)\s+(?:movement|mvt)\b/) || []).slice(1).find(Boolean);
  if (n) { const num = /^\d+$/.test(n) ? +n : { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8 }[n]; const k = kids.find((x) => x.number === num); if (k) return k; }
  /* a movement named in the title by a word of its own ("allemande", "presto agitato") */
  const words = new Set(fold(text).split(/[^\p{L}]+/u).filter((x) => x.length >= 4));
  const scored = kids.map((k) => ({ k, hits: fold(k.title).split(/[^\p{L}]+/u).filter((x) => x.length >= 4 && words.has(x)).length })).filter((x) => x.hits).sort((a, b) => b.hits - a.hits);
  return scored.length && (scored.length === 1 || scored[0].hits > scored[1].hits) ? scored[0].k : null;
}

async function main() {
  const rl = readline.createInterface({ input: fs.createReadStream(CSV, { encoding: 'utf8', highWaterMark: 1 << 20 }), crlfDelay: Infinity });
  let head = null, pending = '', rows = 0, kept = 0, matched = 0;
  const by = new Map();
  const unmatched = [];
  const why = { composer: 0, instrument: 0, arrangement: 0, unmatched: 0 };
  for await (const line of rl) {
    /* a quoted field can span lines: gather until the quotes balance */
    pending = pending ? pending + '\n' + line : line;
    if ((pending.match(/"/g) || []).length % 2) continue;
    const raw = pending;
    pending = '';
    if (!head) { head = split(raw); continue; }
    rows++;
    /* cheap test first: does the row mention a composer at all? */
    if (!/bach|bee?tho|mozart|chopin|szopen|liszt|schubert|schuman|brahms|debussy|maninov|maninof|maninow|scriabin|skrjabin|skryabin|ravel|grieg|prokof|scarlatti|haydn|mendels|aikovsk|aikowsk|stakovi|stakowi/i.test(raw) &&
      !Object.values(SCRIPT).some((re) => re.test(raw.toLowerCase()))) { why.composer++; continue; }
    const v = split(raw);
    const r = {};
    head.forEach((h, i) => { r[h] = unmangle(v[i]); });
    const composer = composerOf(r);
    if (!composer) { why.composer++; continue; }
    const programs = (r.tracks || '').split('-').map(Number);
    if (!(+r.n_tracks >= 1 && +r.n_tracks <= 2 && programs.length && programs.every((p) => p >= 0 && p <= 7))) { why.instrument++; continue; }
    if (NOT_ORIGINAL.test(fold([r.title, r.subtitle, r.tags].join(' ')))) { why.arrangement++; continue; }
    if (r.mxl === 'NA' || !r.mxl) continue;
    kept++;
    const m = matchOf(r, composer);
    if (!m) { why.unmatched++; unmatched.push(composer + ' | ' + r.title + (r.subtitle && r.subtitle !== 'NA' ? ' | ' + r.subtitle : '')); continue; }
    matched++;
    const list = by.get(m.entry.id) || [];
    list.push({
      mxl: r.mxl.replace(/^\.\//, ''), title: r.title, subtitle: r.subtitle === 'NA' ? undefined : r.subtitle, how: m.how,
      quality: Math.round(quality(r)), official: r.is_official === 'True', rating: +r.rating || 0, ratings: +r.n_ratings || 0,
      views: +r.n_views || 0, favourites: +r.n_favorites || 0, license: r.license, licenseConflict: r.license_conflict === 'True',
      bars: +r['song_length.bars'] || undefined, seconds: Math.round(+r['song_length.seconds'] || 0) || undefined,
    });
    by.set(m.entry.id, list);
    if (rows % 50000 === 0) process.stdout.write('.');
  }
  const out = {};
  for (const [id, list] of by) out[id] = list.sort((a, b) => b.quality - a.quality).slice(0, 5);
  fs.writeFileSync(OUT, JSON.stringify({ built: new Date().toISOString().slice(0, 10), source: 'PDMX v9 (zenodo.org/records/15571083)', matches: out }, null, 1));
  /* the candidates no piece was found for, to improve the reading of titles */
  fs.writeFileSync(path.join(path.dirname(OUT), 'unmatched.txt'), unmatched.sort().join('\n') + '\n');
  console.log(`\n${rows} rows; ${kept} solo keyboard files by these composers; ${matched} matched to ${by.size} entries`);
  console.log('left out:', JSON.stringify(why));
  report(out);
}

/* coverage the way the catalogue counts pieces: a piece is covered by its own file, or by a file
   of the work it belongs to (a sonata's file covers its movements) */
function report(out) {
  const has = (e) => { for (let x = e; x; x = x.parent && byId.get(x.parent)) if (out[x.id]) return out[x.id]; return null; };
  const kids = new Set(catalog.entries.filter((e) => e.parent).map((e) => e.parent));
  console.log('composer        pieces  with a file  by its own file  by number');
  let tp = 0, tc = 0;
  for (const c of COMPOSERS) {
    const pieces = catalog.entries.filter((e) => e.composer === c.id && !e.variant && (e.kind === 'piece' || (e.kind === 'work' && !(e.parent && byId.get(e.parent).kind === 'work'))));
    const covered = pieces.filter(has);
    const own = pieces.filter((e) => out[e.id] || (kids.has(e.id) && catalog.entries.some((k) => k.parent === e.id && out[k.id])));
    const num = pieces.filter((e) => (has(e) || []).some((f) => f.how === 'number'));
    tp += pieces.length; tc += covered.length;
    console.log(c.id.padEnd(16) + String(pieces.length).padStart(6) + String(covered.length).padStart(13) + String(own.length).padStart(17) + String(num.length).padStart(11));
  }
  console.log(`total: ${tc} of ${tp} pieces have at least one file`);
}

main().catch((e) => { console.error(e); process.exit(1); });
