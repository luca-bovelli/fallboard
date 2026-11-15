/* The list of scores still needed from IMSLP: catalog/requests/imslp-needed.csv and .json.

     node tools/catalog/imslp-requests.js

   A piece is still needed when no source gave it a usable file (.data/checks.json, verdict not
   "reject", on the piece or on the work or set it belongs to). Pieces are grouped by the IMSLP
   page that holds them, since one download usually covers a whole set or work. For each page
   the files IMSLP lists are read through its API (descriptions only, nothing is downloaded) to
   suggest what to download: an engraving source (MusicXML, MuseScore, LilyPond) first, then a
   typeset edition, then a clean scan of a complete edition. Rows are ordered by how much the
   pieces are played. */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'catalog', 'requests');
const CACHE = path.join(ROOT, '.data', 'imslp-files.json');
const HEADERS = { 'User-Agent': 'catalog-builder/0.1 (personal, non-commercial)' };
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const byId = new Map(catalog.entries.map((e) => [e.id, e]));
const checks = JSON.parse(fs.readFileSync(path.join(ROOT, '.data', 'checks.json'), 'utf8'));
const label = require('./search').create(catalog).label;

/* ---------- what is covered ---------- */
const usable = new Set(checks.filter((c) => c.verdict !== 'reject').map((c) => c.id));
const covered = (e) => { for (let x = e; x; x = x.parent && byId.get(x.parent)) if (usable.has(x.id)) return true; return false; };
/* a movement is covered when its work is; a work with movements needs every movement, and when
   some have files only the rest are asked for */
const kidsOf = new Map();
for (const e of catalog.entries) if (e.parent) { if (!kidsOf.has(e.parent)) kidsOf.set(e.parent, []); kidsOf.get(e.parent).push(e); }
const pieces = catalog.entries.filter((e) => !e.variant && (e.kind === 'piece' || (e.kind === 'work' && !(e.parent && byId.get(e.parent).kind === 'work'))));
const missing = [];
for (const e of pieces) {
  if (covered(e)) continue;
  const mv = (kidsOf.get(e.id) || []).filter((k) => k.kind === 'movement');
  const have = mv.filter((k) => usable.has(k.id));
  if (mv.length && have.length === mv.length) continue;
  e._lacking = have.length ? mv.filter((k) => !usable.has(k.id)) : null;
  missing.push(e);
}
const pageOf = (e) => { for (let x = e; x; x = x.parent && byId.get(x.parent)) { const s = (x.src || []).find((v) => v.imslp); if (s) return { page: s.imslp, holder: x }; } return null; };
const composerOf = (id) => catalog.composers.find((c) => c.id === id);

/* ---------- the files each page lists ---------- */
const PUBLISHERS = /breitkopf|henle|peters|schirmer|bärenreiter|barenreiter|wiener urtext|universal edition|durand|augener|steingräber|steingraber|schott|simrock|ricordi|jurgenson|gutheil|belaieff|paderewski|mikuli|kistner|hofmeister/i;
/* {{P|Breitkopf und Härtel|...|Leipzig|1878|...}}: publisher, place and year */
const untemplate = (s) => s.replace(/\{\{P\|([^|}]*)\|[^|}]*\|([^|}]*)\|([^|}]*)[^}]*\}\}/g, '$1, $2 $3').replace(/\{\{FE\}\}/g, 'first edition').replace(/\{\{[^}]*\}\}|\[\[|\]\]/g, '').replace(/\[(?:https?|mailto):\S+\s*([^\]]*)\]/g, '$1').replace(/<br\s*\/?>/g, ' ').replace(/''/g, '').replace(/\s+/g, ' ').replace(/ ,/g, ',').trim();
const ROMAN = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10 };
/* the piece numbers a file description names: "Nos.1-12", "No.3: Trällerliedchen", "Nos.4, 6",
   "3. Allegro", "Movement II" */
function numbersIn(desc) {
  const out = new Set();
  for (const m of desc.matchAll(/\bNos?\.?\s*(\d+)\s*(?:-|–|to)\s*(\d+)/gi)) for (let n = +m[1]; n <= +m[2] && n - m[1] < 60; n++) out.add(n);
  for (const m of desc.matchAll(/\bNos?\.?\s*(\d+(?:\s*(?:,|&|and)\s*\d+)*)/gi)) for (const n of m[1].split(/\D+/)) if (n) out.add(+n);
  const lead = /^\s*(\d+|[IVX]+)\.\s/.exec(desc) || /\b(?:movement|mvt\.?)\s*(\d+|[IVX]+)\b/i.exec(desc);
  if (lead) out.add(/^\d+$/.test(lead[1]) ? +lead[1] : ROMAN[lead[1].toLowerCase()]);
  return out;
}
/* each upload on the page (one {{#fte:imslpfile}}: one edition, maybe in several files), with
   the section it sits in. "Complete" holds whole editions, "Selections" single pieces,
   "Arrangements and Transcriptions" other instruments */
function uploadsOf(block) {
  const heads = [...block.matchAll(/^(={2,})\s*([^=\n]+?)\s*\1\s*$/gm)].map((m) => ({ at: m.index, level: m[1].length, text: m[2] }));
  const ups = [];
  for (const m of block.matchAll(/\{\{#fte:imslpfile([\s\S]*?)\n\}\}/g)) {
    const t = m[1];
    const field = (k) => ((new RegExp('\\|' + k + '=([^\\n]*)')).exec(t) || [])[1] || '';
    const files = [...t.matchAll(/\|File Name (\d+)=([^\n]+)/g)].map((x) => {
      const name = x[2].trim();
      const desc = untemplate(((new RegExp('\\|File Description ' + x[1] + '=([^\\n]*)')).exec(t) || [])[1] || '');
      const source = /\.(mxl|xml|musicxml|mscz|mscx|ly|zip)$/i.test(name) || /engraving files?|musicxml|musescore|lilypond/i.test(desc);
      return { name, desc, source };
    }).filter((f) => !/\.brf$/i.test(f.name) && !/braille/i.test(f.desc)); /* braille editions */
    if (!files.length) continue;
    const path = [];
    for (const h of heads) if (h.at < m.index) { while (path.length && path[path.length - 1].level >= h.level) path.pop(); path.push(h); }
    const where = path.map((h) => h.text).join(' / ');
    const section = /arrangements|transcriptions/i.test(where) ? 'arrangement' : /appendix|sketch|fragment|unfinished|early version/i.test(where) ? 'appendix' : /selection|excerpt/i.test(where) ? 'selection' : 'complete';
    const kind = untemplate(field('Image Type'));
    const publisher = untemplate(field('Publisher Information')).slice(0, 90);
    const editor = untemplate(field('Editor')).slice(0, 60);
    /* what it covers: everything, unless it sits under Selections or its descriptions name
       pieces ("No.3", "Nos.13-24" without a "Complete" heading over it) */
    const descs = files.map((f) => f.desc).join('; ');
    const named = numbersIn(descs);
    const partial = section === 'selection' || (!/complete/i.test(where) && !/complete|^score$|full score/i.test(descs) && named.size > 0);
    const source = files.some((f) => f.source);
    let score = source ? 100 : 0;
    if (/typeset/i.test(kind)) score += 40;
    if (PUBLISHERS.test(publisher)) score += 15;
    if (/manuscript/i.test(kind) || /autograph|manuscript/i.test(descs)) score -= 50;
    if (/arrang|transcri|simplif/i.test(field('Arranger') + ' ' + editor)) score -= 100;
    ups.push({ files, kind, publisher, editor, section, where, source, all: !partial, numbers: named, text: fold(where + ' ' + descs), score });
  }
  return ups.filter((u) => u.section !== 'arrangement' && u.section !== 'appendix');
}
const { fold } = require('./search');
/* the engraving program an upload's files come from: "Engraving files (Capella)", or the file
   extension. MusicXML and MuseScore files open here (webmscore imports them); Capella files
   open in desktop MuseScore, which exports MusicXML; LilyPond, PMX, Finale, Sibelius and abc
   files open in neither, but their typeset PDFs recognise cleanly */
const EXT = { mxl: 'MusicXML', musicxml: 'MusicXML', xml: 'MusicXML', mscz: 'MuseScore', mscx: 'MuseScore', ly: 'LilyPond', cap: 'Capella', capx: 'Capella', mus: 'Finale', musx: 'Finale', sib: 'Sibelius', abc: 'abc' };
const READABLE = /musicxml|xml|mxl|musescore/i;
const CONVERTIBLE = /capella/i;
function formatOf(u) {
  const out = new Set();
  for (const f of u.files) {
    if (!f.source) continue;
    const said = /engraving files?\s*\(([^)]+)\)/i.exec(f.desc);
    if (said) out.add(said[1].trim());
    else { const ext = (/\.(\w+)$/.exec(f.name) || [])[1]; if (ext && EXT[ext.toLowerCase()]) out.add(EXT[ext.toLowerCase()]); }
  }
  return [...out].join(', ') || 'unknown';
}

/* the FILES section of each page's wikitext, kept as text so the reading above can change
   without asking IMSLP again */
async function pull(pages) {
  const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
  const todo = pages.filter((p) => typeof cache[p] !== 'string');
  for (let i = 0; i < todo.length; i += 20) {
    const batch = todo.slice(i, i + 20);
    const url = 'https://imslp.org/api.php?format=json&action=query&prop=revisions&rvprop=content&titles=' + encodeURIComponent(batch.join('|'));
    const body = await (await fetch(url, { headers: HEADERS })).json();
    for (const p of Object.values(body.query.pages)) {
      if (!p.revisions) continue;
      const text = p.revisions[0]['*'];
      const from = text.indexOf('*****FILES*****');
      const to = text.indexOf('*****WORK INFO*****');
      cache[p.title] = text.slice(Math.max(0, from), to > from ? to : undefined);
    }
    for (const p of batch) if (typeof cache[p] !== 'string') cache[p] = '';
    fs.writeFileSync(CACHE, JSON.stringify(cache));
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 600));
  }
  return cache;
}

async function main() {
  const groups = new Map();
  const nowhere = [];
  for (const e of missing) {
    const at = pageOf(e);
    if (!at) { nowhere.push(e); continue; }
    const g = groups.get(at.page) || { page: at.page, holder: at.holder, pieces: [] };
    g.pieces.push(e);
    groups.set(at.page, g);
  }
  const files = await pull([...groups.keys()]);
  console.log();
  const rows = [...groups.values()].map((g) => {
    const h = g.holder;
    const comp = composerOf(h.composer);
    const pop = Math.max(h.pop || 0, ...g.pieces.map((p) => p.pop || 0));
    const folder = h.id.replace(/\//g, '__');
    /* which needed pieces an upload covers: all of them for a complete edition; else those
       whose number (within the page's work) or title the descriptions name */
    const want = g.pieces.flatMap((p) => (p._lacking ? p._lacking : [p]));
    const numOf = (p) => { if (p.id === h.id) return null; const top = byId.get(h.id + '/' + p.id.slice(h.id.length + 1).split('/')[0]); return top ? top.number : null; };
    const movements = (kidsOf.get(h.id) || []).filter((k) => k.kind === 'movement').length;
    /* an upload outside a "Complete" heading whose file names carry one piece's title
       ("Debussy_Clair_de_lune.pdf" on the Suite bergamasque page) holds that piece alone */
    const kids = kidsOf.get(h.id) || [];
    const onlyOf = (u) => {
      if (/complete/i.test(u.where)) return null;
      const names = fold(u.files.map((f) => f.name.replace(/[_-]+/g, ' ')).join(' '));
      const hit = kids.filter((k) => fold(k.title).length >= 6 && names.includes(fold(k.title)));
      return hit.length && hit.length < kids.length ? hit : null;
    };
    const covers = (u, p) => {
      const only = onlyOf(u);
      if (only) return only.some((k) => p.id === k.id || p.id.startsWith(k.id + '/'));
      return u.all
        || (p.id === h.id ? movements > 0 && u.numbers.size >= movements : (numOf(p) != null && u.numbers.has(numOf(p))) || (fold(p.title).length >= 6 && u.text.includes(fold(p.title))));
    };
    const ups = uploadsOf(files[g.page] || '').map((u) => ({ ...u, n: want.filter((p) => covers(u, p)).length }));
    ups.sort((a, b) => b.n - a.n || b.score - a.score);
    const best = ups[0] && ups[0].n ? ups[0] : null;
    const src = ups.filter((u) => u.source).sort((a, b) => b.n - a.n)[0];
    return {
      priority: 0, folder, composer: comp.name, work: label(h).replace(/^[^·]+· /, ''), catalogue: (h.cat || [])[0] || '',
      imslp: 'https://imslp.org/wiki/' + encodeURIComponent(g.page.replace(/ /g, '_')).replace(/%2C/g, ',').replace(/%28/g, '(').replace(/%29/g, ')'),
      pieces: g.pieces.length, needed: g.pieces.flatMap((p) => (p._lacking ? p._lacking.map((k) => k.id) : [p.id])).join(' '),
      neededTitles: g.pieces.map((p) => (p.cat && p.cat[0] ? p.cat[0] + ' ' : '') + p.title + (p._lacking ? ' (only movements ' + p._lacking.map((k) => k.number).join(', ') + ')' : '')).join('; '),
      /* what to call each transcription: the piece's id below the page's own ("15" for
         chopin/op-28/15 in the chopin__op-28 folder), "score" when the page is the piece */
      fileNames: g.pieces.flatMap((p) => (p._lacking ? p._lacking : [p])).map((p) => (p.id === h.id ? 'score' : p.id.slice(h.id.length + 1).replace(/\//g, '-'))).join(' '),
      /* "yes": engraving files cover every needed piece; "3 of 22": they cover some */
      hasSource: src && src.n === want.length ? 'yes' : src && src.n ? `${src.n} of ${want.length}` : '',
      suggest: best ? best.files.map((f) => f.name).join(' + ') : '',
      suggestWhy: best
        ? [best.source ? 'engraving files' : best.kind || 'scan', best.publisher, best.editor, best.n < want.length ? `covers ${best.n} of ${want.length}` : '', best.files.map((f) => f.desc).filter(Boolean).join(', ')].filter(Boolean).join(' | ').slice(0, 200)
        : ups.length ? 'no upload names these pieces: check the page' : 'no files listed',
      otherSource: src && src !== best && src.n ? src.files.filter((f) => f.source).map((f) => f.name).join(' + ') : '',
      sourceFormat: src && src.n ? formatOf(src) : '',
      rights: h.rights && h.rights.us === false ? 'protected in the US' : h.rights && h.rights.eu === false ? 'protected in the EU' : '',
      pop,
    };
  });
  /* engraving files that open here lead, being no work at all; then Capella files (one export
     in MuseScore); then the other complete engraving files, whose typeset PDFs recognise
     cleanly; then the most played. Protected works go last */
  const rank = (r) => (r.rights ? -1 : r.hasSource !== 'yes' ? 0 : READABLE.test(r.sourceFormat) ? 3 : CONVERTIBLE.test(r.sourceFormat) ? 2 : 1);
  rows.sort((a, b) => rank(b) - rank(a) || b.pop - a.pop || b.pieces - a.pieces);
  rows.forEach((r, i) => { r.priority = i + 1; });
  fs.mkdirSync(OUT, { recursive: true });
  const cols = ['priority', 'folder', 'composer', 'work', 'catalogue', 'pieces', 'hasSource', 'sourceFormat', 'suggest', 'suggestWhy', 'otherSource', 'rights', 'imslp', 'fileNames', 'neededTitles', 'needed'];
  const csv = (v) => (/[",\n;]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  fs.writeFileSync(path.join(OUT, 'imslp-needed.csv'), '﻿' + [cols.join(','), ...rows.map((r) => cols.map((c) => csv(r[c])).join(','))].join('\r\n') + '\r\n');
  fs.writeFileSync(path.join(OUT, 'imslp-needed.json'), JSON.stringify({ built: new Date().toISOString().slice(0, 10), pages: rows, notOnImslp: nowhere.map((e) => ({ id: e.id, label: label(e), cat: e.cat })) }, null, 1));
  const lines = nowhere.map((e) => [e.id, label(e).replace(/^[^·]+· /, ''), (e.cat || []).join(' / ')].map(csv).join(','));
  fs.writeFileSync(path.join(OUT, 'not-on-imslp.csv'), '﻿' + ['id,title,catalogue', ...lines].join('\r\n') + '\r\n');
  const total = rows.reduce((a, r) => a + r.pieces, 0);
  console.log(`${missing.length} pieces still needed: ${total} on ${rows.length} IMSLP pages (${rows.filter((r) => r.hasSource === 'yes').length} with engraving files for all of them, ${rows.filter((r) => r.hasSource && r.hasSource !== 'yes').length} for some), ${nowhere.length} with no IMSLP page`);
}

main().catch((e) => { console.error(e); process.exit(1); });
