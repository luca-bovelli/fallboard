/* Builds catalog/catalog.json from the raw pulls, without the network.

     node tools/catalog/build.js

   Sources, in order of trust: IMSLP's work pages (catalog/raw/imslp) for every composer; English
   Wikipedia's lists (catalog/raw/wikipedia) for all 555 Scarlatti sonatas and for Shostakovich;
   catalog/curated.json for what neither has (well-known nicknames, English names of native
   titles, Shostakovich's sets).

   The catalogue is a flat list of entries linked by `parent`:
     set       a collection of independent pieces (Preludes, Op. 28; Kinderszenen)
     work      a single piece or a multi-movement work (Ballade No. 1; Piano Sonata No. 14)
     piece     a member of a set (Prelude in D-flat major, Op. 28 No. 15)
     movement  a part of a work, or of a piece (Sonata No. 14: III. Presto agitato)
   Every entry carries what search needs: title, alt (other titles, native-language and
   translated), nick (nicknames), cat (catalogue numbers, the composer's main catalogue first),
   key, genre, and rights (whether the composition is public domain in the EU and the US). */
'use strict';
const fs = require('fs');
const path = require('path');
const { COMPOSERS } = require('./composers');
const { GENRES, TEMPO, PLURAL } = require('./vocab');

const ROOT = path.join(__dirname, '..', '..');
const RAW = path.join(ROOT, 'catalog', 'raw');
const OUT = path.join(ROOT, 'catalog', 'catalog.json');
const CURATED = path.join(ROOT, 'catalog', 'curated.json');
const THIS_YEAR = new Date().getUTCFullYear();

/* ---------- text ---------- */

const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const squash = (s) => s.replace(/\s+/g, ' ').trim();
const uniq = (list) => [...new Set(list.filter(Boolean))];

/* IMSLP's work-info block as a map of field to raw value; a value runs until the next field */
function fields(info) {
  const out = {};
  let cur = null;
  for (const line of info.split('\n')) {
    const m = line.match(/^\|([A-Za-z][^=|]*?)\s*=(.*)$/);
    if (m) { cur = m[1].trim(); out[cur] = m[2]; } else if (cur) out[cur] += '\n' + line;
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

/* ---------- keys ---------- */

const ACC = { '#': '#', b: 'b', '♯': '#', '♭': 'b', sharp: '#', flat: 'b' };
/* IMSLP's key codes: capital for major, small for minor, "#" sharp and "b" flat ("bb" is B-flat minor) */
function keyFromCode(code) {
  const m = code.trim().match(/^([A-Ga-g])(#|b)?$/);
  if (!m) return null;
  return m[1].toUpperCase() + (m[2] || '') + (m[1] === m[1].toUpperCase() ? ' major' : ' minor');
}
const KEY_TEXT = /\b([A-G])(?:\s*-?\s*(sharp|flat)|([♯♭#b]))?\s+(major|minor)\b/i;
function keyFromText(s) {
  const m = s.match(KEY_TEXT);
  return m ? m[1].toUpperCase() + (ACC[(m[2] || m[3] || '').toLowerCase()] || '') + ' ' + m[4].toLowerCase() : null;
}
/* "Bb minor" as words, the way titles write it: "B-flat minor" */
const keyWords = (k) => k.replace(/^([A-G])#/, '$1-sharp').replace(/^([A-G])b/, '$1-flat');

/* ---------- wiki markup ---------- */

/* one section line or title in plain text, with what it carried: keys, catalogue numbers,
   quoted nicknames, translations (Grieg's <small> lines) and links to other works */
function clean(raw) {
  const all = cleanText(raw);
  /* a section often reads "''Name / Другое имя (translit)''<br>Tempo (key)" or "''Name''. Tempo":
     the name and the tempo are kept apart as well */
  const s = raw.replace(/<score[\s\S]*?<\/score>/g, '');
  const italic = s.match(/^\s*''((?:[^']|'(?!'))+)''\s*[.,:]?\s*([\s\S]*)$/);
  const br = s.split(/<br\s*\/?>/);
  let name = italic ? italic[1] : br.length > 1 ? br[0] : null;
  const rest = italic ? italic[2] : br.length > 1 ? br.slice(1).join(' ') : null;
  if (name !== null) {
    const n = cleanText(name);
    const r = cleanText(rest || '');
    all.name = n.text;
    all.rest = r.text;
    all.nicks = uniq([...all.nicks, ...n.nicks, ...r.nicks]);
    /* links after the name point to other works ("2nd version of No.2 from 3 Sonetti del
       Petrarca"); only the name's own links and numbers belong to this piece */
    all.links = n.links;
    all.cats = [...n.cats, ...(all.own ? [all.own] : [])];
  } else if (all.own) all.cats = [...all.cats, all.own];
  return all;
}
function cleanText(raw) {
  const got = { keys: [], cats: [], nicks: [], trans: [], links: [] };
  let s = raw.replace(/<score[\s\S]*?<\/score>/g, '');
  /* "(= S.161/4)": the piece's own number */
  s = s.replace(/\(\s*=\s*([A-Za-z][^)]*\d[^)]*)\)/g, (_, c) => { got.own = tidyCat(c); return ''; });
  s = s.replace(/[—–-]?\s*(also|often|sometimes|commonly)\s+(known|called|nicknamed)\s+(as\s+)?(['"“‘])([^'"”’]+)['"”’]/gi, (_, a, b, c, q, nick) => { got.nicks.push(nick.trim()); return ''; });
  s = s.replace(/<small>([\s\S]*?)<\/small>/g, (_, t) => {
    if (!/^\s*\(|\{\{/.test(t)) got.trans.push(...t.split('/').map((x) => squash(x.replace(/<[^>]+>|''+/g, ''))).filter((x) => x && x.length < 60));
    return '';
  });
  s = s.replace(/\{\{K6\|([^}]*)\}\}/g, (_, n) => { got.cats.push('K6 ' + n.trim()); return ''; });
  s = s.replace(/\{\{MWV\|([^}]*)\}\}/g, (_, n) => { got.cats.push('MWV ' + n.split('|').join(' ').trim()); return ''; });
  s = s.replace(/\{\{LinkWorkN?\|([^|}]*)\|([^|}]*)[^}]*\}\}/g, (_, t, c) => { got.links.push({ title: t.trim(), cat: c.trim() }); if (c.trim()) got.cats.push(c.trim()); return t; });
  s = s.replace(/(?:\s+in)?\s*\(?\{\{(?:K|Key)\|([^}|]*)\}\}\)?/gi, (_, c) => { const k = keyFromCode(c); if (k) got.keys.push(k); return ''; });
  s = s.replace(/\{\{[^{}]*\}\}/g, '').replace(/\{\{[^{}]*\}\}/g, '');
  s = s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/'''?/g, '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '');
  /* keys written out: "(E major)", "in A minor" */
  s = s.replace(/(?:\s+in)?\s*\(?\b[A-G](?:\s*-?\s*(?:sharp|flat)|[♯♭#b])?\s+(?:major|minor)\b\)?/gi, (m) => { const k = keyFromText(m); if (k) got.keys.push(k); return ''; });
  s = s.replace(/,?\s*\d+\s*bars?\b/g, '').replace(/\(\s*[,;]?\s*\)/g, '');
  /* the whole text quoted is a quoted title, not a nickname */
  const whole = s.trim().match(/^['"‘“](.+)['"’”]$/);
  if (whole && !/['"‘’“”]\s|\s['"‘’“”]/.test(whole[1])) s = whole[1];
  else s = s.replace(/(^|[\s(,])['"‘“]([^'"‘’“”]{3,}?)['"’”](?=$|[\s),.;])/g, (_, pre, nick) => { got.nicks.push(squash(nick)); return pre; });
  /* placeholders say there is no title: "[no tempo indication]", "[Untitled]", "[...]" */
  s = s.replace(/\[\s*(no|untitled|without|ohne|sans|\.+|…)[^\]]*\]/gi, '').replace(/\[|\]/g, '');
  s = squash(s.replace(/\(\s*\)/g, '').replace(/\s+([,.;])/g, '$1')).replace(/^[\s,.;:–—-]+|[\s,;:–—-]+$/g, '');
  s = balance(s).replace(/\s+(in|en|in der|à)$/i, '');
  return { text: s, ...got };
}

/* brackets left unpaired once a key or bar count is cut out ("Adagio sostenuto)") go, and a
   title wholly in brackets ("(Fuga)") loses them */
function balance(s) {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '(') depth++;
    if (ch === ')') { if (!depth) continue; depth--; }
    out += ch;
  }
  while (depth-- > 0) out = out.replace(/\s*\((?!.*\()[^)]*$/, (m) => m.slice(m.indexOf('(') + 1).trim() ? ' ' + m.slice(m.indexOf('(') + 1).trim() : '');
  out = out.trim();
  if (/^\([^()]*\)$/.test(out)) out = out.slice(1, -1).trim();
  return out.replace(/\s+/g, ' ');
}

/* ---------- catalogue numbers ---------- */

/* "Op.27 No.2" -> "Op. 27 No. 2", "LW.A132/1" -> "LW A132/1", "BWV 846-869" -> "BWV 846–869" */
function tidyCat(s) {
  s = squash(s.replace(/\[\[(?:[^\]|]*\|)?([^\]]*)\]\]/g, '$1').replace(/''+/g, ''));
  s = s.replace(/^(LW)\.\s*/, '$1 ').replace(/\b(Op|No|Nos|K|D|S|L|P|B|C|M|R|Hob|Anh|CZ|Kk|Nr)\.\s*(?=\S)/g, '$1. ');
  return s.replace(/(\d)\s*[-–]\s*(\d)/g, '$1–$2');
}
function catalogs(raw) {
  if (!raw) return [];
  const out = [];
  let s = raw.replace(/\{\{K6\|([^}]*)\}\}/g, 'K6 $1').replace(/\{\{MWV\|([^}]*)\}\}/g, (_, n) => 'MWV ' + n.split('|').join(' '))
    .replace(/\{\{[^{}]*\}\}/g, '');
  for (let part of s.split(/;|<br\s*\/?>|\n/)) {
    part = part.trim();
    const paren = part.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    if (paren && /\d/.test(paren[2])) { out.push(tidyCat(paren[1]), tidyCat(paren[2])); continue; }
    if (!part || !/\d/.test(part)) continue;
    /* "BWV 772, 772a" is two numbers in one catalogue */
    const [first, ...more] = part.split(/,\s*(?=\d)/);
    out.push(tidyCat(first));
    const prefix = (tidyCat(first).match(/^([^\d]*?)\s*\d/) || [])[1];
    for (const m of more) out.push(tidyCat((prefix ? prefix + ' ' : '') + m));
  }
  return uniq(out).filter((c) => c.length < 40);
}
/* a catalogue number's parts: "BWV 846–869" -> { prefix: 'BWV', from: 846, to: 869, rest: '' } */
function parseCat(c) {
  const m = c.match(/^(.*?)\s*(\d+)(?:–(\d+))?([a-z]?)(.*)$/);
  if (!m) return null;
  return { prefix: m[1].trim(), from: +m[2], to: m[3] ? +m[3] : +m[2], letter: m[4], rest: m[5].trim() };
}
/* the composer's main catalogue first: Op. for Chopin, BWV for Bach, D. for Schubert */
function orderCats(cats, composer) {
  const rank = (c) => { const i = composer.catalogues.findIndex((p) => c.startsWith(p.replace(/\.$/, ''))); return i < 0 ? 99 : i; };
  return [...cats].sort((a, b) => rank(a) - rank(b));
}
const catKey = (c) => fold(c).replace(/[\s.]/g, '');

/* ---------- genres ---------- */

const GENRE_FORMS = GENRES.map(([name, ...forms]) => ({ name, forms: forms.map(fold) }));
function genreOf(text) {
  if (!text) return null;
  const t = ' ' + fold(text).replace(/[^\p{L}\p{N}' -]+/gu, ' ') + ' ';
  for (const g of GENRE_FORMS) for (const f of g.forms) if (t.includes(' ' + f + ' ')) return g.name;
  return null;
}
const isGenreName = (text) => { const t = fold(text).trim(); return GENRE_FORMS.find((g) => g.forms.includes(t)); };

/* ---------- sections ---------- */

/* the "Number of Movements/Sections" field as a tree: each item { text, number, keys, cats,
   nicks, trans, links, children }; "*" lines head groups, "#:" lines are notes */
function sectionTree(raw) {
  const root = { children: [] };
  const stack = [root];
  let group = root;
  for (const line of (raw || '').split('\n')) {
    let level, text, number;
    const sub = line.match(/\{\{#subitem:([^\n]*)\}\}\s*$/);
    if (sub) {
      const attr = {};
      for (const m of sub[1].matchAll(/(\w+)=((?:\{\{[^}]*\}\}|[^|])*)/g)) attr[m[1]] = m[2];
      level = +attr.level || 1; number = +attr.number || undefined; text = attr.title || '';
      /* an unnumbered bold item heads a part of the list ("Erste Abteilung (für Kleinere)") */
      if (!number && /^\s*'''/.test(text)) { group = { ...clean(text), header: true, children: [] }; root.children.push(group); stack.length = 1; continue; }
      if (group !== root) level = Math.max(1, level - 1);
    } else {
      /* an appendix of other material ends the list of the work's own pieces */
      if (/^[:*#\s]*'*\s*(appendix|anhang|supplement|additional|unpublished|nicht publiziert)/i.test(line)) break;
      /* numbered lines without list markup: ":1. Allegro assai", ":II. Adagio", "3. Presto" */
      const numbered = line.match(/^:?\s*([IVX]+|\d+)[.)]\s+(\S.*)$/);
      if (numbered && !/^[*#]/.test(line)) {
        const item = { ...clean(numbered[2]), number: /\d/.test(numbered[1]) ? +numbered[1] : undefined, children: [] };
        if (item.text || item.keys.length) { group.children.push(item); stack.length = 1; stack[1] = item; }
        continue;
      }
      const m = line.match(/^([*:#]+)\s*(.*)$/);
      if (!m) continue;
      if (/#:/.test(m[1]) || /^:+$/.test(m[1])) continue;
      if (/^\*+$/.test(m[1])) { group = { ...clean(m[2]), header: true, children: [] }; root.children.push(group); stack.length = 1; continue; }
      level = (m[1].match(/#/g) || []).length; text = m[2];
    }
    const item = { ...clean(text), number, children: [] };
    if (!item.text && !item.keys.length && !item.links.length) continue;
    const base = group === root ? 1 : 1;
    stack.length = Math.min(stack.length, level - base + 1);
    const parent = stack.length > 1 ? stack[stack.length - 1] : group;
    parent.children.push(item);
    stack[level - base + 1] = item;
  }
  const number = (list) => list.forEach((it, i) => { if (!it.header && it.number === undefined) it.number = i + 1 - list.slice(0, i).filter((x) => x.header).length; number(it.children); });
  number(root.children);
  return root.children;
}

/* ---------- entries ---------- */

const entries = [];
const byId = new Map();
function slug(s) { return fold(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
const add_ = (e) => add(e);
function add(e) {
  let id = e.id, n = 2;
  while (byId.has(id)) id = e.id + '~' + n++;
  e.id = id;
  byId.set(id, e);
  entries.push(e);
  return e;
}
function entry(props) {
  const e = { id: '', composer: '', kind: 'work', title: '', alt: [], nick: [], cat: [], ...props };
  e.alt = uniq(e.alt).filter((a) => a !== e.title && !isGenreName(a) && !/\{\{|^\(/.test(a));
  e.nick = uniq(e.nick);
  return e;
}
const year = (s) => { const m = (s || '').match(/\b(1[5-9]\d\d)\b/); return m ? +m[1] : undefined; };

/* a page's title without the composer and catalogue: "Polonaise in A-flat major, Op.53 (Chopin,
   Frédéric)" -> "Polonaise in A-flat major" */
function pageTitle(title) {
  let t = title.replace(/\s*\([^()]*\)\s*$/, '');
  const cut = t.search(/,\s*(Op\.|Opp\.|BWV|K\.|KV|D\.|S\.|Hob\.|WoO|Anh\.|L\.|B\.|KK|C\.|CT|M\.|EG|TH|MWV|CD|Kk\.|P\.|CZ\.|LW|R\.|Hess|TN)\s*[A-Z]*\d|,\s*(Op\.|WoO|Anh\.)\s*posth/);
  return squash((cut > 0 ? t.slice(0, cut) : t).replace(/\bNo\.(?=\d)/g, 'No. ').replace(/\bNos\.(?=\d)/g, 'Nos. '));
}

function rights(composer, pub) {
  const eu = composer.died + 70 < THIS_YEAR;
  const usCut = THIS_YEAR - 96; /* 2026: published 1930 or earlier */
  const us = pub ? pub <= usCut : composer.died <= 1900 ? true : null;
  return { eu, us };
}

function fromImslpPage(composer, page) {
  const f = fields(page.info);
  const title = pageTitle(page.title);
  const native = clean(f['Work Title'] || '').text;
  const alt = (f['Alternative Title'] || '').split(';').map((x) => clean(x).text);
  const common = (f['Common Title'] || '').match(/\{\{CommonTitle\|([^}]*)\}\}/);
  const titles = {};
  if (common) for (const pair of common[1].split('|')) { const [lang, t] = pair.split('='); if (t) titles[lang.trim()] = t.trim(); }
  /* IMSLP's common English title names the whole work; a book of it keeps its number
     ("Das wohltemperierte Klavier II" -> "The Well-Tempered Clavier, Book II") */
  const book = (native || title).match(/\s(I{1,3}|IV|V|VI{0,3})$/);
  if (titles.en && book && !titles.en.endsWith(book[1])) titles.en += ', Book ' + book[1];
  const keyField = clean(f.Key || '');
  const head = clean(f['Movements Header'] || '').text;
  const tree = sectionTree(f['Number of Movements/Sections']);
  const pub = year(f['Year of First Publication']);
  const wikidata = ((f.Authorities || '') + (f['External Links'] || '')).match(/\{\{Wikidata\|(Q\d+)\}\}/);
  const wiki = (f['External Links'] || '').match(/\[\[wikipedia:([^|\]]+)\|[^\]]*\]\]|\{\{wp\|([^|}]+)\}\}/);
  const fixed = (curated.catalogue || {})[page.title];
  const cat = fixed ? catalogs(fixed) : orderCats(uniq([...catalogs(f['Opus/Catalogue Number']), ...catalogs((page.title.match(/,\s*((?:Op|BWV|K|D|S|Hob|WoO|Anh|B|L|KK|M|EG|TH|MWV|CD)[^()]*)\(/) || [])[1])]), composer);
  const e = entry({
    id: composer.id + '/' + (cat[0] ? slug(cat[0]) : slug(title)),
    composer: composer.id,
    title,
    en: titles.en && fold(titles.en) !== fold(title) ? titles.en : undefined,
    alt: [native, title, ...alt, ...Object.values(titles)],
    cat,
    key: keyField.keys.length === 1 ? keyField.keys[0] : undefined,
    genre: genreOf(title) || genreOf(native) || genreOf(head) || genreOf(f.Tags) || undefined,
    year: year(f['Year/Date of Composition']),
    pub,
    style: (f['Piece Style'] || '').trim() || undefined,
    rights: rights(composer, pub),
    src: [{ imslp: page.title, ...(wikidata ? { wikidata: wikidata[1] } : {}), ...(wiki ? { wikipedia: (wiki[1] || wiki[2]).trim() } : {}) }],
  });
  /* "24 preludes", "13 pieces": a set; "3 movements": a work (pieces under part headings count) */
  const items = tree.flatMap((t) => (t.header ? t.children.filter((c) => !c.header) : [t]));
  /* "Preludes", "Kinderszenen", or a count ("2 Konzertetüden"): a set of pieces, unless it is a
     sonata, suite, partita, concerto or variations */
  const plural = (PLURAL.test(title) || PLURAL.test(native) || /^\d+\s/.test(title)) && !/sonat|suite|partita|concerto\b|konzert\b|variation|divertiment/i.test(title);
  /* a plural title wins over IMSLP's header: Moments musicaux and Children's Corner are listed as
     "6 movements" but are pieces played on their own */
  const isSet = items.length > 1 && (plural || (head ? !/\b(movements?|sections?|parts?|variations?)\b/i.test(head) : false));
  e.kind = isSet ? 'set' : 'work';
  e.pop = (page.files || 0) + (page.audio || 0);
  if (page.collection) e._collection = true;
  /* "12 German Dances" with no list of its dances: number them, so "D. 420 No. 3" is findable */
  const count = (title.match(/^(\d+)\s/) || [])[1];
  if (!items.length && count && +count > 1 && +count <= 60 && plural) {
    e.kind = 'set';
    e._count = +count;
  }
  /* IMSLP's header gives the count but no list ("8 pieces" for Kreisleriana, "3 movements"):
     numbered pieces or movements, so "Kreisleriana 1" and "op 27 2 3" find something */
  const headCount = /^(\d+)\s+(\w+)/.exec(head || (f['Number of Movements/Sections'] || '').trim());
  if (!items.length && !e._count && headCount && +headCount[1] > 1 && +headCount[1] <= 60 && !/variation|bar|measure|minute/i.test(headCount[2])) {
    e._count = +headCount[1];
    e.kind = /movement|section|part/i.test(headCount[2]) && !plural ? 'work' : 'set';
  }
  e._tree = tree.length > 1 || (tree[0] && tree[0].children.length) ? tree : [];
  if (!e._tree.length && tree[0] && !e.key && tree[0].keys.length === 1) e.key = tree[0].keys[0];
  if (!e._tree.length && tree[0] && tree[0].nicks.length) e.nick.push(...tree[0].nicks);
  /* IMSLP's alternative titles hold most nicknames: "Pathétique", "The Tempest", "Alla Turca" */
  const titleWords = new Set(words(title + ' ' + native));
  for (const a of alt) { const plain = (a || '').replace(/['"“”‘’]/g, ''); const n = plain && usableName(plain) && nickOf(plain, titleWords); if (n) e.nick.push(n); }
  e.nick = uniq(e.nick);
  return e;
}

/* a set's piece or a work's movement from its section item */
function child(parent, item, kind, siblings) {
  const genre = parent.genre;
  const key = item.keys[0];
  let text = item.text;
  /* a link names the piece only when the line is that link and nothing more */
  const link = item.links.find((l) => fold(l.title) === fold(text) || fold(pageTitle(l.title)) === fold(text));
  if (!link && item.links.length && !item.name) item.cats = item.cats.filter((c) => !item.links.some((l) => l.cat === c));
  /* a separate name ("Elégie / Элегия (Elegiya)") gives the title and its other forms */
  const forms = [];
  let tempo;
  if (item.name) {
    for (const part of item.name.split(/\s+\/\s+/)) {
      const paren = part.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      forms.push(...(paren ? [paren[1], paren[2]] : [part]).map((x) => x.trim()).filter(Boolean));
    }
    if (item.rest && TEMPO.test(item.rest)) tempo = item.rest;
    text = forms[0] || text;
  } else {
    /* "La campanella - Allegretto": a name, then its tempo */
    const dash = text.match(/^(.+?)\s+[-–—]\s+(.+)$/);
    if (dash && TEMPO.test(dash[2]) && !TEMPO.test(dash[1])) { text = dash[1]; tempo = dash[2]; }
  }
  const named = text && !TEMPO.test(text) && !/^(no\.?\s*)?\d+$/i.test(text);
  const generic = isGenreName(text);
  let title;
  if (link && link.title) title = pageTitle(link.title);
  else if (kind === 'movement') title = text || (key ? 'Movement in ' + keyWords(key) : 'Movement ' + item.number);
  else if (named && !generic) title = text;
  else title = ((generic && generic.name) || genre || 'Piece') + (key ? ' in ' + keyWords(key) : ' No. ' + item.number);
  if (!tempo && (!named || generic) && text && TEMPO.test(text)) tempo = text;
  /* catalogue: the item's own, then the parent's main number with "No. n", or the matching
     number from a range of the right length (BWV 846–869 has 24 numbers for 24 pieces) */
  const cat = [...item.cats];
  if (kind === 'piece') {
    for (const c of parent.cat) {
      const p = parseCat(c);
      if (!p) continue;
      if (p.to > p.from) { if (p.to - p.from + 1 === siblings && !p.rest) cat.push(p.prefix + (p.prefix ? ' ' : '') + (p.from + item.number - 1)); }
      else if (!/No\./.test(c) && !p.rest) cat.push(c + ' No. ' + item.number);
    }
  }
  return entry({
    id: parent.id + '/' + item.number,
    composer: parent.composer,
    kind,
    parent: parent.id,
    number: item.number,
    title,
    alt: [link ? link.title : '', generic && named ? text : '', ...forms.slice(1), ...item.trans],
    nick: item.nicks,
    cat: orderCats(uniq(cat), COMPOSERS.find((c) => c.id === parent.composer)),
    key,
    tempo,
    genre: (generic && generic.name) || genreOf(title) || (kind === 'piece' ? genre : undefined),
    rights: parent.rights,
  });
}

function expand(e) {
  let tree = e._tree || [];
  delete e._tree;
  if (e._count) tree = Array.from({ length: e._count }, (_, i) => ({ text: '', keys: [], cats: [], nicks: [], trans: [], links: [], number: i + 1, children: [] }));
  delete e._count;
  const walk = (parent, list, kind) => {
    const items = list.filter((t) => !t.header);
    const groups = list.filter((t) => t.header);
    for (const it of items) {
      const c = add(child(parent, it, kind, items.length));
      if (it.children.length) walk(c, it.children, 'movement');
    }
    /* "* Early version" groups list other works and are skipped; other groups only divide the
       list ("Erste Abteilung"), so their pieces join the parent, numbered on from the last */
    let next = items.length ? Math.max(...items.map((it) => it.number || 0)) : 0;
    for (const g of groups) {
      if (/version|edition|arrangement|transcription|appendix|revis|fragment|sketch|alternative/i.test(g.text) && g.children.every((c) => c.links.length)) continue;
      /* a later group listing the same pieces another way ("5 preludes [as in the first
         publication]") is not more pieces */
      if (next && /version|edition|publication|published|arrangement|transcription|revis|alternative|as in|original/i.test(g.text)) continue;
      const kids = g.children.filter((c) => !c.header);
      if (kids.length && kids.every((c, i) => c.number === i + 1) && next) kids.forEach((c) => { c.number = ++next; });
      else if (kids.length) next = Math.max(next, ...kids.map((c) => c.number || 0));
      walk(parent, g.children, kind);
    }
  };
  walk(e, tree, e.kind === 'set' ? 'piece' : 'movement');
}

/* ---------- composers ---------- */

const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const curated = fs.existsSync(CURATED) ? read(CURATED) : {};

function imslpEntries(composer) {
  const file = path.join(RAW, 'imslp', composer.id + '.json');
  if (!fs.existsSync(file)) return [];
  const exclude = new Set(curated.exclude || []);
  const pages = read(file).pages.filter((p) => p.info && !exclude.has(p.title));
  const tops = pages.map((p) => ({ page: p, e: fromImslpPage(composer, p) }));
  /* a collection page stays when it is the composer's own numbered collection (a range in the
     main catalogue, like the Well-Tempered Clavier's BWV 846–869) or adds works no other page
     has; editors' anthologies ("101 Classics") go */
  const main = composer.catalogues.map((c) => fold(c.replace(/\.$/, '')));
  const covered = new Set();
  for (const { page, e } of tops) if (!page.collection) for (const c of e.cat) { const p = parseCat(c); if (p) for (let n = p.from; n <= Math.min(p.to, p.from + 400); n++) covered.add(fold(p.prefix) + n + p.letter); }
  const kept = tops.filter(({ page, e }) => {
    if (!page.collection) return true;
    /* the page must be credited to the composer, not to an editor ("Méthode élémentaire de
       piano, Op.269 (Kullak, ...)"), and numbered in one of the composer's catalogues */
    if (!page.title.endsWith('(' + composer.imslp + ')')) return false;
    const nums = e.cat.map(parseCat).filter((p) => p && main.includes(fold(p.prefix).replace(/\.$/, '')));
    return nums.some((p) => p.to > p.from);
  });
  return kept.map((t) => t.e);
}

function scarlattiEntries(composer, fromImslp) {
  const list = read(path.join(RAW, 'wikipedia', 'scarlatti.json')).sonatas;
  const byK = new Map();
  for (const e of fromImslp) for (const c of e.cat) { const m = c.match(/^K\. (\d+[a-z]?)$/); if (m) byK.set(m[1], e); }
  const out = [];
  const seen = new Set();
  for (const s of list) {
    if (seen.has(s.K)) continue;
    seen.add(s.K);
    const key = keyFromText(s.key.replace('/major', ''));
    const page = byK.get(s.K);
    const cat = ['K. ' + s.K, ...[['L.', s.L], ['P.', s.P], ['CZ.', s.CZ]].filter(([, n]) => n && /\d/.test(n)).map(([p, n]) => p + ' ' + n)];
    out.push(entry({
      id: 'scarlatti/k-' + s.K, composer: 'scarlatti', kind: 'work',
      title: 'Sonata' + (key ? ' in ' + keyWords(key) : ''),
      alt: page ? [page.title, ...page.alt] : [], nick: page ? page.nick : [],
      cat: uniq([...cat, ...(page ? page.cat : [])]), key, tempo: s.tempo || undefined, genre: 'Keyboard Sonata',
      year: page && page.year, pub: page && page.pub, style: 'Baroque', rights: rights(composer, page && page.pub),
      src: page ? page.src : [{ wikipedia: 'List of solo keyboard sonatas by Domenico Scarlatti' }],
    }));
  }
  return out;
}

function shostakovichEntries(composer, fromImslp) {
  const rows = read(path.join(RAW, 'wikipedia', 'shostakovich.json')).works.filter((w) => !/^\s*lost|partially lost|unfinished|incomplete/i.test(w.notes));
  const out = [...fromImslp];
  const have = new Set(fromImslp.flatMap((e) => e.cat.map(catKey)));
  for (const w of rows) {
    const cat = w.op ? ['Op. ' + w.op] : [];
    if (cat.some((c) => have.has(catKey(c)))) continue;
    const title = w.title.replace(/\s*\(.*$/, '');
    out.push(entry({
      id: 'shostakovich/' + (cat[0] ? slug(cat[0]) : slug(title)), composer: 'shostakovich', kind: 'work',
      title, cat, genre: genreOf(title) || undefined, year: year(w.year), pub: undefined, style: '20th Century',
      rights: rights(composer, undefined), src: [{ wikipedia: 'List of compositions by Dmitri Shostakovich' }],
    }));
  }
  return out;
}

/* a page that is one piece of a set on another page (Invention in C major, BWV 772 inside 15
   Inventions, BWV 772–786) joins that piece: its titles, nicknames and movements move over */
function mergeDuplicates(composerId) {
  const mine = entries.filter((e) => e.composer === composerId);
  const childByCat = new Map();
  for (const e of mine) if (e.parent) for (const c of e.cat) if (!childByCat.has(catKey(c))) childByCat.set(catKey(c), e);
  for (const top of mine.filter((e) => !e.parent)) {
    const target = top.cat.length && childByCat.get(catKey(top.cat[0]));
    if (!target || target === top || isAncestor(top, target)) continue;
    target.alt = uniq([...target.alt, top.title, ...top.alt]).filter((a) => a !== target.title);
    target.nick = uniq([...target.nick, ...top.nick]);
    target.cat = uniq([...target.cat, ...top.cat]);
    target.src = [...(target.src || []), ...(top.src || [])];
    for (const k of ['key', 'year', 'pub', 'style']) if (target[k] === undefined && top[k] !== undefined) target[k] = top[k];
    const kids = entries.filter((e) => e.parent === top.id);
    if (!entries.some((e) => e.parent === target.id)) for (const k of kids) reparent(k, target.id);
    else for (const k of kids) removeTree(k);
    remove(top);
  }
}
/* a collection page with a number range and no pieces of its own (15 Inventions, BWV 772–786)
   takes in the pages numbered inside that range as its pieces */
function adoptRanges(composerId) {
  const tops = () => entries.filter((e) => e.composer === composerId && !e.parent);
  for (const s of tops()) {
    if (entries.some((e) => e.parent === s.id)) continue;
    const r = s.cat.map(parseCat).find((p) => p && p.to > p.from && !p.letter && !p.rest);
    if (!r) continue;
    const members = tops().filter((t) => t !== s && t.cat.length).map((t) => ({ t, p: parseCat(t.cat[0]) }))
      .filter(({ p }) => p && p.prefix === r.prefix && !p.letter && !p.rest && p.from === p.to && p.from >= r.from && p.from <= r.to);
    if (members.length < 2) continue;
    s.kind = 'set';
    s.genre = s.genre || genreOf(members[0].t.title);
    for (const { t, p } of members.sort((a, b) => a.p.from - b.p.from)) {
      t.number = p.from - r.from + 1;
      t.kind = 'piece';
      reparent(t, s.id);
    }
  }
}

/* a collection whose pieces are all listed elsewhere already (Inventions and Sinfonias, beside
   15 Inventions and 15 Sinfonias) would show every piece twice */
function dropRepeatedCollections(composerId) {
  for (const s of entries.filter((e) => e.composer === composerId && e._collection && !e.parent)) {
    const kids = entries.filter((k) => k.parent === s.id);
    const elsewhere = (k) => k.cat[0] && entries.some((o) => o !== k && o.composer === composerId && o.parent !== s.id && o.id !== s.id && o.cat.includes(k.cat[0]));
    if (kids.length && kids.filter(elsewhere).length >= kids.length * 0.8) removeTree(s);
  }
}

/* two pages for one work (Toccata in D minor, BWV 913, twice): one entry, with the other's names */
function mergeSameNumber(composerId) {
  const tops = entries.filter((e) => e.composer === composerId && !e.parent && e.cat[0]);
  const byCat = new Map();
  for (const e of tops) { const k = catKey(e.cat[0]); byCat.set(k, [...(byCat.get(k) || []), e]); }
  for (const list of byCat.values()) {
    if (list.length < 2) continue;
    const kidCount = (e) => entries.filter((k) => k.parent === e.id).length;
    const sameWork = list.filter((e) => fold(e.title).replace(/[^a-z]/g, '').slice(0, 6) === fold(list[0].title).replace(/[^a-z]/g, '').slice(0, 6));
    if (sameWork.length < 2) continue;
    sameWork.sort((a, b) => kidCount(b) - kidCount(a) || (b.pop || 0) - (a.pop || 0));
    const [keep, ...rest] = sameWork;
    for (const r of rest) {
      keep.alt = uniq([...keep.alt, r.title, ...r.alt]).filter((a) => a !== keep.title);
      keep.nick = uniq([...keep.nick, ...r.nick]);
      keep.cat = uniq([...keep.cat, ...r.cat]);
      keep.src = [...(keep.src || []), ...(r.src || [])];
      keep.pop = (keep.pop || 0) + (r.pop || 0);
      removeTree(r);
    }
  }
}

/* an early or alternative version (BWV 806a beside BWV 806, K. 204a) is kept but marked, so
   counts skip it and search ranks it after the main version */
function markVariants(composerId) {
  const mine = entries.filter((e) => e.composer === composerId);
  const base = new Set(mine.flatMap((e) => e.cat.map((c) => { const p = parseCat(c); return p && !p.letter ? fold(p.prefix) + p.from + '|' + p.rest : null; })));
  for (const e of mine) {
    const p = e.cat[0] && parseCat(e.cat[0]);
    if (p && p.letter && base.has(fold(p.prefix) + p.from + '|' + p.rest) && !e.cat.some((c) => { const q = parseCat(c); return q && !q.letter && fold(q.prefix) === fold(p.prefix); })) e.variant = true;
  }
}

function isAncestor(a, b) { for (let x = b; x && x.parent; x = byId.get(x.parent)) if (x.parent === a.id) return true; return false; }
function reparent(e, parentId) {
  const old = e.id;
  e.parent = parentId;
  byId.delete(old);
  e.id = parentId + '/' + e.number;
  byId.set(e.id, e);
  for (const k of entries.filter((x) => x.parent === old)) reparent(k, e.id);
}
function remove(e) { entries.splice(entries.indexOf(e), 1); byId.delete(e.id); }
function removeTree(e) { for (const k of entries.filter((x) => x.parent === e.id)) removeTree(k); remove(e); }

/* ---------- Wikidata names ---------- */

const { catSeq } = require('./search');
const seqKey = (s) => (s ? s.name + '|' + s.nums.map((n) => n.replace(/^0+(?=\d)/, '')).join('|') : null);
/* opus numbers written in labels: "Prelude no. 15 in D-flat major, Op. 28", "Op. 25, No. 1",
   "op. 28/15", "Opus 10 Nr. 3" */
function labelSeqs(text) {
  const out = [];
  const m = text.match(/\bop(?:us|\.)?\s*(\d+[a-z]?)(?:\s*[,.]?\s*(?:no|nr|n°|nº)\.?\s*(\d+)|\s*\/\s*(\d+)|\s*:\s*(\d+)\b)?/i);
  if (m) {
    let sub = m[2] || m[3] || m[4];
    if (!sub) { const before = text.slice(0, m.index).match(/\bno\.?\s*(\d+)\b/i); if (before && !/\bno\.?\s*\d+\b/i.test(text.slice(m.index))) sub = before[1]; }
    out.push({ name: 'op', nums: sub ? [m[1], sub] : [m[1]] });
  }
  return out;
}
/* "Songs Without Words, op. 62" -> "Songs Without Words" */
const stripCat = (s) => s.replace(/[,(]?\s*\b(op\.?|opus|bwv|k\.|kv|d\.|s\.|hob\.|woo|l\.|m\.|b\.|mwv|th|cd)\s*[\d][\w.:/ ,–-]*\)?\s*$/i, '').replace(/[\s,]+$/, '').trim();
/* Wikidata often gives a bare number and names the catalogue beside it */
const CATALOG_NAMES = [[/Bach-Werke/i, 'BWV'], [/K[öo]chel/i, 'K.'], [/Kirkpatrick/i, 'K.'], [/Longo/i, 'L.'], [/Pestelli/i, 'P.'], [/Lesure/i, 'L.'],
  [/Marnat/i, 'M.'], [/Deutsch/i, 'D.'], [/Hoboken/i, 'Hob.'], [/Searle/i, 'S.'], [/\bopus\b/i, 'Op.'], [/Mendelssohn/i, 'MWV'], [/Brown/i, 'B.'],
  [/Kobyla/i, 'KK'], [/Chomi/i, 'C.'], [/ohne Opus|WoO/i, 'WoO'], [/Hess/i, 'Hess'], [/Liszt/i, 'LW'], [/Grieg/i, 'EG']];
function prefixed(c) {
  if (!/^\d/.test(c.code.trim())) return c.code;
  const hit = c.catalog && CATALOG_NAMES.find(([re]) => re.test(c.catalog));
  return hit ? hit[1] + ' ' + c.code.trim() : '';
}
/* an alias that is a name, not a library heading ("Preludes, piano, op. 28. No. 15") */
const usableName = (s) => s.length <= 70 && !/\b(piano|pianoforte|klavier|fortepian\w*|clavecin|harpsichord|keyboard|op\.|opus)\b|,\s*no\.|\d{3,}/i.test(s);

function applyWikidata(composer) {
  const file = path.join(RAW, 'wikidata', composer.id + '.json');
  if (!fs.existsSync(file)) return 0;
  const items = read(file).items;
  const mine = entries.filter((e) => e.composer === composer.id);
  /* numbers on both sides; a number shared by several items or entries (Brown 107 is all 24
     preludes) cannot pick one out, so only numbers unique on both sides match */
  const entryBy = new Map();
  for (const e of mine) for (const c of e.cat) { const k = seqKey(catSeq(c)); if (k) entryBy.set(k, entryBy.has(k) && entryBy.get(k) !== e ? null : e); }
  const itemKeys = items.map((it) => uniq([
    ...it.codes.map((c) => seqKey(catSeq(prefixed(c)))),
    ...[...(it.labels.en || []), ...(it.aliases.en || [])].flatMap(labelSeqs).map(seqKey),
  ]));
  const itemCount = new Map();
  for (const ks of itemKeys) for (const k of ks) itemCount.set(k, (itemCount.get(k) || 0) + 1);
  let matched = 0;
  items.forEach((it, i) => {
    const keys = itemKeys[i].filter((k) => itemCount.get(k) === 1 && entryBy.get(k)).sort((a, b) => b.split('|').length - a.split('|').length);
    if (!keys.length) return;
    const e = entryBy.get(keys[0]);
    const wkey = it.key && keyFromText(it.key);
    if (wkey && e.key && wkey !== e.key) return;
    matched++;
    (e.src = e.src || []).push({ wikidata: it.id });
    const own = new Set([e.title, ...e.alt, ...e.nick].map(fold));
    const titleWords = new Set(words(e.title + ' ' + e.alt.join(' ')));
    /* the English label is the English title when the work's own title is in another language
       ("Kinderszenen" -> "Scenes from Childhood"); labels end in catalogue numbers, which go */
    const en = (it.labels.en || []).map(stripCat).find(usableName);
    if (en && !e.en && fold(en) !== fold(e.title) && !/^(prelude|etude|étude|nocturne|waltz|mazurka|polonaise|sonata|piece)s?\b/i.test(en)) e.en = en;
    for (const [lang, list] of Object.entries(it.labels)) for (const l0 of list) { const l = stripCat(l0); if (usableName(l) && !own.has(fold(l))) { e.alt.push(l); own.add(fold(l)); } }
    for (const list of Object.values(it.aliases)) for (const a of list) {
      if (!usableName(a)) continue;
      for (const q of a.matchAll(/['"“‘]([^'"”’]{3,})['"”’]/g)) e.nick.push(q[1]);
      const plain = a.replace(/['"“”‘’]/g, '');
      const nick = e.kind !== 'set' && nickOf(plain, titleWords);
      if (nick) e.nick.push(nick);
      if (!own.has(fold(plain))) { e.alt.push(plain); own.add(fold(plain)); }
    }
    e.alt = uniq(e.alt).filter((a) => a !== e.title);
    e.nick = uniq(e.nick.map((n) => n.trim()).filter((n) => n.length > 2)).filter((n, j, all) => !all.some((m, k) => k !== j && fold(m) === fold(n) && k < j));
  });
  return matched;
}
/* the nickname in another title: what is left without the genre and the key ("Raindrop prelude"
   -> "Raindrop", "Moonlight Sonata" -> "Moonlight"), unless it is part of the work's own title
   already ("Grande valse brillante"), a tempo, or a number */
function nickOf(alias, titleWords) {
  const rest = squash(words(alias).filter((w) => !genreWord(w) && !STOP.test(w)).join(' '));
  if (!rest || rest.split(' ').length > 3 || rest.split(' ').every((w) => titleWords.has(w)) || TEMPO.test(rest) || /\d/.test(alias)) return null;
  if (/\b(vol|book|transcri|arrang|collection|version|edition|heft|cahier|livre|teil|album|selection|works?|werke|oeuvres|stucke|pieces|durch|nach|after|d'apres|d’après|apres)\b/i.test(fold(alias))) return null;
  const nick = alias.replace(KEY_TEXT_ALL, ' ').replace(new RegExp('(^|[\\s-])(' + GENRE_WORDS + ')(?=$|[\\s-])', 'gi'), ' ')
    .replace(/^\s*in\s+(?=[A-Z])/i, '').replace(/\s*-\s*$|^\s*-\s*/g, '').replace(/[\s,;:]+$/, '').replace(/\s+(et|and|und|e|y|&)$/i, '').replace(/\s+/g, ' ').trim();
  return nick.length > 2 ? cap(nick) : null;
}
/* words that are never a nickname on their own: articles, counts, sizes, key words */
const STOP = /^(in|the|a|of|for|major|minor|flat|sharp|dur|moll|[a-h]|no|nr|op|and|et|und|e|y|de|du|la|le|les|des|der|die|das|il|una|un|une|ein|eine|on|sur|uber|grand|grande|grandes|grands|gross|grosse|grosses|petite|petit|petites|kleine|kleiner|kleines|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|deux|trois|quatre|cinq|sept|huit|neuf|dix|onze|douze|vingt|zwei|drei|vier|funf|sechs|sieben|acht|neun|zehn|elf|zwolf|new|nouvelles|nouvelle|neue|complete|selected|easy|leichte|facile|faciles|op|opus|posth|posthumous|pour|for|piano|pianoforte)$/;
const words = (s) => fold(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
const GENRE_WORDS = uniq(GENRE_FORMS.flatMap((g) => g.forms).flatMap((f) => f.split(' '))).filter((w) => w.length > 2).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const GENRE_SET = new Set(GENRE_FORMS.flatMap((g) => g.forms).flatMap((f) => f.split(' ')));
const genreWord = (w) => GENRE_SET.has(w) || /^(etude|study|prelude|nocturne|waltz|valse|polonaise|mazurka|sonata|march|song|dance|piece)s?$/.test(w);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const KEY_TEXT_ALL = /\b(in\s+)?[A-G](?:\s*-?\s*(?:flat|sharp)|[♯♭#b])?\s+(?:major|minor|dur|moll)\b/gi;

/* ---------- curated additions ---------- */

/* a curated entry is named "composer catalogue-number" ("chopin Op. 28 No. 15"), or by id */
function findCurated(ref) {
  if (byId.has(ref)) return byId.get(ref);
  /* "mozart K. 331#3": the "#3" only keeps the key apart from "mozart K. 331"; "movement" picks */
  const [composer, ...rest] = ref.replace(/#\d+$/, '').split(' ');
  const want = seqKey(catSeq(rest.join(' ')));
  const hits = entries.filter((e) => e.composer === composer && e.cat.some((c) => seqKey(catSeq(c)) === want));
  return hits.length ? hits.sort((a, b) => a.cat.length - b.cat.length || (a.parent ? 1 : 0) - (b.parent ? 1 : 0))[0] : null;
}
function applyCurated() {
  for (const add of curated.add || []) {
    const composer = COMPOSERS.find((c) => c.id === add.composer);
    const e = add_(entry({ id: add.composer + '/' + slug(add.cat ? add.cat[0] : add.title), kind: 'work', alt: [], nick: [], cat: [], ...add, rights: rights(composer, add.pub), src: [{ curated: true }] }));
    if (add.pieces) curated.sets = [...(curated.sets || []), { parent: e.id, pieces: add.pieces }];
    delete e.pieces;
  }
  for (const [ref, extra] of Object.entries(curated.entries || {})) {
    let e = findCurated(ref);
    if (e && extra.movement) e = entries.find((x) => x.parent === e.id && x.number === extra.movement) || null;
    if (!e) { console.warn('curated: no entry ' + ref); continue; }
    if (extra.en && fold(extra.en) !== fold(e.title)) e.en = extra.en;
    if (extra.title) { e.alt = uniq([e.title, ...e.alt]); e.title = extra.title; }
    e.alt = uniq([...e.alt, ...(extra.alt || [])]).filter((a) => a !== e.title && !(extra.drop || []).includes(a));
    /* hand-written nicknames come first: they are the ones shown */
    e.nick = uniq([...(extra.nick || []), ...e.nick.filter((n) => !(extra.drop || []).includes(n))]);
  }
  for (const set of curated.sets || []) {
    const parent = findCurated(set.parent);
    if (!parent) { console.warn('curated: no set ' + set.parent); continue; }
    if (entries.some((e) => e.parent === parent.id)) continue;
    parent.kind = 'set';
    set.pieces.forEach((p, i) => {
      const item = { text: p.title || '', keys: p.key ? [p.key] : [], cats: [], nicks: p.nick || [], trans: p.alt || [], links: [], number: i + 1, children: [] };
      const c = add(child(parent, item, 'piece', set.pieces.length));
      if (p.movements) p.movements.forEach((m, j) => add(child(c, { text: m.title || '', keys: m.key ? [m.key] : [], cats: [], nicks: [], trans: [], links: [], number: j + 1, children: [] }, 'movement', p.movements.length)));
    });
  }
}

/* ---------- main ---------- */

function main() {
  for (const composer of COMPOSERS) {
    let tops = imslpEntries(composer);
    if (composer.id === 'scarlatti') tops = scarlattiEntries(composer, tops);
    if (composer.id === 'shostakovich') tops = shostakovichEntries(composer, tops);
    for (const e of tops) { const t = e._tree; add(e); e._tree = t; }
    for (const e of tops) expand(e);
    mergeDuplicates(composer.id);
    adoptRanges(composer.id);
    markVariants(composer.id);
    /* a collection page whose pieces all went to another collection (Inventions and Sinfonias,
       once 15 Inventions and 15 Sinfonias hold them) has nothing left to offer */
    for (const e of entries.filter((x) => x.composer === composer.id && x._collection && !x.parent)) if (!entries.some((k) => k.parent === e.id)) remove(e);
    dropRepeatedCollections(composer.id);
    mergeSameNumber(composer.id);
    composer._wikidata = applyWikidata(composer);
  }
  console.log('Wikidata items matched: ' + COMPOSERS.map((c) => c.id + ' ' + c._wikidata).join(', '));
  applyCurated();

  /* children in order after their parents, parents by catalogue */
  const kids = new Map();
  for (const e of entries) { const k = e.parent || ''; if (!kids.has(k)) kids.set(k, []); kids.get(k).push(e); }
  const ordered = [];
  const natural = (a, b) => (a.cat[0] || a.title).localeCompare(b.cat[0] || b.title, 'en', { numeric: true });
  const put = (e) => { ordered.push(e); for (const k of (kids.get(e.id) || []).sort((a, b) => a.number - b.number)) put(k); };
  for (const c of COMPOSERS) for (const e of (kids.get('') || []).filter((x) => x.composer === c.id).sort(natural)) put(e);

  const clean = ordered.map((e) => {
    const o = {};
    for (const [k, v] of Object.entries(e)) if (v !== undefined && !(Array.isArray(v) && !v.length) && !k.startsWith('_')) o[k] = v;
    return o;
  });
  const out = {
    built: new Date().toISOString().slice(0, 10),
    sources: ['IMSLP (imslp.org) work pages', 'English Wikipedia: List of solo keyboard sonatas by Domenico Scarlatti; List of compositions by Dmitri Shostakovich', 'catalog/curated.json'],
    composers: COMPOSERS.map(({ imslp, ...c }) => c),
    entries: clean,
  };
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0).replace(/\},\{"id"/g, '},\n{"id"') + '\n');
  report(clean);
}

/* pieces as the composers' worklists count them: a set's pieces, and each work whole */
function report(list) {
  const kidsOf = new Map();
  for (const e of list) if (e.parent) kidsOf.set(e.parent, (kidsOf.get(e.parent) || 0) + 1);
  console.log('composer        entries  pieces  movements');
  let total = 0;
  for (const c of COMPOSERS) {
    const mine = list.filter((e) => e.composer === c.id);
    const pieces = mine.filter((e) => !e.variant && (e.kind === 'piece' || (e.kind === 'work' && !(e.parent && byId.get(e.parent).kind === 'work')))).length;
    total += pieces;
    console.log(c.id.padEnd(16) + String(mine.length).padStart(7) + String(pieces).padStart(8) + String(mine.filter((e) => e.kind === 'movement').length).padStart(11));
  }
  console.log('total pieces', total, ' entries', list.length);
}

main();
