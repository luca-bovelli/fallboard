/* Fallboard — engrave-core.js
   Turns MusicXML into screen-width systems engraved by MuseScore (the webmscore build of its
   engine). Shared by the browser, for imported files, and by tools/engrave.js, which
   pre-engraves the built-in score.

   The score is re-flowed to a page as wide as the screen and only one system tall, so each
   "page" is one system: a strip that can be mounted on its own. The SVG is then compacted:
   repeated glyphs become <use> references into one shared table and colours become
   currentColor. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.FB = root.FB || {}).engrave = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* page widths in staff spaces; a staff is four spaces tall */
  const LAYOUTS = [
    { key: 'narrow', max: 560, wsp: 62 },
    { key: 'medium', max: 900, wsp: 96 },
    { key: 'wide', max: Infinity, wsp: 132 },
  ];
  const layoutFor = (cssWidth) => LAYOUTS.find((l) => cssWidth < l.max) || LAYOUTS[LAYOUTS.length - 1];

  const r1 = (v) => String(Math.round(v * 10) / 10);
  const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi;

  /* MuseScore honours the page geometry written in the file, so the re-flow is done there:
     our own page size, and none of the source's system breaks or manual positions. */
  function prepareXml(xml, wsp) {
    let staves = 0;
    const partCount = (xml.match(/<part\s+id=/g) || []).length || 1;
    const declared = [...xml.matchAll(/<staves>\s*(\d+)\s*<\/staves>/g)].map((m) => +m[1]);
    staves = Math.max(partCount, declared.length ? declared.reduce((a, b) => Math.max(a, b), 1) + partCount - 1 : partCount);
    const hsp = Math.round(4 * staves + 6.5 * (staves - 1) + 10);
    const defaults =
      '<defaults><scaling><millimeters>7</millimeters><tenths>40</tenths></scaling>' +
      `<page-layout><page-height>${hsp * 10}</page-height><page-width>${wsp * 10}</page-width>` +
      '<page-margins type="both"><left-margin>12</left-margin><right-margin>12</right-margin>' +
      '<top-margin>20</top-margin><bottom-margin>20</bottom-margin></page-margins></page-layout></defaults>';
    let x = xml.replace(/<!DOCTYPE[^>]*>/i, '');
    x = x.replace(/<defaults>[\s\S]*?<\/defaults>\s*/, '');
    x = x.replace(/<credit[\s>][\s\S]*?<\/credit>\s*/g, '');
    /* MuseScore builds a title block from these when there are no credits; the app already shows the title */
    x = x.replace(/<work>[\s\S]*?<\/work>\s*/g, '');
    x = x.replace(/<(movement-title|movement-number|rights)\b[^>]*>[\s\S]*?<\/\1>\s*/g, '');
    x = x.replace(/<creator\b[^>]*>[\s\S]*?<\/creator>\s*/g, '');
    x = x.replace(/<print\b[^>]*\/>\s*/g, '').replace(/<print\b[^>]*>[\s\S]*?<\/print>\s*/g, '');
    x = x.replace(/\s(?:default-x|default-y|relative-x|relative-y|width)="[^"]*"/g, '');
    /* fonts the engine does not have ("Times New Roman") fall back to one that loses spaces and
       "=": text keeps MuseScore's own font */
    x = x.replace(/\sfont-family="[^"]*"/g, '');
    /* "Ped." and "*" written as loose symbols lose their place once the page is re-flowed, so
       they become pedal lines, which MuseScore positions itself under the bass staff */
    let down = false;
    x = x.replace(/<pedal\b([^>]*?)\/>/g, (all, a) => {
      const type = (/type="(\w+)"/.exec(a) || [])[1];
      if (type !== 'start' && type !== 'stop') return all;
      let out = type;
      if (type === 'start') { out = down ? 'change' : 'start'; down = true; }
      else if (!down) return '';
      else down = false;
      return `<pedal type="${out}" line="yes"/>`;
    });
    /* on a grand staff the pedal belongs under the lowest staff, wherever the file attached it */
    const lowest = declared.length ? declared.reduce((a, b) => Math.max(a, b), 1) : 1;
    if (partCount === 1 && lowest > 1) {
      x = x.replace(/<direction\b[^>]*>[\s\S]*?<\/direction>/g, (block) => {
        if (!block.includes('<pedal')) return block;
        let b = block.replace(/<staff>\s*\d+\s*<\/staff>/, '');
        const tag = `<staff>${lowest}</staff>`;
        b = b.includes('<sound') ? b.replace('<sound', tag + '<sound') : b.replace('</direction>', tag + '</direction>');
        return b.replace(/<direction\b[^>]*>/, '<direction placement="below">');
      });
    }
    x = tidyRests(x);
    if (/<part-list>/.test(x)) x = x.replace(/<part-list>/, defaults + '<part-list>');
    return x;
  }

  /* Rests. Files often pin rests to odd heights (below the bass staff, above the treble), and a
     staff with two voices repeats rests the reader does not need. In each measure, staff by staff:
       - no rest keeps a pinned height: a rest alone in a silence sits on the middle line, and a
         rest beside another voice's notes is placed by MuseScore, above or below them;
       - rests stay unless dropping one cannot blur the rhythm. A rest is hidden only when its
         voice plays nothing in the bar, when it follows the voice's last note in the bar, when
         the voice's next note starts together with the other voice's (the alignment shows the
         entry), or when two voices rest at once (one centred rest shows the silence);
       - where both voices are single-note lines (counterpoint: fugues, inventions, inner
         voices), every rest stays, since each voice's silences matter there.
     Hidden rests still hold their time, so nothing moves; playback reads the original file. */
  /* staff positions in diatonic steps (C4 = 28), and back to display-step and display-octave */
  const STEPS = 'CDEFGAB';
  const middleOf = (clef) => { const ref = { G: [4, 4], F: [3, 3], C: [0, 4] }[clef.sign]; return ref ? ref[0] + ref[1] * 7 + (3 - clef.line) * 2 + clef.octave * 7 : null; };
  const display = (pos) => ({ step: STEPS[((pos % 7) + 7) % 7], octave: Math.floor(pos / 7) });
  const stepOf = (note) => { const m = /<pitch>[\s\S]*?<step>\s*([A-G])[\s\S]*?<octave>\s*(-?\d+)/.exec(note); return m ? STEPS.indexOf(m[1]) + +m[2] * 7 : null; };
  /* how far a rest reaches up and down from its position, in steps, by type */
  const REACH = { whole: 1, half: 1, quarter: 3, eighth: 2, '16th': 3, '32nd': 4, '64th': 5 };
  function middleLine(clef, raise = 0) {
    const mid = middleOf(clef);
    return mid === null ? null : display(mid + raise);
  }
  /* where a shown rest goes: on the middle line when the staff is otherwise silent; beside other
     voices' notes, on its own voice's side of them (above them for a higher voice, below for a
     lower one), on the middle line when they leave room, else just clear of the nearest note.
     `lift` undoes the offset MuseScore will add itself. */
  function placeRest(r, notes, order, lift, beside) {
    const mid = middleOf(r.clef);
    if (mid === null) return null;
    const others = beside ? notes.filter((n) => n.voice !== r.voice && n.start < r.end && n.end > r.start && n.step !== null).map((n) => n.step) : [];
    if (!others.length) return display(mid + lift);
    const gap = (REACH[(/<type>\s*(\w+)/.exec(r.text) || [])[1]] || 3) + 2;
    const mineAvg = avg(notes.filter((n) => n.voice === r.voice).map((n) => n.step));
    const theirAvg = avg(others);
    const below = mineAvg !== null && theirAvg !== null ? mineAvg < theirAvg : order.indexOf(r.voice) > 0;
    const pos = below ? Math.min(mid, Math.min(...others) - gap) : Math.max(mid, Math.max(...others) + gap);
    return display(pos + lift);
  }
  const avg = (list) => { const l = list.filter((v) => v !== null); return l.length ? l.reduce((a, b) => a + b, 0) / l.length : null; };
  function tidyRests(xml) {
    return xml.replace(/<part\b[^>]*>[\s\S]*?<\/part>/g, (part) => tidyPart(mergeRests(part)));
  }

  /* Rests in fragments ("six sixteenth rests" where one rest belongs): a run of consecutive rests
     in one voice is rewritten as few rests as the meter allows. A whole bar of rest becomes a
     bar rest; otherwise rests fill to the next beat, a full beat is one rest (dotted in compound
     time), and two beats make one rest only from the first or third beat of a four-beat bar (or
     the first of a three-beat bar). Rests with a fermata or other marking, in tuplets, or hidden
     are left as they are. */
  const REST_TYPES = [['whole', 4], ['half', 2], ['quarter', 1], ['eighth', 0.5], ['16th', 0.25], ['32nd', 0.125], ['64th', 0.0625]];
  function restValue(q) {
    for (const [t, v] of REST_TYPES) {
      if (Math.abs(q - v) < 1e-9) return { type: t, dots: 0 };
      if (Math.abs(q - v * 1.5) < 1e-9) return { type: t, dots: 1 };
    }
    return null;
  }
  function mergeRests(part) {
    let div = 1, beats = 4, beatType = 4;
    return part.replace(/(<measure\b[^>]*>)([\s\S]*?)(<\/measure>)/g, (all, open, body, close) => {
      const d = /<divisions>\s*(\d+)/.exec(body); if (d) div = +d[1];
      const ts = /<time\b[^>]*>[\s\S]*?<beats>\s*(\d+)[\s\S]*?<beat-type>\s*(\d+)/.exec(body); if (ts) { beats = +ts[1]; beatType = +ts[2]; }
      if (!/<rest\b/.test(body)) return all;
      const unit = 4 / beatType;                                   // a beat-type note, in quarters
      const compound = (beatType === 8 || beatType === 16) && beats % 3 === 0 && beats > 3;
      const B = compound ? 3 * unit : unit;                        // one beat, in quarters
      const nBeats = compound ? beats / 3 : beats;
      const len = beats * unit;
      /* the bar in time order, by voice */
      const items = [];
      let t = 0, last = 0;
      for (const m of body.matchAll(/<note\b[^>]*>[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>|<forward>[\s\S]*?<\/forward>/g)) {
        const s = m[0];
        const q = +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0) / div;
        if (s.startsWith('<backup')) { t -= q; continue; }
        if (s.startsWith('<forward')) { t += q; continue; }
        if (/<grace\b/.test(s) || /<cue\s*\/>/.test(s)) continue;
        const chord = /<chord\s*\/>/.test(s);
        const start = chord ? last : t;
        if (!chord) { last = t; t += q; }
        items.push({ at: m.index, text: s, start, end: start + q, rest: /<rest\b/.test(s), chord,
          key: ((/<staff>\s*(\d+)/.exec(s) || [])[1] || '1') + '/' + ((/<voice>\s*([^<\s]+)/.exec(s) || [])[1] || '1'),
          plain: /<rest\b/.test(s) && !/print-object="no"/.test(s) && !/<notations\b|<time-modification\b/.test(s) && !/measure="yes"/.test(s) });
      }
      const edits = new Map();   // index of a rest -> its replacement ('' for removed)
      for (const key of new Set(items.map((i) => i.key))) {
        const seq = items.filter((i) => i.key === key && !i.chord);
        for (let a = 0; a < seq.length; ) {
          if (!seq[a].plain) { a++; continue; }
          let b = a;
          while (b + 1 < seq.length && seq[b + 1].plain && Math.abs(seq[b + 1].start - seq[b].end) < 1e-9) b++;
          const run = seq.slice(a, b + 1);
          a = b + 1;
          const from = run[0].start, to = run[run.length - 1].end;
          /* the new rests */
          const parts = [];
          if (from < 1e-9 && Math.abs(to - len) < 1e-9 && seq.every((i) => i.rest)) parts.push({ q: len, bar: true });
          else {
            let p = from, ok = true;
            while (p < to - 1e-9 && ok) {
              const beatStart = Math.floor(p / B + 1e-9) * B;
              let q = null;
              if (Math.abs(p - beatStart) < 1e-9) {
                const k = Math.round(p / B);
                /* two beats as one rest: from beat 1 or 3 of four, or beat 1 of three */
                if (!compound && to - p >= 2 * B - 1e-9 && ((nBeats === 4 && k % 2 === 0) || (nBeats === 3 && k === 0)) && restValue(2 * B)) q = 2 * B;
                else if (to - p >= B - 1e-9 && restValue(B)) q = B;
              }
              if (q === null) {
                /* within a beat: the largest plain value that fits, starts on its own grid and
                   does not cross the beat */
                const room = Math.min(to, beatStart + B) - p;
                for (const [, v] of REST_TYPES) if (v <= room + 1e-9 && Math.abs((p - beatStart) / v - Math.round((p - beatStart) / v)) < 1e-9) { q = v; break; }
              }
              if (q === null) ok = false; else { parts.push({ q }); p += q; }
            }
            if (!ok) continue;
          }
          if (parts.length >= run.length) continue;
          const first = run[0].text;
          const make = (pt) => {
            let s = first.replace(/<duration>\s*\d+\s*<\/duration>/, `<duration>${Math.round(pt.q * div)}</duration>`)
              .replace(/<dot\s*\/>\s*/g, '').replace(/<beam\b[\s\S]*?<\/beam>\s*/g, '')
              .replace(/<display-step>[\s\S]*?<\/display-step>\s*|<display-octave>[\s\S]*?<\/display-octave>\s*/g, '');
            if (pt.bar) return s.replace(/<rest\b[^>]*?\/>|<rest\b[^>]*>[\s\S]*?<\/rest>/, '<rest measure="yes"/>').replace(/<type\b[^>]*>[\s\S]*?<\/type>\s*/, '<type>whole</type>');
            const v = restValue(pt.q);
            if (!v) return null;
            const typed = /<type\b/.test(s) ? s.replace(/<type\b[^>]*>[\s\S]*?<\/type>/, `<type>${v.type}</type>` + '<dot/>'.repeat(v.dots)) : s.replace(/(<\/voice>)/, `$1<type>${v.type}</type>` + '<dot/>'.repeat(v.dots));
            return typed;
          };
          const made = parts.map(make);
          if (made.some((x) => x === null)) continue;
          edits.set(run[0].at, made.join(''));
          for (const r of run.slice(1)) edits.set(r.at, '');
        }
      }
      /* A voice that crosses staves (its notes on the left hand's staff, its rests between them
         on the right hand's) leaves a row of short rests on a staff that is simply silent. Those
         rests are hidden, and the silence is written once, as plain rests in a voice of its own
         on that staff. */
      const added = [];
      const staffOf = (i) => i.key.split('/')[0];
      const voiceOf = (i) => i.key.split('/')[1];
      for (const staff of new Set(items.map(staffOf))) {
        const notesHere = items.filter((i) => !i.rest && staffOf(i) === staff && i.end > i.start);
        const crossing = items.filter((i) => i.plain && !edits.has(i.at) && staffOf(i) === staff &&
          items.some((o) => !o.rest && voiceOf(o) === voiceOf(i) && staffOf(o) !== staff && o.start < i.end + 1e-9 && o.end > i.start - B));
        if (crossing.length < 2) continue;
        crossing.sort((x, y) => x.start - y.start);
        const silentBetween = (a, b) => !notesHere.some((nn) => nn.start < b - 1e-9 && nn.end > a + 1e-9);
        const spans = [];
        for (const r of crossing) {
          const sp = spans[spans.length - 1];
          if (sp && silentBetween(sp.to, r.start)) { sp.to = Math.max(sp.to, r.end); sp.rests.push(r); } else spans.push({ from: r.start, to: r.end, rests: [r] });
        }
        const otherHere = (a, b) => items.some((i) => staffOf(i) === staff && !crossing.includes(i) && i.start < b - 1e-9 && i.end > a + 1e-9 && !(i.rest && /print-object="no"/.test(i.text)));
        for (const sp of spans) {
          if (sp.rests.length < 2) continue;
          /* the silence runs on to the bar's start or end when nothing else is on the staff there */
          if (!otherHere(0, sp.from)) sp.from = 0;
          if (!otherHere(sp.to, len)) sp.to = len;
          if (sp.from < 1e-9 && Math.abs(sp.to - len) < 1e-9) {
            for (const r of sp.rests) edits.set(r.at, r.text.replace(/^<note\b([^>]*)>/, '<note$1 print-object="no">'));
            added.push({ staff, parts: [{ at: 0, q: len, bar: true }] });
            continue;
          }
          const parts = [];
          let p = sp.from, ok = true;
          while (p < sp.to - 1e-9 && ok) {
            const beatStart = Math.floor(p / B + 1e-9) * B;
            let q = null;
            if (Math.abs(p - beatStart) < 1e-9 && sp.to - p >= B - 1e-9 && restValue(B)) q = B;
            if (q === null) { const room = Math.min(sp.to, beatStart + B) - p; for (const [, v] of REST_TYPES) if (v <= room + 1e-9 && Math.abs((p - beatStart) / v - Math.round((p - beatStart) / v)) < 1e-9) { q = v; break; } }
            if (q === null) ok = false; else { parts.push({ at: p, q }); p += q; }
          }
          if (!ok || parts.length >= sp.rests.length) continue;
          for (const r of sp.rests) edits.set(r.at, r.text.replace(/^<note\b([^>]*)>/, '<note$1 print-object="no">'));
          added.push({ staff, parts });
        }
      }
      if (!edits.size) return all;
      let out = '', from = 0;
      for (const it of items) {
        if (!edits.has(it.at)) continue;
        out += body.slice(from, it.at) + edits.get(it.at);
        from = it.at + it.text.length;
      }
      out += body.slice(from);
      if (added.length) {
        /* the new rests go in an unused voice, laid over the bar from its start */
        const used = new Set(items.map(voiceOf).map(Number).filter(Number.isFinite));
        let voice = 9;
        while (used.has(voice)) voice++;
        let extra = `<backup><duration>${Math.round(t * div)}</duration></backup>`;
        let pos = 0;
        for (const { staff, parts } of added) {
          for (const pt of parts) {
            if (pt.at > pos + 1e-9) extra += `<forward><duration>${Math.round((pt.at - pos) * div)}</duration><voice>${voice}</voice><staff>${staff}</staff></forward>`;
            const v = pt.bar ? { type: 'whole', dots: 0 } : restValue(pt.q);
            extra += `<note><rest${pt.bar ? ' measure="yes"' : ''}/><duration>${Math.round(pt.q * div)}</duration><voice>${voice}</voice><type>${v.type}</type>${'<dot/>'.repeat(v.dots)}<staff>${staff}</staff></note>`;
            pos = pt.at + pt.q;
          }
          extra += `<backup><duration>${Math.round(pos * div)}</duration></backup>`;
          pos = 0;
          voice++;
        }
        out += extra.replace(/<backup><duration>\d+<\/duration><\/backup>$/, '');
      }
      return open + out + close;
    });
  }

  /* each staff's hand, top to bottom, the way score.js assigns them: two staves are right and
     left; a single piano part on more gives its top staff to the right hand, its bottom staff to
     the left, and each staff between to the hand of its register */
  function staffHands(xml) {
    const parts = xml.match(/<part\b[^>]*>[\s\S]*?<\/part>/g) || [];
    if (parts.length !== 1) return null;
    const n = Math.max(1, ...[...parts[0].matchAll(/<staves>\s*(\d+)/g)].map((m) => +m[1]));
    if (n === 2) return [0, 1];
    if (n < 2) return null;
    const sum = new Array(n + 1).fill(0), count = new Array(n + 1).fill(0);
    for (const m of parts[0].matchAll(/<note\b[^>]*>([\s\S]*?)<\/note>/g)) {
      const p = /<step>\s*([A-G])[\s\S]*?(?:<alter>\s*(-?[\d.]+)[\s\S]*?)?<octave>\s*(-?\d+)/.exec(m[1]);
      if (!p) continue;
      const st = +((/<staff>\s*(\d+)/.exec(m[1]) || [])[1] || 1);
      sum[st] += 12 * (+p[3] + 1) + { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[p[1]] + Math.round(+(p[2] || 0));
      count[st]++;
    }
    return Array.from({ length: n }, (_, k) => (k === 0 ? 0 : k === n - 1 ? 1 : count[k + 1] && sum[k + 1] / count[k + 1] >= 60 ? 0 : 1));
  }
  function tidyPart(part) {
    /* clefs in force, by staff, carried from measure to measure */
    const clefs = {};
    const readClefs = (s) => {
      for (const c of s.matchAll(/<clef\b([^>]*)>([\s\S]*?)<\/clef>/g)) {
        const n = (/number="(\d+)"/.exec(c[1]) || [])[1] || '1';
        clefs[n] = { sign: (/<sign>\s*(\w+)/.exec(c[2]) || [])[1], line: +((/<line>\s*(\d+)/.exec(c[2]) || [])[1] || (/<sign>\s*F/.test(c[2]) ? 4 : 2)), octave: +((/<clef-octave-change>\s*(-?\d+)/.exec(c[2]) || [])[1] || 0) };
      }
    };
    return part.replace(/<measure\b[^>]*>[\s\S]*?<\/measure>/g, (measure) => {
      const items = [];
      let t = 0, last = 0;
      for (const m of measure.matchAll(/<note\b[^>]*>[\s\S]*?<\/note>|<backup>[\s\S]*?<\/backup>|<forward>[\s\S]*?<\/forward>|<attributes>[\s\S]*?<\/attributes>/g)) {
        const s = m[0];
        if (s.startsWith('<attributes')) { readClefs(s); continue; }
        const dur = +((/<duration>\s*(\d+)/.exec(s) || [])[1] || 0);
        if (s.startsWith('<backup')) { t -= dur; continue; }
        if (s.startsWith('<forward')) { t += dur; continue; }
        if (/<grace\b/.test(s) || /<cue\s*\/>/.test(s)) continue;
        const start = /<chord\s*\/>/.test(s) ? last : t;
        if (!/<chord\s*\/>/.test(s)) { last = t; t += dur; }
        const staff = (/<staff>\s*(\d+)/.exec(s) || [])[1] || '1';
        items.push({
          step: stepOf(s),
          at: m.index, text: s, start, end: start + dur,
          rest: /<rest\b/.test(s),
          chord: /<chord\s*\/>/.test(s),
          voice: (/<voice>\s*([^<\s]+)/.exec(s) || [])[1] || '1',
          staff,
          clef: clefs[staff] || (staff === '2' ? { sign: 'F', line: 4, octave: 0 } : { sign: 'G', line: 2, octave: 0 }),
        });
      }
      /* rests the file already hides are left as they are, and do not count */
      const rests = items.filter((i) => i.rest && !/^<note\b[^>]*print-object="no"/.test(i.text));
      if (!rests.length) return measure;
      const change = new Map();
      for (const staff of new Set(items.map((i) => i.staff))) {
        /* MuseScore numbers a staff's voices by all of them, hidden rests included (allVoices sets
           which rests it lowers); the decisions only look at what is shown */
        const allVoices = [...new Set(items.filter((i) => i.staff === staff).map((i) => i.voice))].sort((a, b) => +a - +b || a.localeCompare(b));
        const mine = items.filter((i) => i.staff === staff && !(i.rest && !rests.includes(i)));
        const voices = [...new Set(mine.map((i) => i.voice))].sort((a, b) => +a - +b || a.localeCompare(b));
        const notes = mine.filter((i) => !i.rest && i.end > i.start);
        /* counterpoint: two or more voices with notes, and almost no chords among their notes */
        const sounding = new Set(notes.map((n) => n.voice));
        const onsets = notes.filter((n) => !n.chord).length;
        const chords = new Set(notes.filter((n) => n.chord).map((n) => n.voice + '@' + n.start)).size;
        const counterpoint = sounding.size > 1 && onsets > 0 && chords / onsets <= 0.15;
        const staffRests = rests.filter((i) => i.staff === staff);
        const sounding_ = (a, b) => notes.some((n) => n.start < b && n.end > a);
        /* the voices from top to bottom, by their average pitch here (a voice with no notes keeps
           its place in the file's order) */
        const order = voices.map((v, i) => ({ v, at: avg(notes.filter((n) => n.voice === v).map((n) => n.step)), i }))
          .sort((a, b) => (b.at === null || a.at === null ? a.i - b.i : b.at - a.at)).map((x) => x.v);
        if (voices.length < 2) {
          /* one voice: its rests stay */
          for (const r of staffRests) change.set(r, false);
        } else if (counterpoint) {
          /* counterpoint keeps its rests, except a voice's that plays nothing in the bar */
          /* (a rest that is the staff's only sign of a silence stays, whatever its voice) */
          for (const r of staffRests) change.set(r, !notes.some((n) => n.voice === r.voice) && sounding_(r.start, r.end));
        } else {
          /* rests where the staff is silent: one of each overlapping group is shown (the first
             voice's, else the longest); the others say the same thing again */
          const rank = (a, b) => (a.voice === voices[0] ? 0 : 1) - (b.voice === voices[0] ? 0 : 1) || (b.end - b.start) - (a.end - a.start);
          const silentRests = staffRests.filter((r) => !sounding_(r.start, r.end)).sort(rank);
          const markers = [];
          for (const r of silentRests) if (!markers.some((s) => s.start < r.end && s.end > r.start)) markers.push(r);
          for (const r of staffRests) {
            let hide;
            if (silentRests.includes(r)) hide = !markers.includes(r);
            else {
              /* a rest while another voice plays: hidden only when that cannot blur the rhythm */
              const own = notes.filter((n) => n.voice === r.voice);
              const next = own.filter((n) => n.start >= r.end).sort((a, b) => a.start - b.start)[0];
              if (!own.length) hide = true; /* the voice plays nothing in this bar */
              else if (!next) hide = true; /* after the voice's last note: nothing left to place */
              else hide = notes.some((n) => n.voice !== r.voice && n.start === next.start); /* its next note lines up with the other voice */
            }
            change.set(r, hide);
          }
        }
        /* then every shown rest gets its place; MuseScore moves a first-voice rest 4 steps up when
           another voice shows anything at that moment, and any other voice's rest 4 steps down */
        const shown = staffRests.filter((r) => !change.get(r));
        for (const r of shown) {
          if (/measure="yes"/.test(r.text) || allVoices.length < 2) continue;
          const crowded = sounding_(r.start, r.end) || shown.some((o) => o !== r && o.voice !== r.voice && o.start < r.end && o.end > r.start);
          const lift = r.voice === allVoices[0] ? (crowded ? -4 : 0) : 4;
          r.centre = placeRest(r, notes, order, lift, sounding_(r.start, r.end));
        }
      }
      let out = '', from = 0;
      for (const r of rests) {
        let s = r.text.replace(/<display-step>[\s\S]*?<\/display-step>\s*|<display-octave>[\s\S]*?<\/display-octave>\s*/g, '');
        if (r.centre) s = s.replace(/<rest\b([^>]*?)\s*(\/>|>\s*<\/rest>)/, (all, a) => `<rest${a}><display-step>${r.centre.step}</display-step><display-octave>${r.centre.octave}</display-octave></rest>`);
        if (change.get(r)) s = s.replace(/^<note\b([^>]*)>/, (all, a) => '<note' + a.replace(/\sprint-object="[^"]*"/, '') + ' print-object="no">');
        out += measure.slice(from, r.at) + s;
        from = r.at + r.text.length;
      }
      return out + measure.slice(from);
    });
  }

  function attrs(s) {
    const o = {};
    for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2];
    return o;
  }

  function extent(numbers, box) {
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      const x = +numbers[i], y = +numbers[i + 1];
      if (x < box[0]) box[0] = x;
      if (y < box[1]) box[1] = y;
      if (x > box[2]) box[2] = x;
      if (y > box[3]) box[3] = y;
    }
    return box;
  }

  /* page numbers and bar numbers are drawn by the app, in its own type */
  const DROP = new Set(['Page', 'InstrumentName', 'MeasureNumber']);

  /* Which staff (so which hand) each element belongs to, for dimming the other hand: three
     layers, data-s="0" (right hand), "1" (left hand) and "n" (neutral). Barlines and the brace
     join both staves, so they are neutral and always stay at full strength. Elements that hang off a note follow the nearest notehead; beams and flags
     follow the stems they touch; slurs and ties the note they start from; everything else
     (staff lines, clefs, signatures, rests, dynamics, tempo, pedal...) the nearer staff.
     Noteheads are tagged by the app, by the staff they sit on, the rule it matches them with. */
  const NEUTRAL = new Set(['BarLine', 'Bracket']);
  const ON_NOTE = new Set(['LedgerLine', 'Stem', 'Accidental', 'Articulation', 'NoteDot', 'Arpeggio', 'StemSlash', 'Fingering', 'Fermata', 'Tuplet', 'Tremolo', 'Glissando', 'GlissandoSegment']);
  const ON_STEMS = new Set(['Beam', 'Hook']);
  const FROM_START = new Set(['SlurSegment', 'TieSegment']);
  /* drawn in several parts (figure, line, hooks); the parts of one must not be split between hands */
  const MULTI = new Set(['OttavaSegment', 'PedalSegment', 'TextLineSegment', 'HairpinSegment', 'Tuplet']);

  /* hands: which hand each staff belongs to, top to bottom (two staves: [0, 1]; a piano part on
     three or more staves gives each a hand, as score.js does) */
  function assignStaves(items, lines, sp, hands) {
    const L = lines;
    if (L.length < 10 || L.length % 5) return;
    const n = L.length / 5;
    const bands = Array.from({ length: n }, (_, k) => [L[k * 5], L[k * 5 + 4]]);
    const handOf = hands && hands.length === n ? hands : bands.map((_, k) => (k === 0 ? 0 : k === n - 1 ? 1 : k < n / 2 ? 0 : 1));
    const bandAt = (y) => { let best = 0, bd = Infinity; bands.forEach((b, k) => { const d = Math.max(b[0] - y, 0, y - b[1]); if (d < bd) { bd = d; best = k; } }); return best; };
    const heads = [];
    for (const it of items) if (it.cls === 'Note' && it.head) heads.push({ x: it.head[0], y: it.head[1], s: handOf[bandAt(it.head[1])] });
    const toBox = (b, x, y) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]));
    const nearestHead = (b) => {
      let best = null, bd = Infinity;
      for (const h of heads) { const d = toBox(b, h.x, h.y); if (d < bd) { bd = d; best = h; } }
      return best && bd < sp * 8 ? best.s : undefined;
    };
    const nearestBand = (b) => handOf[bandAt((b[1] + b[3]) / 2)];
    const stems = [];
    for (const it of items) {
      if (it.cls === 'Note') continue;
      if (NEUTRAL.has(it.cls)) { it.staff = 'n'; continue; }
      if (!it.box) continue;
      if (ON_NOTE.has(it.cls)) it.staff = nearestHead(it.box);
      else if (FROM_START.has(it.cls) && it.start) it.staff = nearestHead([it.start[0], it.start[1], it.start[0], it.start[1]]);
      if (it.staff === undefined && !ON_STEMS.has(it.cls)) it.staff = nearestBand(it.box);
      if (it.cls === 'Stem' && it.staff !== undefined) stems.push(it);
    }
    for (const it of items) {
      if (!ON_STEMS.has(it.cls) || !it.box) continue;
      const b = it.box, votes = [0, 0];
      for (const st of stems) {
        const s = st.box;
        if (s[2] >= b[0] - sp * 0.4 && s[0] <= b[2] + sp * 0.4 && s[3] >= b[1] - sp * 0.6 && s[1] <= b[3] + sp * 0.6) votes[st.staff]++;
      }
      it.staff = votes[0] || votes[1] ? (votes[1] > votes[0] ? 1 : 0) : nearestHead(b);
      if (it.staff === undefined) it.staff = nearestBand(b);
    }

    const byCls = new Map();
    for (const it of items) if (MULTI.has(it.cls) && it.box) (byCls.get(it.cls) || byCls.set(it.cls, []).get(it.cls)).push(it);
    const near = (a, b) => a.box[0] - sp * 1.5 <= b.box[2] && b.box[0] - sp * 1.5 <= a.box[2] && a.box[1] - sp * 1.5 <= b.box[3] && b.box[1] - sp * 1.5 <= a.box[3];
    for (const [cls, list] of byCls) {
      const seen = new Set();
      for (const first of list) {
        if (seen.has(first)) continue;
        const parts = [first];
        seen.add(first);
        for (let k = 0; k < parts.length; k++) for (const o of list) if (!seen.has(o) && near(parts[k], o)) { seen.add(o); parts.push(o); }
        /* the nearer staff, weighted by the size of each part */
        let staff;
        {
          const votes = [0, 0];
          for (const p of parts) if (p.staff === 0 || p.staff === 1) votes[p.staff] += (p.box[2] - p.box[0]) + (p.box[3] - p.box[1]);
          staff = votes[1] > votes[0] ? 1 : 0;
        }
        for (const p of parts) p.staff = staff;
      }
    }
  }

  /* one MuseScore page -> { svg, w, right, y0, h, heads, lines } or null when the page is empty.
     Elements are grouped by class (and staff) so shared attributes are written once; noteheads
     stay in one group, in order, which is how the app tells them apart. */
  function compact(svg, glyphs, wsp, hands) {
    const glyph = (key, d, sx, sy) => {
      let g = glyphs.map.get(key);
      if (!g) {
        const box = extent(d.match(NUM) || [], [Infinity, Infinity, -Infinity, -Infinity]);
        g = { id: 'fbg' + glyphs.map.size, box: [box[0] * sx, box[1] * sy, box[2] * sx, box[3] * sy] };
        const sc = sx === 1 && sy === 1 ? '' : Math.abs(sx - sy) < 1e-4 ? ` transform="scale(${+sx.toFixed(4)})"` : ` transform="scale(${+sx.toFixed(4)} ${+sy.toFixed(4)})"`;
        glyphs.map.set(key, g);
        glyphs.defs.push(`<path id="${g.id}"${sc} d="${d.replace(NUM, r1)}"/>`);
      }
      return g;
    };
    const items = [];
    const heads = [];
    const lines = [];
    const page = [Infinity, Infinity, -Infinity, -Infinity];
    const size = /viewBox="0 0 ([\d.]+) ([\d.]+)"/.exec(svg);
    const sp = (size ? +size[1] : 1000) / wsp;     // one staff space in SVG units
    for (const m of svg.matchAll(/<(path|polyline)\b([^>]*?)\/>/g)) {
      const a = attrs(m[2]);
      const cls = a.class || 'x';
      if (DROP.has(cls)) continue;
      let extra = a.stroke && a.stroke !== 'none' && a['stroke-width'] ? ` stroke-width="${r1(+a['stroke-width'])}"` : '';
      if (a.fill === 'none') extra += ' fill="none"';
      if (a['stroke-dasharray']) extra += ` stroke-dasharray="${a['stroke-dasharray'].replace(NUM, r1)}"`;
      if (a['stroke-linecap'] === 'round') extra += ' stroke-linecap="round"';

      if (m[1] === 'polyline') {
        const nums = (a.points || '').match(NUM) || [];
        const box = extent(nums, [Infinity, Infinity, -Infinity, -Infinity]);
        extent(nums, page);
        if (cls === 'StaffLines' && nums.length >= 4) lines.push(Math.round(+nums[1] * 10) / 10);
        items.push({ cls, extra, box, el: `<polyline points="${nums.map(r1).join(' ')}"/>` });
        continue;
      }

      const d = a.d || '';
      const t = a.transform ? (a.transform.match(NUM) || []).map(Number) : null;
      if (t && t.length === 6 && t[1] === 0 && t[2] === 0) {
        const g = glyph(d + '|' + t[0].toFixed(4) + '|' + t[3].toFixed(4), d, t[0], t[3]);
        const x = t[4], y = t[5];
        const box = [x + g.box[0], y + g.box[1], x + g.box[2], y + g.box[3]];
        extent(box, page);
        const it = { cls, extra, box, use: true, el: `<use href="#${g.id}" x="${r1(x)}" y="${r1(y)}"/>` };
        if (cls === 'Note') {
          it.head = [Math.round((x + (g.box[0] + g.box[2]) / 2) * 10) / 10, Math.round(y * 10) / 10];
          heads.push(it.head[0], it.head[1]);
        }
        items.push(it);
        continue;
      }
      const nums = d.match(NUM) || [];
      const box = t ? (t.length >= 6 ? [t[4], t[5], t[4], t[5]] : null) : extent(nums, [Infinity, Infinity, -Infinity, -Infinity]);
      if (!t) extent(nums, page);
      const start = !t && nums.length >= 2 ? [+nums[0], +nums[1]] : null;
      /* text set as outlines (dynamics, tuplet figures, tempo words): the same shape recurs at
         many positions, so store it once relative to its first point */
      if (!t && !extra && d.length > 160 && nums.length >= 4 && !/[HhVvAaSsQqTtmlc]/.test(d)) {
        const ox = +nums[0], oy = +nums[1];
        let i = 0;
        const rel = d.replace(NUM, (v) => r1(+v - (i++ % 2 ? oy : ox)));
        const g = glyph('rel|' + rel, rel, 1, 1);
        items.push({ cls, extra, box, start, use: true, el: `<use href="#${g.id}" x="${r1(ox)}" y="${r1(oy)}"/>` });
        continue;
      }
      const it = { cls, extra, box, start, el: `<path${a.transform ? ` transform="${a.transform}"` : ''} d="${d.replace(NUM, r1)}"/>` };
      if (t && cls === 'Note') { it.head = [t[4], t[5]]; heads.push(t[4], t[5]); }
      items.push(it);
    }
    if (!items.length || !(page[3] > page[1])) return null;
    const staffLines = [...new Set(lines)].sort((p, q) => p - q);
    assignStaves(items, staffLines, sp, hands);

    const groups = new Map();
    for (const it of items) {
      const st = it.cls === 'Note' || it.staff === undefined ? '' : ` data-s="${it.staff}"`;
      const key = it.cls === 'Note' ? 'Note' : it.cls + it.extra + st;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { open: `<g class="${it.cls}"${it.cls === 'Note' ? '' : it.extra}${st}>`, items: [] }));
      g.items.push(it.el);
    }
    const pad = 10;
    const y0 = Math.floor(page[1] - pad), y1 = Math.ceil(page[3] + pad);
    let out = '';
    for (const g of groups.values()) out += g.open + g.items.join('') + '</g>';
    return {
      w: size ? Math.round(+size[1] * 10) / 10 : Math.ceil(page[2]),
      right: page[2],
      y0, h: y1 - y0,
      svg: out,
      heads,
      lines: staffLines,
    };
  }

  /* WebMscore: the loaded webmscore class (Node build or the browser's worker build) */
  async function engrave(WebMscore, xml, wsp, onProgress) {
    const data = new TextEncoder().encode(prepareXml(xml, wsp));
    const hands = staffHands(xml);
    const score = await WebMscore.load('musicxml', data);
    try {
      const n = await score.npages();
      const mp = await score.measurePositions();
      const glyphs = { map: new Map(), defs: [] };
      const pages = [];
      const pageMap = new Map();
      for (let i = 0; i < n; i++) {
        const pg = compact(await score.saveSvg(i, false), glyphs, wsp, hands);
        if (pg) { pageMap.set(i, pages.length); pages.push(pg); }
        if (onProgress) onProgress((i + 1) / n);
      }
      if (!pages.length) throw new Error('This score could not be engraved.');
      const r = (v) => Math.round(v * 10) / 10;
      const meas = mp.elements
        .slice()
        .sort((a, b) => a.id - b.id)
        .map((e) => (pageMap.has(e.page) ? [pageMap.get(e.page), r(e.x), r(e.y), r(e.sx), r(e.sy)] : null));
      /* A bar too dense for the width runs past the page edge (MuseScore reports a justification
         error and leaves it). Such a system keeps its own, wider width, so the app draws it
         scaled down to fit the screen; every other system keeps the common staff size. */
      const w = pages[0].w, pad = (w / wsp) * 1.2;
      const fit = ({ w: _, right, ...p }) => (right > w + 1 ? { ...p, w: Math.ceil(right + pad) } : p);
      return { v: 2, wsp, w, defs: glyphs.defs.join(''), pages: pages.map(fit), meas };
    } finally {
      try { score.destroy(); } catch (e) { /* already gone */ }
    }
  }

  return { LAYOUTS, layoutFor, prepareXml, engrave, mergeRests, staffHands };
});
