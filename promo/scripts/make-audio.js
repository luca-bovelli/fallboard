'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'promo', 'audio');
fs.mkdirSync(OUT, { recursive: true });

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
  const { srv, port } = await startServer();
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${port}/credits.html`, { waitUntil: 'load' });
    await page.addScriptTag({ url: `http://127.0.0.1:${port}/js/score.js` });

    // Load samples & render WAVs via OfflineAudioContext inside browser
    const wavs = await page.evaluate(async () => {
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

      function makeHall(ctx, dur = 2.2) {
        const len = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        let seed = 1337;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };
        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            const x = i / len;
            d[i] = rnd() * Math.pow(1 - x, 2.7) * 0.4;
          }
        }
        return buf;
      }

      function setupBus(ctx, opts = {}) {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.25;
        comp.connect(ctx.destination);

        const master = ctx.createGain();
        master.gain.value = opts.gain ?? 1.45;
        master.connect(comp);

        if (opts.hall !== false) {
          const conv = ctx.createConvolver();
          conv.buffer = makeHall(ctx, 2.1);
          const wet = ctx.createGain();
          wet.gain.value = opts.wet ?? 0.18;
          master.connect(conv);
          conv.connect(wet);
          wet.connect(comp);
        }
        return master;
      }

      function scheduleNote(ctx, dest, midi, when, dur, vel = 0.72, rateMul = 1) {
        const root = nearestRoot(midi);
        const buf = buffers.get(root);
        if (!buf || when < 0) return;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = Math.pow(2, (midi - root) / 12) * rateMul;

        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.value = 1800 + Math.pow(vel, 1.4) * 14000;

        const g = ctx.createGain();
        const peak = 0.18 + Math.pow(vel, 1.5) * 0.72;
        g.gain.setValueAtTime(0.0001, when);
        g.gain.linearRampToValueAtTime(peak, when + 0.005);
        const rel = 0.28 + Math.max(0, (60 - midi) / 40) * 0.45;
        const stopAt = when + Math.max(0.08, dur);
        g.gain.setValueAtTime(peak, Math.max(when + 0.01, stopAt));
        g.gain.exponentialRampToValueAtTime(0.0001, stopAt + rel);

        src.connect(filt); filt.connect(g); g.connect(dest);
        src.start(when);
        src.stop(stopAt + rel + 0.05);
      }

      function scheduleClick(ctx, dest, when, freq = 620, vol = 0.16) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, when);
        osc.frequency.exponentialRampToValueAtTime(freq * 0.45, when + 0.045);
        g.gain.setValueAtTime(vol, when);
        g.gain.exponentialRampToValueAtTime(0.0001, when + 0.055);
        osc.connect(g); g.connect(dest);
        osc.start(when); osc.stop(when + 0.06);
      }

      function scheduleWhoosh(ctx, dest, when, dur = 0.75, vol = 0.14) {
        const len = Math.floor(ctx.sampleRate * dur);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        let seed = 4242;
        const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 * 2 - 1; };
        for (let c = 0; c < 2; c++) {
          const d = buf.getChannelData(c);
          for (let i = 0; i < len; i++) {
            const x = i / len;
            d[i] = rnd() * Math.sin(x * Math.PI);
          }
        }
        const src = ctx.createBufferSource(); src.buffer = buf;
        const bp = ctx.createBiquadFilter();
        bp.type = 'bandpass'; bp.Q.value = 1.4;
        bp.frequency.setValueAtTime(220, when);
        bp.frequency.exponentialRampToValueAtTime(1400, when + dur * 0.55);
        bp.frequency.exponentialRampToValueAtTime(320, when + dur);
        const g = ctx.createGain(); g.gain.value = vol;
        src.connect(bp); bp.connect(g); g.connect(dest);
        src.start(when);
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

      const [balladeXml, revXml, rachXml] = await Promise.all([
        fetch('/scores/ballade-op23.musicxml').then((r) => r.text()),
        fetch('/scores/revolutionary.musicxml').then((r) => r.text()),
        fetch('/scores/rach-cs.musicxml').then((r) => r.text()),
      ]);
      const ballade = await FB.parseScore(balladeXml);
      const rev = await FB.parseScore(revXml);
      const rach = await FB.parseScore(rachXml);

      const out = {};

      // 1. pain-youtube-muffled.wav (6.0s)
      {
        const ctx = new OfflineAudioContext(2, Math.floor(6.0 * SR), SR);
        const bus = setupBus(ctx, { gain: 1.15, hall: false });
        // Fast segment 0..1.3s from Revolutionary Etude
        const filt = ctx.createBiquadFilter();
        filt.type = 'lowpass';
        filt.frequency.setValueAtTime(4200, 0);
        filt.frequency.setValueAtTime(680, 3.45); // muffled underwater 0.5x!
        filt.connect(bus);

        for (const n of rev.notes) {
          if (n.t0 >= 2.0 && n.t0 < 4.4) {
            const w = (n.t0 - 2.0) * 0.72;
            if (w < 1.32) scheduleNote(ctx, filt, n.midi, w, (n.t1 - n.t0) * 0.65, n.vel * 0.85);
          }
        }
        // Scrub clicks + stutters
        scheduleClick(ctx, bus, 1.32, 780, 0.24);
        scheduleClick(ctx, bus, 2.00, 660, 0.24);
        scheduleClick(ctx, bus, 2.45, 740, 0.22);
        scheduleClick(ctx, bus, 3.45, 520, 0.26);
        // Short stutter bursts during scrub
        for (const n of rev.notes) {
          if (n.t0 >= 1.0 && n.t0 < 1.55) scheduleNote(ctx, filt, n.midi, 1.38 + (n.t0 - 1.0), 0.14, n.vel * 0.7);
          if (n.t0 >= 3.2 && n.t0 < 3.65) scheduleNote(ctx, filt, n.midi, 2.06 + (n.t0 - 3.2), 0.12, n.vel * 0.7);
        }
        // Garbled slow 0.5x from 3.48 to 5.15
        for (const n of rev.notes) {
          if (n.t0 >= 2.0 && n.t0 < 2.95) {
            const w = 3.48 + (n.t0 - 2.0) * 1.85;
            if (w < 5.1) scheduleNote(ctx, filt, n.midi, w, 0.35, n.vel * 0.8, 0.992);
          }
        }
        scheduleWhoosh(ctx, bus, 5.05, 0.85, 0.22);
        const ab = await ctx.startRendering();
        out['pain-youtube-muffled.wav'] = encodeWavBase64(ab);
      }

      // 2. pain-frankenstein-sfx.wav (6.5s)
      {
        const ctx = new OfflineAudioContext(2, Math.floor(6.5 * SR), SR);
        const bus = setupBus(ctx, { gain: 1.35, wet: 0.24 });
        // 4 rhythmic card slams + tense low piano hits
        const hits = [
          [0.15, 43, 520],
          [1.25, 46, 590],
          [2.35, 50, 680],
          [3.40, 54, 780],
        ];
        for (const [t, midi, f] of hits) {
          scheduleClick(ctx, bus, t, f, 0.22);
          scheduleNote(ctx, bus, midi, t, 0.45, 0.55);
        }
        scheduleWhoosh(ctx, bus, 4.70, 0.85, 0.24);
        // Warm, serene G-minor resolution chord as "Meet Fallboard." appears
        for (const m of [43, 55, 62, 67, 70, 74]) {
          scheduleNote(ctx, bus, m, 5.20, 1.25, 0.64);
        }
        const ab = await ctx.startRendering();
        out['pain-frankenstein-sfx.wav'] = encodeWavBase64(ab);
      }

      // 3. chopin-ballade-bed.wav (36.0s — iconic Ballade No. 1 theme starting from t=46.5s)
      {
        const ctx = new OfflineAudioContext(2, Math.floor(36.0 * SR), SR);
        const bus = setupBus(ctx, { gain: 1.45, wet: 0.22 });
        const startT = 46.5;
        for (const n of ballade.notes) {
          if (n.t0 >= startT && n.t0 < startT + 34.5) {
            const w = n.t0 - startT + 0.15;
            const fade = w > 31.5 ? Math.max(0.05, 1 - (w - 31.5) / 3.5) : 1;
            scheduleNote(ctx, bus, n.midi, w, Math.min(3.5, n.t1 - n.t0), n.vel * 0.88 * fade);
          }
        }
        const ab = await ctx.startRendering();
        out['chopin-ballade-bed.wav'] = encodeWavBase64(ab);
      }

      // 4. chopin-step-demo.wav (15.0s — crisp onset steps then smooth play, synced to short-01)
      {
        const ctx = new OfflineAudioContext(2, Math.floor(15.0 * SR), SR);
        const bus = setupBus(ctx, { gain: 1.5, wet: 0.22 });
        const onsets = ballade.onsets.both.filter((t) => t >= 47.0);
        // 4 clean manual steps at 0.35, 1.15, 1.95, 2.75
        for (let k = 0; k < 4; k++) {
          const ot = onsets[k];
          const when = 0.35 + k * 0.8;
          for (const n of ballade.notes) {
            if (Math.abs(n.t0 - ot) < 0.02) {
              scheduleNote(ctx, bus, n.midi, when, 0.72, Math.min(0.9, n.vel * 0.95));
            }
          }
        }
        // Left hand isolated gentle melody 3.8..7.0s
        const lhStart = onsets[4];
        for (const n of ballade.notes) {
          if (n.hand === 1 && n.t0 >= lhStart && n.t0 < lhStart + 3.2) {
            scheduleNote(ctx, bus, n.midi, 3.8 + (n.t0 - lhStart), Math.min(2.0, n.t1 - n.t0), n.vel * 0.9);
          }
        }
        // Both hands 50% speed then normal 7.2..14.5s
        const bothStart = lhStart + 3.2;
        for (const n of ballade.notes) {
          if (n.t0 >= bothStart && n.t0 < bothStart + 5.5) {
            const w = 7.2 + (n.t0 - bothStart) * 1.25;
            if (w < 14.3) scheduleNote(ctx, bus, n.midi, w, Math.min(2.4, (n.t1 - n.t0) * 1.25), n.vel * 0.88);
          }
        }
        const ab = await ctx.startRendering();
        out['chopin-step-demo.wav'] = encodeWavBase64(ab);
      }

      // 5. rach-cs-bed.wav (18.0s — iconic C# minor opening!)
      {
        const ctx = new OfflineAudioContext(2, Math.floor(18.0 * SR), SR);
        const bus = setupBus(ctx, { gain: 1.45, wet: 0.25 });
        for (const n of rach.notes) {
          if (n.t0 < 16.5) {
            const w = n.t0 + 0.15;
            const fade = w > 14.5 ? Math.max(0.05, 1 - (w - 14.5) / 2.5) : 1;
            scheduleNote(ctx, bus, n.midi, w, Math.min(4.0, n.t1 - n.t0), n.vel * 0.92 * fade);
          }
        }
        const ab = await ctx.startRendering();
        out['rach-cs-bed.wav'] = encodeWavBase64(ab);
      }

      return out;
    });

    for (const [name, b64] of Object.entries(wavs)) {
      const p = path.join(OUT, name);
      fs.writeFileSync(p, Buffer.from(b64, 'base64'));
      console.log('Wrote audio:', name, Math.round(fs.statSync(p).size / 1024) + ' KB');
    }
  } finally {
    await browser.close();
    srv.close();
  }
})();
