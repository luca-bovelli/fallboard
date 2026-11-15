/* Structural checks of the matched score files, into .data/pdmx/checks.json.

     node tools/catalog/check-scores.js

   Every file in .data/pdmx/matches.json that has been fetched is read twice: by the app's own
   parser (dist/js/score.js, run here on a small stand-in for the browser's XML parser), and by a
   scan of the MusicXML. Each file gets flags:

     unreadable     the app cannot open it
     hands          not exactly two staves, so the app cannot split the hands
     empty-hand     one hand has no notes
     parts          more than one part (instruments, or the hands as separate parts)
     key            the key signature does not fit the catalogue's key for the piece
     ending         the last bass note is not the key's tonic (information only: inverted final chords,
                    a Fine in mid-score and final runs set it off as often as a wrong piece)
     overfull       bars holding more than their time signature
     short-bars     short bars away from any repeat, double bar or change (more than 2%)
     voices         a staff with more than four voices
     hidden-notes   notes MuseScore hides (often playback helpers that would sound)
     range          notes outside the 88 keys
     jumps          D.C., D.S., Coda or Fine, which the app does not follow
     no-tempo       no tempo at all, so the app plays at 100 bpm
     lyrics, chords text the app has no use for
     length         far longer or shorter than IMSLP's average duration for the work
     versions       the piece's two files disagree on bars or notes by more than a tenth */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..', '..');
const DATA = path.join(ROOT, '.data', 'pdmx');
const { matches } = JSON.parse(fs.readFileSync(path.join(DATA, 'matches.json'), 'utf8'));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'catalog.json'), 'utf8'));
const byId = new Map(catalog.entries.map((e) => [e.id, e]));

/* the app's parser, as the app runs it */
global.window = global;
global.DOMParser = require('./xml-lite').DOMParser;
require(path.join(ROOT, 'dist', 'js', 'score.js'));
const FB = global.FB;

/* ---------- reading .mxl ---------- */
function unzip(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) return buf.toString('utf8');
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('damaged zip');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    entries.push({ name: buf.toString('utf8', p + 46, p + 46 + nlen), method, csize, lho });
    p += 46 + nlen + xlen + clen;
  }
  const read = (e) => {
    const nl = buf.readUInt16LE(e.lho + 26), xl = buf.readUInt16LE(e.lho + 28);
    const data = buf.subarray(e.lho + 30 + nl + xl, e.lho + 30 + nl + xl + e.csize);
    return (e.method === 0 ? data : zlib.inflateRawSync(data)).toString('utf8');
  };
  const container = entries.find((e) => e.name === 'META-INF/container.xml');
  const root = container && (/full-path="([^"]+)"/.exec(read(container)) || [])[1];
  const pick = entries.find((e) => e.name === root) || entries.find((e) => !e.name.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(e.name));
  if (!pick) throw new Error('no score in zip');
  return read(pick);
}

/* ---------- keys ---------- */
const MAJOR = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 };
const MINOR = { A: 0, E: 1, B: 2, 'F#': 3, 'C#': 4, 'G#': 5, 'D#': 6, 'A#': 7, D: -1, G: -2, C: -3, F: -4, Bb: -5, Eb: -6, Ab: -7 };
const PC = { C: 0, 'B#': 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, Fb: 4, F: 5, 'E#': 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11, Cb: 11 };
const STEP_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/* the catalogue key of an entry, or of the first movement of a work given without one */
function keyOf(e) {
  if (e.key) return e.key;
  const first = catalog.entries.find((k) => k.parent === e.id && k.number === 1);
  return e.kind === 'work' && first && first.key ? first.key : null;
}

/* ---------- the MusicXML scan ---------- */
function scan(xml) {
  const out = { parts: (xml.match(/<score-part\b/g) || []).length, staves: 1, bars: 0, overfull: 0, short: 0, voices: 0, hiddenNotes: 0, outOfRange: 0, lyrics: 0, chords: 0, jumps: 0, tempos: 0, keyChanges: 0, fifths: null, mode: null, lastBass: null, transposed: /<transpose>/.test(xml) };
  out.staves = Math.max(1, ...[...xml.matchAll(/<staves>\s*(\d+)/g)].map((m) => +m[1]));
  out.lyrics = (xml.match(/<lyric[\s>]/g) || []).length;
  out.chords = (xml.match(/<harmony\b/g) || []).length;
  out.jumps = (xml.match(/<sound\b[^>]*\b(dacapo|dalsegno|tocoda|fine|coda|segno)=/g) || []).length + (xml.match(/<words[^>]*>\s*(D\.?\s?C\.?|D\.?\s?S\.?|Da Capo|Dal Segno|To Coda|Fine)\b/gi) || []).length;
  out.tempos = (xml.match(/<sound\b[^>]*\btempo=/g) || []).length + (xml.match(/<metronome\b/g) || []).length;
  const keys = [...xml.matchAll(/<key\b[^>]*>([\s\S]*?)<\/key>/g)];
  if (keys.length) { out.fifths = +((/<fifths>\s*(-?\d+)/.exec(keys[0][1]) || [])[1]); out.mode = (/<mode>\s*(\w+)/.exec(keys[0][1]) || [])[1] || null; }
  out.keyChanges = new Set(keys.map((k) => (/<fifths>\s*(-?\d+)/.exec(k[1]) || [])[1])).size - 1;
  /* the first part's bars: each voice should fill the time signature */
  const part = (xml.match(/<part\b[^>]*>[\s\S]*?<\/part>/) || [''])[0];
  let div = 1, beats = 4, beatType = 4;
  const measures = [...part.matchAll(/<measure\b([^>]*)>([\s\S]*?)<\/measure>/g)];
  out.bars = measures.length;
  measures.forEach((mm, mi) => {
    const body = mm[2];
    const d = /<divisions>\s*(\d+)/.exec(body); if (d) div = +d[1];
    const ts = /<time\b[^>]*>[\s\S]*?<beats>\s*(\d+)[\s\S]*?<beat-type>\s*(\d+)/.exec(body); if (ts) { beats = +ts[1]; beatType = +ts[2]; }
    const len = (beats * 4 * div) / beatType;
    const fill = {};
    const staffVoices = {};
    for (const n of body.matchAll(/<note\b([^>]*)>([\s\S]*?)<\/note>|<forward>([\s\S]*?)<\/forward>/g)) {
      const s = n[2] || n[3];
      if (/<grace\b/.test(s) || /<cue\s*\/>/.test(s)) continue;
      /* a forward without a voice only moves the cursor; it fills no voice */
      if (n[3] !== undefined && !/<voice>/.test(s)) continue;
      const v = (/<voice>\s*([^<\s]+)/.exec(s) || [])[1] || '1';
      const st = (/<staff>\s*(\d+)/.exec(s) || [])[1] || '1';
      (staffVoices[st] = staffVoices[st] || new Set()).add(v);
      if (!/<chord\s*\/>/.test(s)) fill[v] = (fill[v] || 0) + +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0);
      if (n[1] !== undefined && /print-object="no"/.test(n[1]) && !/<rest\b/.test(s)) out.hiddenNotes++;
      const p = /<step>\s*([A-G])[\s\S]*?(?:<alter>\s*(-?[\d.]+)[\s\S]*?)?<octave>\s*(-?\d+)/.exec(s);
      if (p) { const midi = 12 * (+p[3] + 1) + STEP_PC[p[1]] + Math.round(+(p[2] || 0)); if (midi < 21 || midi > 108) out.outOfRange++; }
    }
    for (const set of Object.values(staffVoices)) out.voices = Math.max(out.voices, set.size);
    /* a bar holding more than its time signature is an error; a short one is fine at a pickup,
       a repeat, a double bar, an ending or a change of key or time (the bar before a repeat and
       the pickup after it add up to one), and otherwise suspicious */
    const sectionEdge = (i) => i < 0 || i >= measures.length || /<repeat\b|<ending\b|light-heavy|light-light|heavy-light|<key\b|<time\b/.test(measures[i][2]) || /implicit="yes"/.test(measures[i][1]);
    const over = Object.values(fill).some((f) => f > len + 1);
    const under = fill['1'] !== undefined && fill['1'] < len - 1 && !sectionEdge(mi) && !sectionEdge(mi - 1) && !sectionEdge(mi + 1);
    if (over) out.overfull++;
    if (under) out.short++;
  });
  /* the piece's final bass: in the last bar with notes, the lowest note still sounding at the
     bar's last onset (the final chord, not the cadence leading to it) */
  for (let i = measures.length - 1; i >= 0 && out.lastBass === null; i--) {
    const notes = [];
    let t = 0, last = 0;
    for (const n of measures[i][2].matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>|<backup>([\s\S]*?)<\/backup>|<forward>([\s\S]*?)<\/forward>/g)) {
      const s = n[1] || n[2] || n[3];
      const dur = +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0);
      if (n[2] !== undefined) { t -= dur; continue; }
      if (n[3] !== undefined) { t += dur; continue; }
      if (/<grace\b/.test(s)) continue;
      const start = /<chord\s*\/>/.test(s) ? last : t;
      if (!/<chord\s*\/>/.test(s)) { last = t; t += dur; }
      const p = /<step>\s*([A-G])[\s\S]*?(?:<alter>\s*(-?[\d.]+)[\s\S]*?)?<octave>\s*(-?\d+)/.exec(s);
      if (p && !/<rest\b/.test(s)) notes.push({ start, end: start + dur, midi: 12 * (+p[3] + 1) + STEP_PC[p[1]] + Math.round(+(p[2] || 0)) });
    }
    if (!notes.length) continue;
    const at = Math.max(...notes.map((n) => n.start));
    out.lastBass = Math.min(...notes.filter((n) => n.start <= at && n.end > at - 1e-9 && (n.end > at || n.start === at)).map((n) => n.midi));
  }
  /* the other parts may hold the bass */
  return out;
}

/* IMSLP's average duration of a work, in seconds ("15-16 minutes", "47 minutes", "3 min.") */
const durations = new Map();
for (const f of fs.readdirSync(path.join(ROOT, 'catalog', 'raw', 'imslp'))) {
  for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'raw', 'imslp', f), 'utf8')).pages) {
    const m = /\|Average Duration=([^\n|]*)/.exec(p.info || '');
    const mm = m && /(\d+(?:\.\d+)?)\s*(?:[-–]\s*(\d+(?:\.\d+)?))?\s*(min|minutes|mins)/i.exec(m[1]);
    if (mm) durations.set(p.title, 60 * (mm[2] ? (+mm[1] + +mm[2]) / 2 : +mm[1]));
  }
}
const expected = (e) => { const s = (e.src || []).find((x) => x.imslp && durations.has(x.imslp)); return s ? durations.get(s.imslp) : null; };

function check(entry, file) {
  const flags = [];
  const info = {};
  let xml;
  try { xml = unzip(path.join(DATA, file.mxl)); } catch (e) { return { flags: ['unreadable'], info: { error: 'zip: ' + e.message } }; }
  let score = null;
  try { score = FB.parseMusicXML(xml); } catch (e) { flags.push('unreadable'); info.error = e.message; }
  const s = scan(xml);
  Object.assign(info, { parts: s.parts, staves: s.staves, bars: s.bars, voices: s.voices, fifths: s.fifths, mode: s.mode });
  if (score) {
    info.notes = score.notes.length;
    info.seconds = Math.round(score.duration);
    info.bpm = score.tempo[0].bpm;
    if (!score.hasHands) flags.push('hands');
    else if (!score.onsets.R.length || !score.onsets.L.length) flags.push('empty-hand');
  }
  if (s.parts > 1) flags.push('parts');
  const key = keyOf(entry);
  if (key && s.fifths !== null && !Number.isNaN(s.fifths)) {
    const [tonic, mode] = key.split(' ');
    const want = (mode === 'minor' ? MINOR : MAJOR)[tonic];
    if (want !== undefined && want !== s.fifths) flags.push('key');
    if (s.lastBass !== null && PC[tonic] !== undefined && ((s.lastBass % 12) + 12) % 12 !== PC[tonic]) flags.push('ending');
    info.key = key;
  }
  if (s.overfull) { info.overfull = s.overfull; flags.push('overfull'); }
  if (s.short) { info.short = s.short; if (s.short > Math.max(2, s.bars * 0.02)) flags.push('short-bars'); }
  if (s.voices > 4) flags.push('voices');
  if (s.hiddenNotes) { info.hiddenNotes = s.hiddenNotes; flags.push('hidden-notes'); }
  if (s.outOfRange) { info.outOfRange = s.outOfRange; flags.push('range'); }
  if (s.jumps) flags.push('jumps');
  if (!s.tempos) flags.push('no-tempo');
  if (s.lyrics) flags.push('lyrics');
  if (s.chords) flags.push('chords');
  if (s.transposed) flags.push('transposed');
  const exp = expected(entry);
  if (exp && score) { info.expected = Math.round(exp); if (score.duration < exp * 0.45 || score.duration > exp * 2.2) flags.push('length'); }
  return { flags, info, verdict: verdict(flags, info, file) };
}

/* what a file's flags mean for using it:
     reject   the app cannot show it properly, or it is probably not the piece
     fixable  usable once a known, automatic repair is made
     ok       usable as it is (hidden notes, extra voices, the ending and the length are only
              information) */
function verdict(flags, info, file) {
  const has = (f) => flags.includes(f);
  if (has('unreadable') || has('hands') || has('parts') || has('empty-hand') || has('range')) return 'reject';
  if (has('overfull') && info.overfull > Math.max(2, info.bars * 0.05)) return 'reject';
  if (has('key') && file.how !== 'number') return 'reject';
  if (has('overfull') || has('no-tempo') || has('jumps') || has('lyrics') || has('chords') || has('key') || has('transposed')) return 'fixable';
  return 'ok';
}

function main() {
  const results = [];
  for (const [id, files] of Object.entries(matches)) {
    const entry = byId.get(id);
    const here = files.filter((f) => fs.existsSync(path.join(DATA, f.mxl)));
    const checked = here.map((f) => ({ id, mxl: f.mxl, title: f.title, how: f.how, quality: f.quality, ...check(entry, f) }));
    for (const c of checked) c.verdict = verdict(c.flags, c.info, c);
    /* two files of one piece should agree */
    if (checked.length > 1) {
      const [a, b] = checked;
      const off = (x, y) => x && y && Math.abs(x - y) / Math.max(x, y) > 0.1;
      if (off(a.info.bars, b.info.bars) || off(a.info.notes, b.info.notes)) for (const c of checked) c.flags.push('versions');
    }
    results.push(...checked);
  }
  fs.writeFileSync(path.join(DATA, 'checks.json'), JSON.stringify(results, null, 1));
  const count = {};
  for (const r of results) for (const f of r.flags) count[f] = (count[f] || 0) + 1;
  const clean = results.filter((r) => !r.flags.length).length;
  console.log(`${results.length} files checked; ${clean} with no flag`);
  const v = {};
  for (const r of results) v[r.verdict] = (v[r.verdict] || 0) + 1;
  console.log('verdicts: ' + JSON.stringify(v));
  /* pieces left with at least one usable file */
  const usable = new Set(results.filter((r) => r.verdict !== 'reject').map((r) => r.id));
  console.log(`${usable.size} of ${new Set(results.map((r) => r.id)).size} matched entries keep a usable file`);
  for (const [f, n] of Object.entries(count).sort((a, b) => b[1] - a[1])) console.log(f.padEnd(14) + String(n).padStart(5) + '  ' + (100 * n / results.length).toFixed(0) + '%');
}

if (require.main === module) main();
module.exports = { unzip, scan };
