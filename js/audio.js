/* Fallboard — audio.js
   A sampled grand piano on Web Audio. Thirty recorded notes of the Salamander Grand Piano
   (a Yamaha C5, one every minor third) are pitch-shifted by at most a semitone to cover the
   keyboard. Velocity shapes level and brightness, a released key is damped the way felt does
   it, slower in the bass, and a short hall sits behind everything. */
(function () {
  'use strict';
  const FB = (window.FB = window.FB || {});

  /* iOS puts Web Audio in the "ambient" category, which the ring/silent switch mutes; Safari still
     shows its speaker icon. Two remedies, both needed: ask for the playback category before any
     AudioContext exists (iOS 17+), and keep a silent media element playing, which moves the page
     into the playback category on every iOS version. */
  const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* optional */ }

  const NAMES = ['A', 'C', 'Ds', 'Fs'];
  const ROOTS = [];     // { midi, file }
  for (let m = 21; m <= 108; m += 3) {
    const pc = m % 12, oct = Math.floor(m / 12) - 1;
    ROOTS.push({ midi: m, file: NAMES[[9, 0, 3, 6].indexOf(pc)] + oct + '.mp3' });
  }

  class Piano {
    constructor(base) {
      this.base = base || 'samples/';
      this.ctx = null;
      this.buffers = new Map();   // root midi -> AudioBuffer
      this.voices = new Set();
      this.loaded = 0;
      this.total = ROOTS.length;
      this.failed = false;
      this.loading = null;
      this.onProgress = null;
    }

    get ready() { return this.loaded >= this.total; }
    get usable() { return this.buffers.size >= 8; }

    /* fetch and decode the recordings; safe to call before any user gesture */
    preload() {
      if (this.loading) return this.loading;
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const dec = OAC ? new OAC(2, 2, 44100) : null;
      const decode = (buf) => new Promise((res, rej) => {
        const target = dec || this.ensure();
        const p = target.decodeAudioData(buf, res, rej);
        if (p && p.then) p.then(res, rej);
      });
      // middle of the keyboard first, so a quick first tap already has its neighbours
      const order = ROOTS.slice().sort((a, b) => Math.abs(a.midi - 62) - Math.abs(b.midi - 62));
      let next = 0, bad = 0;
      const worker = async () => {
        while (next < order.length) {
          const r = order[next++];
          try {
            const res = await fetch(this.base + r.file);
            if (!res.ok) throw new Error(String(res.status));
            this.buffers.set(r.midi, await decode(await res.arrayBuffer()));
          } catch (e) { bad++; }
          this.loaded++;
          if (this.onProgress) this.onProgress(this.loaded / this.total);
        }
      };
      this.loading = Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]).then(() => {
        this.failed = this.buffers.size === 0;
        if (this.onProgress) this.onProgress(1);
        return !this.failed;
      });
      return this.loading;
    }

    /* call synchronously inside a tap or click: starts (or restarts) audio the way iOS requires */
    unlock() {
      const ctx = this.ensure();
      if (!this.primed) {
        // one silent frame through the graph: older iOS only opens the output for a sound started in a gesture
        try {
          const b = ctx.createBuffer(1, 1, ctx.sampleRate);
          const s = ctx.createBufferSource();
          s.buffer = b; s.connect(ctx.destination); s.start(0);
          this.primed = true;
        } catch (e) { /* try again on the next tap */ }
      }
      if (IOS) {
        if (!this.keeper) {
          const a = (this.keeper = document.createElement('audio'));
          a.src = this.base + 'silence.mp3';
          a.loop = true;
          a.preload = 'auto';
          a.setAttribute('playsinline', '');
          a.setAttribute('x-webkit-airplay', 'deny');
          a.disableRemotePlayback = true;
          a.volume = 0.01;
          document.addEventListener('visibilitychange', () => { if (document.hidden) a.pause(); });
        }
        if (this.keeper.paused && !document.hidden) {
          const p = this.keeper.play();
          if (p && p.catch) p.catch(() => {});
        }
      }
      return ctx;
    }

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
        // Safari reports "interrupted" after a call or another app took the audio; the next tap resumes it
        ctx.onstatechange = () => { if (ctx.state !== 'running') this.primed = false; };
        const limit = ctx.createDynamicsCompressor();
        limit.threshold.value = -9; limit.knee.value = 10; limit.ratio.value = 6;
        limit.attack.value = 0.003; limit.release.value = 0.25;
        limit.connect(ctx.destination);
        this.bus = ctx.createGain();
        this.bus.gain.value = 1.5;      // the recordings peak near -10 dB; the limiter catches full chords
        this.bus.connect(limit);
        const hall = ctx.createConvolver();
        hall.buffer = this.impulse(ctx, 2.4);
        const send = ctx.createGain();
        send.gain.value = 0.16;
        this.bus.connect(send); send.connect(hall); hall.connect(limit);
      }
      if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
      return this.ctx;
    }

    /* a small concert room: a sparse cluster of early reflections, then a darkening tail */
    impulse(ctx, seconds) {
      const sr = ctx.sampleRate, len = Math.floor(sr * seconds);
      const buf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let lp = 0;
        for (let i = 0; i < len; i++) {
          const t = i / sr;
          const k = 0.22 + 0.5 * Math.exp(-t * 2.2);              // the tail loses its top end
          lp += k * ((Math.random() * 2 - 1) - lp);
          const rise = Math.min(1, t / 0.012);
          d[i] = lp * rise * Math.exp(-t * 3.1);
        }
        for (let r = 0; r < 7; r++) {
          const at = Math.floor(sr * (0.006 + Math.random() * 0.045));
          d[at] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - r * 0.05);
        }
      }
      return buf;
    }

    root(midi) {
      let best = null, bd = 99;
      for (const m of this.buffers.keys()) {
        const d = Math.abs(m - midi);
        if (d < bd || (d === bd && m < best)) { bd = d; best = m; }
      }
      return best;
    }

    /* when: AudioContext time. dur: seconds until the key (or the pedal) lets go. vel: 0..1 */
    noteOn(midi, when, dur, vel) {
      const ctx = this.ctx;
      if (!ctx) return null;
      const root = this.root(midi);
      if (root === null) return null;
      if (this.voices.size > 96) {
        const it = this.voices.values();
        for (let i = 0; i < 10; i++) { const v = it.next().value; if (v) this.kill(v, ctx.currentTime); }
      }
      vel = Math.max(0.05, Math.min(1, vel));
      const src = ctx.createBufferSource();
      src.buffer = this.buffers.get(root);
      src.playbackRate.value = Math.pow(2, (midi - root) / 12);

      // a soft touch is darker as well as quieter
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 0.3;
      lp.frequency.value = Math.min(19000, 900 + f0 * 2 + Math.pow(vel, 1.8) * 15000);

      const g = ctx.createGain();
      const level = 0.16 + 0.84 * Math.pow(vel, 1.7);
      const treble = 1 + Math.max(0, (midi - 72) / 36) * 0.35;      // the top octaves record quietly
      g.gain.setValueAtTime(level * treble, when);

      // dampers: the bass rings on a moment, the top has none at all
      const off = when + Math.max(0.05, dur);
      const release = midi > 90 ? 0.5 : 0.07 + 0.2 * Math.pow(2, -(midi - 21) / 22);
      g.gain.setTargetAtTime(0, off, release);

      src.connect(lp); lp.connect(g); g.connect(this.bus);
      src.start(when, 0.009);           // every recording opens with about 10 ms of silence
      src.stop(off + release * 7 + 0.05);
      const v = { src, g };
      this.voices.add(v);
      src.onended = () => { this.voices.delete(v); try { g.disconnect(); } catch (e) { /* gone */ } };
      return v;
    }

    kill(v, now) {
      try {
        if (v.g.gain.cancelAndHoldAtTime) v.g.gain.cancelAndHoldAtTime(now); else v.g.gain.cancelScheduledValues(now);
        v.g.gain.setTargetAtTime(0, now, 0.03);
        v.src.stop(now + 0.25);
      } catch (e) { /* already stopped */ }
      this.voices.delete(v);
    }

    stopAll() {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      for (const v of [...this.voices]) this.kill(v, now);
    }
  }

  Piano.IOS = IOS;
  FB.Piano = Piano;
})();
