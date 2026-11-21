'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const C16 = path.join(ROOT, 'promo', 'clips', '16x9');
const C9 = path.join(ROOT, 'promo', 'clips', '9x16');
const OUT = path.join(ROOT, 'promo', 'audio');
fs.mkdirSync(OUT, { recursive: true });

// Remove retired audio files if present locally
for (const old of ['pain-youtube-muffled.wav', 'pain-frankenstein-sfx.wav', 'chopin-ballade-bed.wav', 'chopin-step-demo.wav', 'rach-cs-bed.wav']) {
  const p = path.join(OUT, old);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

function loadEventLog(clipName) {
  for (const dir of [C16, C9]) {
    const p = path.join(dir, `${clipName}.events.json`);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return null;
}

function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const clean = decodeURIComponent((req.url || '/').split('?')[0]);
      const p = path.join(DIST, clean === '/' ? 'index.html' : clean);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        res.writeHead(200);
        fs.createReadStream(p).pipe(res);
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}

(async () => {
  const clipNames = [
    'app-01-open-and-step',
    'app-02-roll-to-score',
    'app-03-color-worlds',
    'app-04-library-henle-pdf',
  ];
  const logs = {};
  for (const name of clipNames) {
    const ev = loadEventLog(name);
    if (!ev) throw new Error(`Missing ${name}.events.json in promo/clips/16x9 or 9x16 — run capture-app.js first!`);
    logs[name] = ev;
  }

  // Deterministic motion-graphic scene sound specs (ZERO piano loops — pure tactile UI sound design!)
  logs['03-hook-purist'] = {
    fps: 60,
    duration: 3.2,
    clip: '03-hook-purist',
    notes: [],
    sfx: [
      { t: 0.75, kind: 'tap' },
      { t: 1.65, kind: 'toggle' },
      { t: 2.84, kind: 'whoosh' },
    ],
  };
  logs['05-endcard'] = {
    fps: 60,
    duration: 2.6,
    clip: '05-endcard',
    notes: [],
    sfx: [
      { t: 0.04, kind: 'resolve' },
    ],
  };

  const { srv, port } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/credits.html`, { waitUntil: 'load' });

    const wavs = await page.evaluate(async (allLogs) => {
      const SR = 48000;
      const NAMES = ['A', 'C', 'Ds', 'Fs'];
      const ROOTS = [];
      for (let m = 21; m <= 108; m += 3) {
        const pc = m % 12, oct = Math.floor(m / 12) - 1;
        ROOTS.push({ midi: m, file: NAMES[[9, 0, 3, 6].indexOf(pc)] + oct + '.mp3' });
      }
      const decCtx = new OfflineAudioContext(2, 2, SR);
      const buffers = new Map();
      await Promise.all(ROOTS.map(async (r) => {
        const ab = await (await fetch('/samples/' + r.file)).arrayBuffer();
        buffers.set(r.midi, await decCtx.decodeAudioData(ab));
      }));

      function nearestRoot(midi) {
        let best = ROOTS[0].midi, d = 999;
        for (const r of ROOTS) {
          const dd = Math.abs(r.midi - midi);
          if (dd < d) { d = dd; best = r.midi; }
        }
        return best;
      }

      /* Warm studio concert hall IR:
         - 22ms pre-delay so piano hammer transients stay crisp & intimate
         - Warm early reflections (25..78ms)
         - One-pole lowpass-damped diffuse stereo tail (eliminates raw white-noise metallic hiss!) */
      function makeStudioHall(ctx, dur = 2.0) {
        const len = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        const preDelay = Math.floor(ctx.sampleRate * 0.022);
        const earlyTaps = [0.028, 0.041, 0.056, 0.071];

        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(ch);
          let seed = ch === 0 ? 133791 : 982451;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };

          // Warm early reflections
          for (let k = 0; k < earlyTaps.length; k++) {
            const idx = Math.floor((earlyTaps[k] + ch * 0.0035) * ctx.sampleRate);
            if (idx < len) d[idx] += (0.28 - k * 0.045) * (k % 2 ? -1 : 1);
          }

          // Lowpass-damped diffuse hall tail (alpha decays smoothly with time so highs darken naturally!)
          let lp = 0;
          for (let i = preDelay; i < len; i++) {
            const x = (i - preDelay) / (len - preDelay);
            const env = Math.pow(1 - x, 3.1) * Math.min(1, (i - preDelay) / (ctx.sampleRate * 0.035));
            const raw = rnd() * env * 0.34;
            const coeff = 0.24 - 0.14 * x; // warm ~2.4kHz -> ~1.1kHz damping over time
            lp = lp + coeff * (raw - lp);
            d[i] += lp;
          }
        }
        return buf;
      }

      function setupPianoBus(ctx) {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -9;
        comp.knee.value = 14;
        comp.ratio.value = 3.2;
        comp.attack.value = 0.006;
        comp.release.value = 0.22;
        comp.connect(ctx.destination);

        // Warm low-mid body + gentle anti-glare midrange dip
        const lowShelf = ctx.createBiquadFilter();
        lowShelf.type = 'lowshelf'; lowShelf.frequency.value = 165; lowShelf.gain.value = 2.0;
        const midDip = ctx.createBiquadFilter();
        midDip.type = 'peaking'; midDip.frequency.value = 2350; midDip.Q.value = 1.1; midDip.gain.value = -1.8;
        const highRoll = ctx.createBiquadFilter();
        highRoll.type = 'highshelf'; highRoll.frequency.value = 7800; highRoll.gain.value = -1.5;

        const dry = ctx.createGain();
        dry.gain.value = 1.28;
        dry.connect(lowShelf);
        lowShelf.connect(midDip);
        midDip.connect(highRoll);
        highRoll.connect(comp);

        const conv = ctx.createConvolver();
        conv.buffer = makeStudioHall(ctx, 2.0);
        const wet = ctx.createGain();
        wet.gain.value = 0.24;
        highRoll.connect(conv);
        conv.connect(wet);
        wet.connect(comp);

        return { pianoIn: dry, sfxIn: comp };
      }

      function schedulePianoNote(ctx, dest, note, cutTimes) {
        const root = nearestRoot(note.midi);
        const buf = buffers.get(root);
        if (!buf || note.t < 0) return;

        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = Math.pow(2, (note.midi - root) / 12);

        // Velocity-sensitive tone filter: soft notes are velvety warm, forte chords bloom open
        const vel = Math.max(0.18, Math.min(1.0, note.vel || 0.72));
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 1350 + Math.pow(vel, 1.55) * 11500;

        // Stereo soundstage: bass left (-0.34), treble right (+0.34)
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.max(-0.36, Math.min(0.36, ((note.midi - 60) / 36) * 0.34));

        // Natural damper release: longer in bass, cleaner in treble, damped cleanly before hard piece cuts!
        const registerRel = 0.42 + Math.max(0, (68 - note.midi) / 48) * 0.52;
        let stopAt = note.t + Math.max(0.08, note.dur);
        let rel = registerRel;

        // If this clip has an internal piece cut (app-03 at 1.4s / 2.8s), cleanly damp prior piece's tail at the cut!
        for (const ct of cutTimes) {
          if (note.t < ct - 0.01 && stopAt + rel > ct + 0.06) {
            stopAt = Math.min(stopAt, ct - 0.02);
            rel = Math.min(rel, 0.09);
          }
        }

        const g = ctx.createGain();
        const peak = 0.14 + Math.pow(vel, 1.45) * 0.62;
        g.gain.setValueAtTime(0.0001, note.t);
        g.gain.linearRampToValueAtTime(peak, note.t + 0.005);
        g.gain.setValueAtTime(peak, Math.max(note.t + 0.012, stopAt));
        g.gain.exponentialRampToValueAtTime(0.0001, stopAt + rel);

        src.connect(filt);
        filt.connect(g);
        g.connect(pan);
        pan.connect(dest);
        src.start(note.t);
        src.stop(stopAt + rel + 0.04);
      }

      /* Tactile, subtle Apple-style UI sound design (never loud or harsh!) */
      function scheduleSfx(ctx, dest, ev, idx) {
        const when = Math.max(0.002, ev.t);
        if (ev.kind === 'tap') {
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(240, when);
          osc.frequency.exponentialRampToValueAtTime(105, when + 0.026);
          g.gain.setValueAtTime(0.075, when);
          g.gain.exponentialRampToValueAtTime(0.0001, when + 0.032);
          osc.connect(g); g.connect(dest);
          osc.start(when); osc.stop(when + 0.038);
        } else if (ev.kind === 'toggle') {
          // Soft dual-harmonic glass slide click
          for (const [f0, f1, vol] of [[440, 290, 0.065], [880, 620, 0.028]]) {
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(f0, when);
            osc.frequency.exponentialRampToValueAtTime(f1, when + 0.032);
            g.gain.setValueAtTime(vol, when);
            g.gain.exponentialRampToValueAtTime(0.0001, when + 0.042);
            osc.connect(g); g.connect(dest);
            osc.start(when); osc.stop(when + 0.05);
          }
        } else if (ev.kind === 'key') {
          // Soft damped laptop keystroke click with subtle pitch variation
          const len = Math.floor(ctx.sampleRate * 0.018);
          const buf = ctx.createBuffer(1, len, ctx.sampleRate);
          const d = buf.getChannelData(0);
          let seed = 7001 + idx * 913;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };
          for (let i = 0; i < len; i++) d[i] = rnd() * Math.pow(1 - i / len, 3.2);
          const src = ctx.createBufferSource(); src.buffer = buf;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.Q.value = 2.2;
          bp.frequency.value = 1450 + ((idx * 173) % 380);
          const g = ctx.createGain(); g.gain.value = 0.085;
          src.connect(bp); bp.connect(g); g.connect(dest);
          src.start(when);
        } else if (ev.kind === 'whoosh' || ev.kind === 'page') {
          const dur = ev.kind === 'page' ? 0.28 : 0.24;
          const len = Math.floor(ctx.sampleRate * dur);
          const buf = ctx.createBuffer(2, len, ctx.sampleRate);
          let seed = 4242 + idx * 31;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };
          for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = rnd() * Math.sin((i / len) * Math.PI);
          }
          const src = ctx.createBufferSource(); src.buffer = buf;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass'; bp.Q.value = 1.2;
          bp.frequency.setValueAtTime(ev.kind === 'page' ? 320 : 210, when);
          bp.frequency.exponentialRampToValueAtTime(ev.kind === 'page' ? 1050 : 720, when + dur * 0.5);
          bp.frequency.exponentialRampToValueAtTime(240, when + dur);
          const g = ctx.createGain(); g.gain.value = ev.kind === 'page' ? 0.068 : 0.058;
          src.connect(bp); bp.connect(g); g.connect(dest);
          src.start(when);
        } else if (ev.kind === 'resolve') {
          // Ultra-quiet warm harmonic breath that settles cleanly into silence (NOT a piano loop!)
          const dur = 1.35;
          const len = Math.floor(ctx.sampleRate * dur);
          const buf = ctx.createBuffer(2, len, ctx.sampleRate);
          let seed = 88123;
          const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };
          for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            let lp = 0;
            for (let i = 0; i < len; i++) {
              const x = i / len;
              const env = Math.sin(Math.min(1, x * 4.5) * Math.PI * 0.5) * Math.pow(1 - x, 2.4);
              lp += 0.04 * (rnd() * env - lp);
              d[i] = lp * 0.25;
            }
          }
          const src = ctx.createBufferSource(); src.buffer = buf;
          const g = ctx.createGain(); g.gain.value = 0.35;
          src.connect(g); g.connect(dest);
          src.start(when);
        }
      }

      function encodeWavBase64(ab) {
        const nCh = ab.numberOfChannels, len = ab.length, sr = ab.sampleRate;
        const bytes = len * nCh * 2;
        const buf = new ArrayBuffer(44 + bytes);
        const v = new DataView(buf);
        const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
        ws(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); ws(8, 'WAVE');
        ws(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
        v.setUint16(22, nCh, true); v.setUint32(24, sr, true);
        v.setUint32(28, sr * nCh * 2, true); v.setUint16(32, nCh * 2, true); v.setUint16(34, 16, true);
        ws(36, 'data'); v.setUint32(40, bytes, true);
        const chs = [ab.getChannelData(0), ab.getChannelData(1)];
        let off = 44;
        for (let i = 0; i < len; i++) {
          for (let c = 0; c < nCh; c++) {
            const s = Math.max(-1, Math.min(1, chs[c][i]));
            v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
            off += 2;
          }
        }
        const u8 = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < u8.length; i += 8192) {
          bin += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
        }
        return btoa(bin);
      }

      const out = {};
      for (const [name, log] of Object.entries(allLogs)) {
        const dur = log.duration;
        const ctx = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
        const { pianoIn, sfxIn } = setupPianoBus(ctx);

        // Identify piece cut timestamps in multi-piece clips (e.g. app-03 at 1.4s and 2.8s)
        const cutTimes = [];
        let lastPiece = null;
        for (const n of log.notes || []) {
          if (lastPiece && n.piece !== lastPiece) cutTimes.push(n.t);
          lastPiece = n.piece;
        }
        cutTimes.push(dur - 0.04);

        for (const n of log.notes || []) {
          schedulePianoNote(ctx, pianoIn, n, cutTimes);
        }
        const sfxList = log.sfx || [];
        for (let i = 0; i < sfxList.length; i++) {
          scheduleSfx(ctx, sfxIn, sfxList[i], i);
        }

        // Gentle click-free master edge fade (8ms in, 140ms out)
        const ab = await ctx.startRendering();
        const fadeIn = Math.floor(SR * 0.008);
        const fadeOut = Math.floor(SR * 0.14);
        for (let ch = 0; ch < 2; ch++) {
          const d = ab.getChannelData(ch);
          for (let i = 0; i < fadeIn && i < d.length; i++) d[i] *= i / fadeIn;
          for (let i = 0; i < fadeOut && i < d.length; i++) {
            const idx = d.length - 1 - i;
            d[idx] *= i / fadeOut;
          }
        }
        out[name + '.wav'] = encodeWavBase64(ab);
      }
      return out;
    }, logs);

    for (const [name, b64] of Object.entries(wavs)) {
      const p = path.join(OUT, name);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      console.log('Wrote synced audio:', name, Math.round(fs.statSync(p).size / 1024) + ' KB');
    }
  } finally {
    await browser.close();
    srv.close();
  }
})();
