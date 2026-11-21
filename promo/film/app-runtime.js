/* Installed in the app's frame (not the film's) before any of its scripts run. Time is virtual:
   performance.now, requestAnimationFrame, timers and CSS animations advance only when the film
   says so, one frame at a time, so every frame shows exactly the moment it stands for however
   long it took to draw. The app's AudioContext is replaced by a silent one on the same clock, and
   the film records what the app asks the piano to play, which becomes the soundtrack. */
(function () {
  'use strict';
  if (window === window.top) return;

  try {
    localStorage.setItem('fallboard:v1', JSON.stringify({
      last: 'chopin-op10-12', view: 'roll', hand: 'both', speed: 1,
      recent: [
        { id: 'chopin-op10-12', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12', open: { kind: 'builtin', file: 'revolutionary' } },
        { id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23', open: { kind: 'builtin', file: 'ballade-op23' } },
      ],
      pos: { 'chopin-op10-12': 14.55 },
    }));
  } catch (e) { /* storage blocked */ }

  let vNow = 10000;
  const timers = new Map();
  let timerId = 1, rafId = 1;
  const rafQueue = new Map();
  const starts = new WeakMap();

  performance.now = () => vNow;
  window.requestAnimationFrame = (cb) => { const id = rafId++; rafQueue.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { rafQueue.delete(id); };
  window.setTimeout = (fn, ms, ...args) => { const id = timerId++; timers.set(id, { due: vNow + Math.max(0, +ms || 0), fn, args }); return id; };
  window.setInterval = (fn, ms, ...args) => { const every = Math.max(1, +ms || 0); const id = timerId++; timers.set(id, { due: vNow + every, fn, args, every }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };

  function syncAnimations() {
    void document.documentElement.offsetHeight;
    for (const a of document.getAnimations()) {
      let s = starts.get(a);
      if (s === undefined) { s = vNow; starts.set(a, s); }
      try { a.pause(); a.currentTime = Math.max(0, vNow - s); } catch (e) { /* finished or gone */ }
    }
  }
  function runTimers(until) {
    for (let guard = 0; guard < 10000; guard++) {
      let next = null, nextId = 0;
      for (const [id, t] of timers) if (t.due <= until && (!next || t.due < next.due)) { next = t; nextId = id; }
      if (!next) return;
      vNow = Math.max(vNow, next.due);
      if (next.every) next.due += next.every; else timers.delete(nextId);
      try { typeof next.fn === 'function' ? next.fn(...next.args) : 0; } catch (e) { console.error(e); }
    }
  }
  window.__vclock = {
    now: () => vNow,
    /* forward by ms: due timers fire in order, then one animation frame is drawn */
    advance(ms) {
      const target = vNow + ms;
      runTimers(target);
      vNow = target;
      syncAnimations();
      const q = [...rafQueue.values()];
      rafQueue.clear();
      for (const cb of q) { try { cb(vNow); } catch (e) { console.error(e); } }
      syncAnimations();
    },
    sync: syncAnimations,
  };

  /* a silent AudioContext whose clock is the virtual one */
  class Param {
    constructor(v) { this.value = v; }
    setValueAtTime() { return this; } setTargetAtTime() { return this; } linearRampToValueAtTime() { return this; }
    exponentialRampToValueAtTime() { return this; } cancelScheduledValues() { return this; } cancelAndHoldAtTime() { return this; }
  }
  const node = () => ({
    connect() {}, disconnect() {}, start() {}, stop() {}, onended: null, buffer: null, type: '',
    gain: new Param(1), frequency: new Param(0), Q: new Param(0), playbackRate: new Param(1),
    threshold: new Param(0), knee: new Param(0), ratio: new Param(1), attack: new Param(0), release: new Param(0),
  });
  class SilentAudioContext {
    constructor() { this.sampleRate = 48000; this.state = 'running'; this.destination = node(); this.onstatechange = null; }
    get currentTime() { return vNow / 1000; }
    resume() { return Promise.resolve(); } suspend() { return Promise.resolve(); } close() { return Promise.resolve(); }
    createGain() { return node(); } createBiquadFilter() { return node(); } createDynamicsCompressor() { return node(); }
    createConvolver() { return node(); } createBufferSource() { return node(); } createOscillator() { return node(); }
    createBuffer(ch, len, sr) { return { numberOfChannels: ch, length: len, sampleRate: sr, getChannelData: () => new Float32Array(len) }; }
  }
  window.AudioContext = SilentAudioContext;
  window.webkitAudioContext = SilentAudioContext;
  window.__silentParam = Param;

  document.addEventListener('DOMContentLoaded', () => {
    const style = document.createElement('style');
    style.textContent = '*:focus, *:focus-visible { outline: none !important; }';
    document.head.appendChild(style);
  });
})();
