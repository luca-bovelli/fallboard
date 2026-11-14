/* Fallboard — score.js
   MusicXML (score-partwise) -> flat playback timeline.
   Times are "score seconds": seconds at the notated tempo, before the speed control. */
(function () {
  'use strict';
  const FB = (window.FB = window.FB || {});
  const STEP = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const ACC = { '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' };
  const SHARP_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

  FB.midiName = (m) => SHARP_NAMES[((m % 12) + 12) % 12];
  FB.midiOctave = (m) => Math.floor(m / 12) - 1;
  FB.isBlack = (m) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);

  function kid(el, tag) {
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === tag) return c;
    return null;
  }
  function kids(el, tag) {
    const out = [];
    for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (c.tagName === tag) out.push(c);
    return out;
  }
  function text(el, tag) {
    const c = kid(el, tag);
    return c ? c.textContent.trim() : null;
  }
  function num(el, tag, dflt) {
    const t = text(el, tag);
    const v = t === null ? NaN : parseFloat(t);
    return Number.isFinite(v) ? v : dflt;
  }
  const r6 = (x) => Math.round(x * 1e6) / 1e6;

  /* ---------- pass 1: read every measure of every part ---------- */
  function readPart(partEl, partIdx, measures) {
    let divisions = 1;
    let transpose = 0;
    let timeSig = null;
    const mEls = kids(partEl, 'measure');

    mEls.forEach((mEl, mi) => {
      const M =
        measures[mi] ||
        (measures[mi] = {
          number: mEl.getAttribute('number') || String(mi + 1),
          implicit: mEl.getAttribute('implicit') === 'yes',
          events: [], heads: [], tempos: [], dyns: [], pedals: [],
          lenQ: 0, time: null,
          repeatStart: false, repeatEnd: 0, endingStart: null, endingStop: false,
        });
      let pos = 0;        // quarters from the start of the measure
      let maxPos = 0;
      let lastStart = 0;
      const pendingGrace = new Map(); // voice -> [ [event, ...chord], ... ]

      const flushGrace = (voice, at) => {
        const groups = pendingGrace.get(voice);
        if (!groups || !groups.length) return;
        const n = groups.length;
        const g = Math.min(0.125, 1 / n);
        groups.forEach((grp, k) => {
          const q = at - (n - k) * g;
          grp.forEach((ev) => {
            ev.q = r6(q); ev.dur = g; M.events.push(ev);
            ev.head.q = ev.q; ev.head.dur = g; ev.head.col = r6(at);
          });
        });
        pendingGrace.set(voice, []);
      };

      for (let el = mEl.firstElementChild; el; el = el.nextElementSibling) {
        switch (el.tagName) {
          case 'attributes': {
            const d = num(el, 'divisions', NaN);
            if (d > 0) divisions = d;
            const t = kid(el, 'time');
            if (t) {
              const b = num(t, 'beats', NaN), bt = num(t, 'beat-type', NaN);
              if (b > 0 && bt > 0) timeSig = { beats: b, beatType: bt };
            }
            const tr = kid(el, 'transpose');
            if (tr) transpose = num(tr, 'chromatic', 0) + 12 * num(tr, 'octave-change', 0);
            break;
          }
          case 'backup':
            pos -= num(el, 'duration', 0) / divisions;
            if (pos < 0) pos = 0;
            break;
          case 'forward':
            pos += num(el, 'duration', 0) / divisions;
            if (pos > maxPos) maxPos = pos;
            break;
          case 'note': {
            const grace = !!kid(el, 'grace');
            const chord = !!kid(el, 'chord');
            const dur = grace ? 0 : num(el, 'duration', 0) / divisions;
            const voice = text(el, 'voice') || '1';
            let start;
            if (grace) start = pos;
            else if (chord) start = lastStart;
            else {
              start = pos;
              flushGrace(voice, start);
              lastStart = pos;
              pos += dur;
              if (pos > maxPos) maxPos = pos;
            }
            // hidden notes are engraving helpers that double a visible note
            if (el.getAttribute('print-object') === 'no') break;
            const p = kid(el, 'pitch');
            if (!p || kid(el, 'rest')) break;
            const step = text(p, 'step');
            const alter = Math.round(num(p, 'alter', 0));
            const octave = num(p, 'octave', 4);
            if (!(step in STEP)) break;
            const ev = {
              q: r6(start), dur,
              midi: 12 * (octave + 1) + STEP[step] + alter + transpose,
              name: step + (ACC[String(alter)] || ''),
              part: partIdx,
              staff: Math.round(num(el, 'staff', 1)),
              tieStart: false, tieStop: false,
            };
            // one entry per printed notehead (tied continuations included), for the notation view
            ev.head = {
              q: ev.q, col: ev.q, dur, part: partIdx, staff: ev.staff,
              dstep: octave * 7 + 'CDEFGAB'.indexOf(step), midi: ev.midi, hand: 0,
            };
            if (grace || dur > 0) M.heads.push(ev.head);
            let ties = kids(el, 'tie');
            if (!ties.length) {
              const nt = kid(el, 'notations');
              if (nt) ties = kids(nt, 'tied');
            }
            for (const t of ties) {
              if (t.getAttribute('type') === 'start') ev.tieStart = true;
              if (t.getAttribute('type') === 'stop') ev.tieStop = true;
            }
            if (grace) {
              const groups = pendingGrace.get(voice) || [];
              if (chord && groups.length) groups[groups.length - 1].push(ev);
              else groups.push([ev]);
              pendingGrace.set(voice, groups);
            } else if (dur > 0) {
              M.events.push(ev);
            }
            break;
          }
          case 'direction': {
            let at = pos;
            const off = num(el, 'offset', 0);
            if (off) at += off / divisions;
            if (at < 0) at = 0;
            const s = kid(el, 'sound');
            let words = null;
            for (const dt of kids(el, 'direction-type')) {
              const w = kid(dt, 'words');
              if (w && w.textContent.trim()) words = (words ? words + ' ' : '') + w.textContent.trim();
              const ped = kid(dt, 'pedal');
              if (ped) M.pedals.push({ q: r6(at), type: ped.getAttribute('type') || 'start' });
            }
            if (s) {
              const tempo = parseFloat(s.getAttribute('tempo'));
              if (tempo > 0) M.tempos.push({ q: r6(at), bpm: tempo, words });
              const dyn = parseFloat(s.getAttribute('dynamics'));
              if (dyn > 0) M.dyns.push({ q: r6(at), v: dyn });
            }
            break;
          }
          case 'sound': {
            const tempo = parseFloat(el.getAttribute('tempo'));
            if (tempo > 0) M.tempos.push({ q: r6(pos), bpm: tempo, words: null });
            break;
          }
          case 'barline': {
            const rep = kid(el, 'repeat');
            if (rep) {
              if (rep.getAttribute('direction') === 'forward') M.repeatStart = true;
              else M.repeatEnd = Math.max(2, parseInt(rep.getAttribute('times') || '2', 10) || 2);
            }
            const end = kid(el, 'ending');
            if (end) {
              const type = end.getAttribute('type');
              if (type === 'start') {
                M.endingStart = (end.getAttribute('number') || '1')
                  .split(/[,\s]+/).map((x) => parseInt(x, 10)).filter(Number.isFinite);
              } else M.endingStop = true;
            }
            break;
          }
        }
      }
      for (const voice of pendingGrace.keys()) flushGrace(voice, maxPos);
      if (timeSig && !M.time) M.time = timeSig;
      if (maxPos > M.lenQ) M.lenQ = maxPos;
    });
  }

  /* ---------- pass 2: playback order (simple repeats and voltas) ---------- */
  function playOrder(measures) {
    const order = [];
    const done = new Map();
    let i = 0, segStart = 0, pass = 1, jumped = false;
    const limit = measures.length * 12 + 64;
    while (i < measures.length && order.length < limit) {
      const M = measures[i];
      if (M.repeatStart) { if (!jumped) pass = 1; segStart = i; }
      jumped = false;
      if (M.endingStart && M.endingStart.length && !M.endingStart.includes(pass)) {
        while (i < measures.length && !measures[i].endingStop) i++;
        i++;
        continue;
      }
      order.push(i);
      if (M.repeatEnd) {
        const n = done.get(i) || 0;
        if (n < M.repeatEnd - 1) {
          done.set(i, n + 1);
          pass = n + 2;
          i = segStart;
          jumped = true;
          continue;
        }
        segStart = i + 1;
        pass = 1;
      }
      i++;
    }
    return order;
  }

  /* ---------- public: parse ---------- */
  FB.parseMusicXML = function (xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('This file is not readable XML.');
    const root = doc.documentElement;
    if (root.tagName === 'score-timewise') throw new Error('Timewise MusicXML is not supported. Export the score as partwise MusicXML.');
    if (root.tagName !== 'score-partwise') throw new Error('This is not a MusicXML score.');

    const work = kid(root, 'work');
    const ident = kid(root, 'identification');
    let composer = null;
    if (ident) for (const c of kids(ident, 'creator')) if (c.getAttribute('type') === 'composer') composer = c.textContent.trim();
    const title = (work && text(work, 'work-title')) || text(root, 'movement-title') || null;

    const measures = [];
    kids(root, 'part').forEach((p, pi) => readPart(p, pi, measures));
    if (!measures.length) throw new Error('This score has no measures.');

    let sig = { beats: 4, beatType: 4 };
    for (const M of measures) {
      if (M.time) sig = M.time; else M.time = sig;
      if (!(M.lenQ > 0)) M.lenQ = (M.time.beats * 4) / M.time.beatType;
    }

    /* hands: exactly two (part, staff) tracks -> right = first, left = second */
    const trackKeys = new Set();
    for (const M of measures) for (const e of M.events) trackKeys.add(e.part * 100 + e.staff);
    const tracks = [...trackKeys].sort((a, b) => a - b);
    const hasHands = tracks.length === 2;
    const handOf = (e) => (hasHands ? tracks.indexOf(e.part * 100 + e.staff) : 0);
    for (const M of measures) for (const h of M.heads) h.hand = handOf(h);

    /* flatten in playback order */
    const order = playOrder(measures);
    const occ = [];
    const raw = [], tempoEv = [], dynEv = [], pedEv = [];
    let beat = 0;
    for (const di of order) {
      const M = measures[di];
      occ.push({ doc: di, number: M.number, beat, lenQ: M.lenQ, time: M.time });
      for (const e of M.events) raw.push({ e, b: Math.max(0, beat + e.q) });
      for (const t of M.tempos) tempoEv.push({ b: beat + t.q, bpm: t.bpm, words: t.words });
      for (const d of M.dyns) dynEv.push({ b: beat + d.q, v: d.v });
      for (const p of M.pedals) pedEv.push({ b: beat + p.q, type: p.type });
      beat += M.lenQ;
    }
    const totalBeats = beat;
    const byB = (a, b) => a.b - b.b;
    raw.sort(byB); tempoEv.sort(byB); dynEv.sort(byB); pedEv.sort(byB);

    /* tempo map */
    const tempo = [];
    {
      let sec = 0, lastB = 0, bpm = tempoEv.length && tempoEv[0].b <= 1e-6 ? tempoEv[0].bpm : (tempoEv[0] ? tempoEv[0].bpm : 100);
      tempo.push({ b: 0, sec: 0, bpm, words: tempoEv[0] && tempoEv[0].b <= 1e-6 ? tempoEv[0].words : null });
      for (const t of tempoEv) {
        if (t.b <= 1e-6) { tempo[0].bpm = t.bpm; tempo[0].words = t.words || tempo[0].words; bpm = t.bpm; continue; }
        sec += ((t.b - lastB) * 60) / bpm;
        lastB = t.b; bpm = t.bpm;
        tempo.push({ b: t.b, sec, bpm, words: t.words });
      }
    }
    const segAtBeat = (b) => {
      let lo = 0, hi = tempo.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tempo[mid].b <= b) lo = mid; else hi = mid - 1; }
      return tempo[lo];
    };
    const segAtSec = (s) => {
      let lo = 0, hi = tempo.length - 1;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tempo[mid].sec <= s) lo = mid; else hi = mid - 1; }
      return tempo[lo];
    };
    const beatToSec = (b) => { const s = segAtBeat(b); return s.sec + ((b - s.b) * 60) / s.bpm; };
    const secToBeat = (t) => { const s = segAtSec(t); return s.b + ((t - s.sec) * s.bpm) / 60; };

    /* notes, with ties merged */
    const notes = [];
    const open = new Map();
    let di = 0, vel = 0.62;
    for (const { e, b } of raw) {
      while (di < dynEv.length && dynEv[di].b <= b + 1e-6) {
        vel = Math.min(1, Math.max(0.2, (dynEv[di].v * 0.9) / 127 + 0.08));
        di++;
      }
      const hand = handOf(e);
      const end = b + e.dur;
      const k1 = hand * 1000 + e.midi;
      if (e.tieStop) {
        const key = open.has(k1) ? k1 : open.has((1 - hand) * 1000 + e.midi) ? (1 - hand) * 1000 + e.midi : null;
        if (key !== null && Math.abs(open.get(key).b1 - b) > 0.26) open.delete(key);   // stale: that tie never closed
        else if (key !== null) {
          const n = open.get(key);
          if (end > n.b1) n.b1 = end;
          if (!e.tieStart) open.delete(key);
          continue;
        }
      }
      const n = { b0: b, b1: end, midi: e.midi, hand, vel, name: e.name };
      notes.push(n);
      if (e.tieStart) open.set(k1, n);
    }

    /* sustain pedal: a key released while the pedal is down rings until the pedal lifts */
    const pedalSpans = [];
    {
      let down = null;
      for (const p of pedEv) {
        if (p.type === 'start') { if (down !== null) pedalSpans.push([down, p.b]); down = p.b; }
        else if (p.type === 'change') { if (down !== null) pedalSpans.push([down, p.b]); down = p.b; }
        else if (p.type === 'stop') { if (down !== null) pedalSpans.push([down, p.b]); down = null; }
      }
      if (down !== null) pedalSpans.push([down, totalBeats]);
    }
    const pedalEndAfter = (b) => {
      let lo = 0, hi = pedalSpans.length - 1, ans = -1;
      while (lo <= hi) { const mid = (lo + hi) >> 1; if (pedalSpans[mid][0] <= b) { ans = mid; lo = mid + 1; } else hi = mid - 1; }
      return ans >= 0 && pedalSpans[ans][1] > b + 1e-6 ? pedalSpans[ans][1] : null;
    };

    const range = { both: [127, 0], R: [127, 0], L: [127, 0] };
    for (const n of notes) {
      n.t0 = beatToSec(n.b0);
      n.t1 = beatToSec(n.b1);
      const pe = pedalEndAfter(n.b1 - 1e-4);
      n.tOff = pe === null ? n.t1 : Math.min(beatToSec(pe), n.t0 + 9);
      if (n.tOff < n.t1) n.tOff = n.t1;
      for (const k of ['both', n.hand === 0 ? 'R' : 'L']) {
        if (n.midi < range[k][0]) range[k][0] = n.midi;
        if (n.midi > range[k][1]) range[k][1] = n.midi;
      }
    }
    notes.sort((a, b) => a.t0 - b.t0 || a.midi - b.midi);
    let maxDur = 0;
    for (const n of notes) if (n.t1 - n.t0 > maxDur) maxDur = n.t1 - n.t0;

    const onsetsOf = (pred) => {
      const out = [];
      for (const n of notes) if (pred(n) && (!out.length || n.t0 - out[out.length - 1] > 1e-3)) out.push(n.t0);
      return out;
    };

    for (const o of occ) o.t = beatToSec(o.beat);
    const docBeats = new Array(measures.length).fill(null);
    occ.forEach((o) => { if (docBeats[o.doc] === null) docBeats[o.doc] = []; docBeats[o.doc].push(o.beat); });

    return {
      title, composer, xml: xmlText,
      notes, maxDur, hasHands,
      hasPedal: pedalSpans.length > 0,
      range,
      onsets: {
        both: onsetsOf(() => true),
        R: onsetsOf((n) => n.hand === 0),
        L: onsetsOf((n) => n.hand === 1),
      },
      measures: occ,          // playback order: { doc, number, beat, t, lenQ, time }
      docMeasureLen: measures.map((m) => m.lenQ),
      docBeats,               // doc measure index -> beats where it is played
      docHeads: measures.map((m) => m.heads),   // printed noteheads per written measure
      docNumbers: measures.map((m) => m.number),
      tempo,
      totalBeats,
      duration: beatToSec(totalBeats),
      beatToSec, secToBeat,
      measureAt(t) {
        let lo = 0, hi = occ.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (occ[mid].t <= t + 1e-6) lo = mid; else hi = mid - 1; }
        return lo;
      },
      tempoAt(t) { return segAtSec(t); },
    };
  };

  /* ---------- .mxl (zipped MusicXML) ---------- */
  async function inflateRaw(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  FB.readScoreFile = async function (file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
    if (!isZip) return new TextDecoder('utf-8').decode(buf);
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed .mxl files. Export as uncompressed .musicxml instead.');
    const dv = new DataView(buf.buffer);
    let eocd = -1;
    for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('This .mxl file is damaged.');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = [];
    for (let i = 0; i < count; i++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nlen));
      entries.push({ name, method, csize, lho });
      p += 46 + nlen + xlen + clen;
    }
    const pick =
      entries.find((e) => !e.name.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(e.name)) || null;
    if (!pick) throw new Error('No score found inside this .mxl file.');
    const nlen = dv.getUint16(pick.lho + 26, true), xlen = dv.getUint16(pick.lho + 28, true);
    const data = buf.subarray(pick.lho + 30 + nlen + xlen, pick.lho + 30 + nlen + xlen + pick.csize);
    const out = pick.method === 0 ? data : await inflateRaw(data);
    return new TextDecoder('utf-8').decode(out);
  };
})();
