/* Repairs a MusicXML score so the app can use it, the same way whatever the source.

     const { normalize } = require('./normalize');
     const { xml, fixes, problems, reject } = normalize(xml, { seconds })

   Repairs, each recorded in `fixes` when made:
     hands-merged    the hands written as two one-staff parts become one part with two staves
     parts-dropped   extra parts beside a two-staff piano part (an ossia staff) are dropped
     text            music-font symbols written as text ("♩ = 96" in a private-use character)
                     become ordinary characters; ones with no equivalent are removed
     lyrics, chords  lyrics and chord symbols are removed
     durations       a voice whose durations disagree with its written note values gets the
                     values' durations
     tuplets         a voice longer than its bar by a tuplet ratio (3:2, 4:3, 5:4, 7:4) with no
                     tuplet written, as when sextuplets are written as plain sixteenths,
                     becomes that tuplet
     tempo-brackets  "Lent (" + ♩ = 44 + ")" as separate pieces: one bracketed tempo mark
     tempo-stacked   two tempo marks at one moment: the first is kept
     tempo           a score with no tempo gets one (playback only, nothing is printed): from
                     its first tempo word, else from the expected length (`seconds`), else 96
   `reject` names why the file cannot be used (a duet, an ensemble, a single staff).
   Bars that are long in every voice (a missing time signature change) and free ornamental bars
   are left alone: the app times a bar by its content, so they play in order. */
'use strict';

/* ---------- music-font characters in text ---------- */
const SMUFL = {
  0xE260: '♭', 0xE261: '♮', 0xE262: '♯', 0xE263: '𝄪', 0xE264: '𝄫',
  0xE1D2: '𝅝', 0xE1D3: '𝅗𝅥', 0xE1D5: '♩', 0xE1D7: '♪', 0xE1D9: '𝅘𝅥𝅯', 0xE1E7: '.',
  0xECA2: '𝅝', 0xECA3: '𝅗𝅥', 0xECA5: '♩', 0xECA7: '♪', 0xECA9: '𝅘𝅥𝅯', 0xECB7: '.',
  0xE520: 'p', 0xE521: 'm', 0xE522: 'f', 0xE523: 'r', 0xE524: 's', 0xE525: 'z', 0xE526: 'n',
  0xE566: 'tr',
};
function fixText(xml, fixes) {
  let changed = false;
  const out = xml.replace(/(<(words|credit-words|rehearsal|text|part-name|part-abbreviation|movement-title|work-title)\b[^>]*>)([^<]*)(<\/\2>)/g, (all, open, tag, body, close) => {
    if (!/[-]/.test(body)) return all;
    changed = true;
    const t = body.replace(/[-]/g, (ch) => SMUFL[ch.codePointAt(0)] || '').replace(/\s{2,}/g, ' ');
    return open + t + close;
  });
  if (changed) fixes.push('text');
  return out;
}

/* ---------- parts ---------- */
const partsOf = (xml) => [...xml.matchAll(/<part\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/part>/g)].map((m) => ({ id: m[1], text: m[0], at: m.index }));
const nameOf = (xml, id) => {
  const sp = new RegExp('<score-part\\b[^>]*\\bid="' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"[^>]*>[\\s\\S]*?</score-part>').exec(xml);
  return sp ? ((/<part-name\b[^>]*>([^<]*)</.exec(sp[0]) || [])[1] || '').trim() : '';
};
const stavesOf = (part) => Math.max(1, ...[...part.matchAll(/<staves>\s*(\d+)/g)].map((m) => +m[1]));
const isKeyboard = (name) => !name || /piano|klavier|pianoforte|cembalo|harpsichord|clavecin|keyboard|clavier|klav|p(?:ia)?no|鋼琴|ピアノ|фортепиано|right hand|left hand|^r\.?h\.?$|^l\.?h\.?$|^treble$|^bass$|^staff/i.test(name);

function dropPart(xml, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return xml.replace(new RegExp('\\s*<score-part\\b[^>]*\\bid="' + esc + '"[^>]*>[\\s\\S]*?</score-part>'), '')
    .replace(new RegExp('\\s*<part\\b[^>]*\\bid="' + esc + '"[^>]*>[\\s\\S]*?</part>'), '');
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);
/* multiply every duration in a part by k (and its divisions), to make room for exact arithmetic */
function scalePart(part, k) {
  if (k === 1) return part;
  return part.replace(/<divisions>\s*(\d+)\s*<\/divisions>/g, (m, d) => `<divisions>${+d * k}</divisions>`)
    .replace(/<duration>\s*(\d+)\s*<\/duration>/g, (m, d) => `<duration>${+d * k}</duration>`)
    .replace(/<offset>\s*(-?\d+)\s*<\/offset>/g, (m, d) => `<offset>${+d * k}</offset>`);
}
const divisionsOf = (part) => +((/<divisions>\s*(\d+)/.exec(part) || [])[1] || 1);

/* two one-staff parts (right hand, left hand) -> one part with two staves */
function mergeHands(xml, a, b, fixes) {
  let pa = a.text, pb = b.text;
  const da = divisionsOf(pa), db = divisionsOf(pb);
  if (da !== db) { const l = (da * db) / gcd(da, db); pa = scalePart(pa, l / da); pb = scalePart(pb, l / db); }
  const mb = [...pb.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)].map((m) => m[1]);
  let i = 0;
  const merged = pa.replace(/(<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/g, (all, open, body, close) => {
    const other = mb[i++] || '';
    /* where the first hand's cursor ends, so the second can be laid over it from the start */
    let t = 0;
    for (const m of body.matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>|<backup>([\s\S]*?)<\/backup>|<forward>([\s\S]*?)<\/forward>/g)) {
      const d = +((/<duration>\s*(\d+)/.exec(m[1] || m[2] || m[3]) || [])[1] || 0);
      if (m[2] !== undefined) t -= d; else if (m[3] !== undefined) t += d; else if (!/<chord\s*\/>/.test(m[1]) && !/<grace\b/.test(m[1])) t += d;
    }
    let second = other
      .replace(/<staff>\s*\d+\s*<\/staff>/g, '<staff>2</staff>')
      .replace(/<voice>\s*(\d+)\s*<\/voice>/g, (m, v) => `<voice>${+v + 4}</voice>`)
      .replace(/<clef\b([^>]*)>/g, (m, at) => '<clef' + at.replace(/\snumber="[^"]*"/, '') + ' number="2">')
      .replace(/<(divisions|key|time)\b[\s\S]*?<\/\1>/g, '');
    /* every note and direction of the second hand names its staff */
    /* MusicXML puts <staff> after the stem and notehead, before beams, notations and lyrics */
    second = second.replace(/<note\b([^>]*)>([\s\S]*?)<\/note>/g, (m, at, s) => (/<staff>/.test(s) ? m : `<note${at}>${/<(beam|notations|lyric|play|listen)\b/.test(s) ? s.replace(/<(beam|notations|lyric|play|listen)\b/, '<staff>2</staff><$1') : s + '<staff>2</staff>'}</note>`))
      .replace(/<direction\b([^>]*)>([\s\S]*?)<\/direction>/g, (m, at, s) => (/<staff>/.test(s) ? m : `<direction${at}>${s.replace(/(<sound\b|$)/, '<staff>2</staff>$1')}</direction>`));
    const attrs = /<attributes>([\s\S]*?)<\/attributes>/.exec(second);
    second = second.replace(/<attributes>[\s\S]*?<\/attributes>\s*/, '');
    let first = body;
    if (attrs && /<clef\b/.test(attrs[1])) {
      const clefs = attrs[1].match(/<clef\b[\s\S]*?<\/clef>/g).join('');
      first = /<attributes>/.test(first)
        ? first.replace(/<attributes>([\s\S]*?)<\/attributes>/, (m, s) => '<attributes>' + s.replace(/<clef\b([^>]*)>/g, (c, at) => (/number=/.test(at) ? c : `<clef${at} number="1">`)) + clefs + '</attributes>')
        : '<attributes>' + clefs + '</attributes>' + first;
    }
    return open + first + (second.trim() ? `<backup><duration>${t}</duration></backup>` + second : '') + close;
  });
  /* the first bar says there are two staves */
  const withStaves = merged.replace(/<attributes>([\s\S]*?)<\/attributes>/, (m, s) => {
    let x = s.replace(/<staves>[\s\S]*?<\/staves>/, '');
    x = /<clef\b/.test(x) ? x.replace(/<clef\b/, '<staves>2</staves><clef') : x + '<staves>2</staves>';
    return '<attributes>' + x.replace(/<clef\b([^>]*)>/, (c, at) => (/number=/.test(at) ? c : `<clef${at} number="1">`)) + '</attributes>';
  });
  let out = xml.slice(0, a.at) + withStaves + xml.slice(a.at + a.text.length);
  out = dropPart(out, b.id);
  fixes.push('hands-merged');
  return out;
}

/* ---------- durations ---------- */
const TYPE = { maxima: 32, long: 16, breve: 8, whole: 4, half: 2, quarter: 1, eighth: 0.5, '16th': 0.25, '32nd': 0.125, '64th': 0.0625, '128th': 0.03125 };
function written(note, div) {
  const t = (/<type\b[^>]*>\s*([\w]+)/.exec(note) || [])[1];
  if (!t || TYPE[t] === undefined) return null;
  const dots = (note.match(/<dot\s*\/>/g) || []).length;
  let q = TYPE[t] * (2 - 1 / 2 ** dots);
  const tm = /<time-modification>[\s\S]*?<actual-notes>\s*(\d+)[\s\S]*?<normal-notes>\s*(\d+)/.exec(note);
  if (tm) q *= +tm[2] / +tm[1];
  return q * div;
}
const RATIOS = [[3, 2], [4, 3], [5, 4], [6, 4], [7, 4], [6, 5], [7, 6]];

/* one part's bars: a voice whose durations disagree with its written values, or that is longer
   than the bar by a tuplet ratio with no tuplet written, is retimed. Only bars whose voices all
   return to the bar's start with their backups are touched. */
function fixDurations(part, fixes) {
  let div = divisionsOf(part), beats = 4, beatType = 4;
  let tuplets = 0, retimed = 0;
  const out = part.replace(/(<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/g, (all, open, body, close) => {
    const d = /<divisions>\s*(\d+)/.exec(body); if (d) div = +d[1];
    const ts = /<time\b[^>]*>[\s\S]*?<beats>\s*(\d+)[\s\S]*?<beat-type>\s*(\d+)/.exec(body); if (ts) { beats = +ts[1]; beatType = +ts[2]; }
    const len = (beats * 4 * div) / beatType;
    /* the bar as a sequence; backups must all return to the start for a safe retiming */
    const els = [...body.matchAll(/<note\b[^>]*>[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>|<forward>[\s\S]*?<\/forward>/g)];
    let t = 0, simple = true;
    const voices = new Map();
    for (const m of els) {
      const s = m[0];
      const dur = +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0);
      if (s.startsWith('<backup')) { if (t - dur !== 0) simple = false; t -= dur; continue; }
      if (s.startsWith('<forward')) { t += dur; if (!/<voice>/.test(s)) continue; }
      if (/<grace\b/.test(s) || /<cue\s*\/>/.test(s)) continue;
      const key = ((/<staff>\s*(\d+)/.exec(s) || [])[1] || '1') + '/' + ((/<voice>\s*([^<\s]+)/.exec(s) || [])[1] || '1');
      if (!voices.has(key)) voices.set(key, []);
      voices.get(key).push(m);
      if (!/<chord\s*\/>/.test(s)) t += s.startsWith('<forward') ? 0 : dur;
    }
    if (!simple) return all;
    const fill = (list) => list.filter((m) => !/<chord\s*\/>/.test(m[0])).reduce((a, m) => a + +((/<duration>\s*(\d+)/.exec(m[0]) || [])[1] || 0), 0);
    const over = [...voices.entries()].filter(([, l]) => fill(l) > len * 1.02);
    const fits = [...voices.entries()].filter(([, l]) => Math.abs(fill(l) - len) <= len * 0.02);
    /* nothing long; or most voices long, which is a missing time signature change, not tuplets */
    if (!over.length || fits.length < over.length) return all;
    const replace = new Map();
    for (const [, list] of over) {
      const notes = list.filter((m) => m[0].startsWith('<note'));
      const given = fill(list);
      /* the written values add up to the bar: the durations were wrong */
      const want = notes.map((m) => written(m[0], div));
      if (want.every((w) => w !== null && Number.isInteger(w))) {
        const sum = notes.filter((m) => !/<chord\s*\/>/.test(m[0])).reduce((a, m) => a + written(m[0], div), 0) + list.filter((m) => m[0].startsWith('<forward')).reduce((a, m) => a + +((/<duration>\s*(\d+)/.exec(m[0]) || [])[1] || 0), 0);
        if (Math.abs(sum - len) <= len * 0.02) {
          for (const m of notes) replace.set(m.index, m[0].replace(/<duration>\s*\d+\s*<\/duration>/, `<duration>${written(m[0], div)}</duration>`));
          retimed++;
          continue;
        }
      }
      /* longer by a tuplet ratio with no tuplet written: that tuplet, but only when every note's
         duration is its written value (sextuplets written as plain sixteenths); a voice whose
         durations contradict its own note values is too muddled to guess at */
      if (notes.some((m) => /<time-modification>/.test(m[0]))) continue;
      if (!notes.every((m) => written(m[0], div) === +((/<duration>\s*(\d+)/.exec(m[0]) || [])[1] || -1))) continue;
      const r = RATIOS.find(([a, n]) => Math.abs(given * n - len * a) <= len * 0.01);
      if (!r) continue;
      const [a, n] = r;
      if (!notes.every((m) => (+((/<duration>\s*(\d+)/.exec(m[0]) || [])[1] || 0) * n) % a === 0)) continue;
      for (const m of notes) {
        const dur = +((/<duration>\s*(\d+)/.exec(m[0]) || [])[1] || 0);
        let s = m[0].replace(/<duration>\s*\d+\s*<\/duration>/, `<duration>${(dur * n) / a}</duration>`);
        const tm = `<time-modification><actual-notes>${a}</actual-notes><normal-notes>${n}</normal-notes></time-modification>`;
        s = /<(stem|notehead|staff|beam|notations|lyric)\b/.test(s) ? s.replace(/<(stem|notehead|staff|beam|notations|lyric)\b/, tm + '<$1') : s.replace('</note>', tm + '</note>');
        replace.set(m.index, s);
      }
      tuplets++;
    }
    if (!replace.size) return all;
    /* the backups now return from the new end of each voice */
    let nb = '', from = 0, cur = 0;
    for (const m of els) {
      const s0 = m[0];
      const s = replace.get(m.index) || s0;
      let piece = s;
      const dur = +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0);
      if (s.startsWith('<backup')) { piece = `<backup><duration>${cur}</duration></backup>`; cur = 0; }
      else if (s.startsWith('<forward')) cur += dur;
      else if (!/<chord\s*\/>/.test(s) && !/<grace\b/.test(s) && !/<cue\s*\/>/.test(s)) cur += dur;
      nb += body.slice(from, m.index) + piece;
      from = m.index + s0.length;
    }
    return open + nb + body.slice(from) + close;
  });
  if (retimed) fixes.push('durations');
  if (tuplets) fixes.push('tuplets');
  return out;
}

/* ---------- tempo ---------- */
const WORDS = [[/prestissimo/i, 200], [/presto/i, 176], [/vivacissimo/i, 172], [/vivace|vivo|vif|lebhaft|rasch|schnell/i, 156], [/allegro molto|allegro assai|allegro vivace|allegro con brio/i, 152],
  [/allegretto/i, 112], [/allegro|animé|anime|bewegt/i, 132], [/moderato|modéré|modere|mässig|massig|tempo di minuetto|minuet|menuet/i, 104], [/andantino/i, 92], [/andante|gehend/i, 80],
  [/adagietto/i, 72], [/adagio|langsam/i, 62], [/larghetto/i, 58], [/lento|lent\b/i, 54], [/largo|grave|sehr langsam/i, 46]];
function beatFactor(beats, beatType) {
  if (beatType === 2) return 2;
  if (beatType === 8 && beats % 3 === 0 && beats > 3) return 1.5;
  if (beatType === 8 || beatType === 16) return beatType === 8 ? 0.5 : 0.25;
  return 1;
}
function addTempo(xml, seconds, fixes) {
  if (/<sound\b[^>]*\btempo=/.test(xml)) return xml;
  const first = (xml.match(/<part\b[^>]*>[\s\S]*?<\/part>/) || [''])[0];
  const ts = /<time\b[^>]*>[\s\S]*?<beats>\s*(\d+)[\s\S]*?<beat-type>\s*(\d+)/.exec(first);
  const [beats, beatType] = ts ? [+ts[1], +ts[2]] : [4, 4];
  const words = [...first.matchAll(/<words\b[^>]*>([^<]*)<\/words>/g)].map((m) => m[1]).slice(0, 3).join(' ');
  const hit = WORDS.find(([re]) => re.test(words));
  let bpm = hit ? Math.round(hit[1] * beatFactor(beats, beatType)) : null;
  if (!bpm && seconds) {
    /* quarters in the piece over its expected length */
    let div = 1, q = 0;
    for (const mm of first.matchAll(/<measure\b[^>]*>([\s\S]*?)<\/measure>/g)) {
      const d = /<divisions>\s*(\d+)/.exec(mm[1]); if (d) div = +d[1];
      let t = 0, max = 0;
      for (const m of mm[1].matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>|<backup>([\s\S]*?)<\/backup>|<forward>([\s\S]*?)<\/forward>/g)) {
        const dd = +((/<duration>\s*(\d+)/.exec(m[1] || m[2] || m[3]) || [])[1] || 0);
        if (m[2] !== undefined) t -= dd; else if (m[3] !== undefined || !/<chord\s*\/>/.test(m[1])) t += dd;
        if (t > max) max = t;
      }
      q += max / div;
    }
    if (q) bpm = Math.round(Math.min(200, Math.max(40, (q / seconds) * 60)));
  }
  bpm = bpm || 96;
  fixes.push('tempo');
  /* at the very start of the first bar, after its attributes; the app reads it, MuseScore prints nothing */
  return xml.replace(/(<part\b[^>]*>\s*<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/, (all, open, body, close) => {
    const a = /<attributes>[\s\S]*?<\/attributes>/.exec(body);
    const at = a ? a.index + a[0].length : 0;
    return open + body.slice(0, at) + `<sound tempo="${bpm}"/>` + body.slice(at) + close;
  });
}

/* ---------- bracketed tempo marks ----------
   "Lent et grave (" + ♩ = 44 + ")" written as separate, separately placed pieces come apart once
   the engraving is re-flowed: the brackets go to the metronome mark itself. */
function joinTempoBrackets(xml, fixes) {
  let joined = 0;
  const out = xml.replace(/(<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/g, (all, open, body, close) => {
    if (!/<metronome\b/.test(body) || !/\(\s*<\/words>|>\s*\)/.test(body)) return all;
    let b = body;
    /* "(" at the end of words beside or before a metronome mark */
    b = b.replace(/(<words\b[^>]*>[^<]*?)\s*\(\s*(<\/words>)([\s\S]*?)<metronome\b([^>]*)>/, (m, w, cw, between, at) => {
      if (/<note\b/.test(between)) return m;
      joined++;
      return w + cw + between + '<metronome' + at.replace(/\sparentheses="[^"]*"/, '') + ' parentheses="yes">';
    });
    if (!joined) return all;
    /* the lone ")" that closed it */
    b = b.replace(/<direction\b[^>]*>\s*<direction-type>\s*<words\b[^>]*>\s*\)\s*<\/words>\s*<\/direction-type>[\s\S]*?<\/direction>/, '')
      .replace(/(<metronome\b[\s\S]*?<\/metronome>\s*<\/direction-type>\s*<direction-type>\s*<words\b[^>]*>)\s*\)\s*(<\/words>)/, '$1$2');
    return open + b + close;
  });
  if (joined) fixes.push('tempo-brackets');
  return out;
}

/* ---------- stacked tempo marks ----------
   Two tempo marks at the same moment (one per staff, or a stray second one) print on top of
   each other and leave the playback tempo to chance: the first is kept. */
function dedupeTempo(xml, fixes) {
  let dropped = 0;
  const out = xml.replace(/(<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/g, (all, open, body, close) => {
    if ((body.match(/<metronome\b|<sound\b[^>]*\btempo=/g) || []).length < 2) return all;
    const seen = new Set();
    let t = 0, last = 0;
    const result = body.replace(/<note\b[^>]*>[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>|<forward>[\s\S]*?<\/forward>|<direction\b[^>]*>[\s\S]*?<\/direction>/g, (el) => {
      const d = +((/<duration>\s*(\d+)/.exec(el) || [])[1] || 0);
      if (el.startsWith('<backup')) { t -= d; return el; }
      if (el.startsWith('<forward')) { t += d; return el; }
      if (el.startsWith('<note')) { if (!/<chord\s*\/>/.test(el) && !/<grace\b/.test(el)) { last = t; t += d; } return el; }
      if (!/<metronome\b|<sound\b[^>]*\btempo=/.test(el)) return el;
      const at = t + +((/<offset>\s*(-?\d+)/.exec(el) || [])[1] || 0);
      if (seen.has(at)) { dropped++; return ''; }
      seen.add(at);
      return el;
    });
    void last;
    return open + result + close;
  });
  if (dropped) fixes.push('tempo-stacked');
  return out;
}

/* ---------- all of it ---------- */
function normalize(input, ctx = {}) {
  const fixes = [], problems = [];
  let xml = input.replace(/^﻿/, '');
  if (!/<score-partwise\b/.test(xml)) return { xml, fixes, problems, reject: 'not partwise MusicXML' };
  /* parts: keep the keyboard, merge hands, drop ossias, reject ensembles */
  let parts = partsOf(xml);
  if (parts.length > 1) {
    const info = parts.map((p) => ({ ...p, name: nameOf(xml, p.id), staves: stavesOf(p.text), notes: (p.text.match(/<pitch>/g) || []).length }));
    if (info.some((p) => /primo|secondo|violin|viola|cello|flute|oboe|clarinet|voice|soprano|alto|tenor|choir|orchestra|guitar|trumpet|horn|bass(?!o)|basso continuo/i.test(p.name) && !isKeyboard(p.name))) return { xml, fixes, problems, reject: 'ensemble or duet' };
    const keyboards = info.filter((p) => isKeyboard(p.name) || /ossia/i.test(p.name));
    const twoStaff = info.filter((p) => p.staves >= 2 && !/ossia/i.test(p.name));
    if (twoStaff.length === 1) {
      for (const p of info) if (p !== twoStaff[0]) { xml = dropPart(xml, p.id); }
      fixes.push('parts-dropped');
    } else if (info.length === 2 && info.every((p) => p.staves === 1) && keyboards.length === 2) {
      /* the higher part is the right hand */
      const avg = (p) => { const ps = [...p.text.matchAll(/<step>\s*([A-G])[\s\S]*?<octave>\s*(\d+)/g)].map((m) => +m[2] * 7 + 'CDEFGAB'.indexOf(m[1])); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0; };
      const [hi, lo] = avg(info[0]) >= avg(info[1]) ? [info[0], info[1]] : [info[1], info[0]];
      xml = mergeHands(xml, hi, lo, fixes);
      if (hi !== info[0]) problems.push('hands-order');
    } else return { xml, fixes, problems, reject: `${info.length} parts that are not one piano` };
  }
  parts = partsOf(xml);
  if (stavesOf(parts[0].text) < 2) return { xml, fixes, problems, reject: 'a single staff' };
  if (stavesOf(parts[0].text) > 2) problems.push('staves-' + stavesOf(parts[0].text));
  /* text the app has no use for, and symbols the engraving font lacks */
  /* <lyric> elements only: <lyric-font> and <lyric-language> in the defaults stay */
  if (/<lyric[\s>]/.test(xml)) { xml = xml.replace(/<lyric(?=[\s>])[^>]*>[\s\S]*?<\/lyric>\s*/g, ''); fixes.push('lyrics'); }
  if (/<harmony\b/.test(xml)) { xml = xml.replace(/<harmony\b[\s\S]*?<\/harmony>\s*/g, ''); fixes.push('chords'); }
  xml = fixText(xml, fixes);
  xml = joinTempoBrackets(xml, fixes);
  xml = dedupeTempo(xml, fixes);
  /* durations, part by part */
  xml = xml.replace(/<part\b[^>]*>[\s\S]*?<\/part>/g, (p) => fixDurations(p, fixes));
  xml = addTempo(xml, ctx.seconds, fixes);
  return { xml, fixes: [...new Set(fixes)], problems, reject: null };
}

module.exports = { normalize, written, SMUFL };
