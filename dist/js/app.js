/* Fallboard — app.js
   Transport, falling-note roll, keyboard, and the glue between them. */
(function () {
  'use strict';
  const FB = window.FB;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const EPS = 2e-3;
  const MIN_W = 10, MAX_W = 44, BLACK_W = 0.58, BLACK_H = 0.62;
  const SPEEDS = [0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1, 1.25, 1.5, 1.75, 2];

  const BUILTINS = [
    { id: 'chopin-op23', file: 'ballade-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23' },
    { id: 'rachmaninoff-op3-2', file: 'rach-cs', title: 'Prelude in C♯ minor', composer: 'Sergei Rachmaninoff, Op. 3 No. 2' },
    { id: 'rachmaninoff-op23-5', file: 'rach-gm', title: 'Prelude in G minor', composer: 'Sergei Rachmaninoff, Op. 23 No. 5' },
    { id: 'rachmaninoff-op23-2', file: 'rach-bb', title: 'Prelude in B♭ major', composer: 'Sergei Rachmaninoff, Op. 23 No. 2' },
    { id: 'chopin-op10-12', file: 'revolutionary', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12' },
  ];

  /* white-key bookkeeping, counted from A0 (MIDI 21) */
  const WB = new Int16Array(130);       // white keys in [21, m)
  const WHITE_MIDI = [];
  for (let m = 0, n = 0; m < 130; m++) {
    WB[m] = n;
    if (m >= 21 && m <= 108 && !FB.isBlack(m)) { WHITE_MIDI.push(m); n++; }
  }
  const N_WHITE = WHITE_MIDI.length;    // 52

  const store = {
    get() { try { return JSON.parse(localStorage.getItem('fallboard:v1')) || {}; } catch (e) { return {}; } },
    set(o) { try { localStorage.setItem('fallboard:v1', JSON.stringify(o)); } catch (e) { /* private mode */ } },
  };
  const saved = store.get();

  const S = {
    score: null, meta: null,
    hand: ['both', 'L', 'R'].includes(saved.hand) ? saved.hand : 'both',
    view: saved.view === 'score' ? 'score' : 'roll',
    speed: SPEEDS.includes(saved.speed) ? saved.speed : 1,
    pps: saved.pps > 0 ? clamp(saved.pps, 30, 800) : 0,
    playing: false,
    t: 0, anchorT: 0, anchorCtx: 0, schedIdx: 0,
    viewT: null,          // roll scrolled away from playback: the time shown at the keyboard edge
    offset: 0,            // attached: shown time minus live time, eased to zero
    inertia: 0,
  };
  const G = { width: 0, height: 0, W: 20, left: 0, tW: 20, tLeft: 0, fit: [0, N_WHITE], manual: false, holdUntil: 0 };
  const R = { w: 0, h: 0 };
  const piano = new FB.Piano();
  const pressed = new Set();
  const theme = {};

  const el = {
    app: $('app'), title: $('title'), composer: $('composer'), where: $('where'), tempo: $('tempo'),
    roll: $('roll'), kbd: $('kbd'), stage: $('stage'), kbdWrap: $('kbdWrap'),
    notation: $('notation'), pages: $('pages'),
    live: $('liveBtn'), status: $('status'), toast: $('toast'),
    play: $('playBtn'), prev: $('prevBtn'), next: $('nextBtn'),
    whereOf: $('whereOf'), tempoBox: $('tempoBox'),
    barReadout: $('barReadout'), clock: $('clock'),
    speedOut: $('speedOut'), speedReset: $('speedReset'), speed: $('speed'), speedTrack: $('speedTrack'),
    speedTicks: $('speedTicks'), speedThumb: $('speedThumb'),
    viewSeg: $('viewSeg'), handSeg: $('handSeg'),
    handSlot: $('handSlot'), handToggle: $('handToggle'), speedSlot: $('speedSlot'), speedToggle: $('speedToggle'),
    steps: $('steps'), railShield: $('railShield'),
    menuBtn: $('menuBtn'), menu: $('menu'), openBtn: $('openBtn'), builtinScores: $('builtinScores'), file: $('fileInput'),
    deck: $('deck'), rail: $('rail'), toastText: $('toastText'),
    scrub: $('scrub'), scrubThumb: $('scrubThumb'), scrubLabel: $('scrubLabel'), scrubText: $('scrubText'),
  };
  const rc = el.roll.getContext('2d');
  const kc = el.kbd.getContext('2d');

  /* ------------------------------------------------------------------ helpers */
  const handOK = (n) => S.hand === 'both' || (S.hand === 'R' ? n.hand === 0 : n.hand === 1);
  const handKey = () => (S.score && S.score.hasHands ? S.hand : 'both');

  function lowerT0(t) {
    const a = S.score.notes;
    let lo = 0, hi = a.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid].t0 < t) lo = mid + 1; else hi = mid; }
    return lo;
  }
  function now() {
    if (!S.playing) return S.t;
    return Math.min(S.score.duration, S.anchorT + Math.max(0, piano.ctx.currentTime - S.anchorCtx) * S.speed);
  }
  const dispTime = () => (S.viewT !== null ? S.viewT : now() + S.offset);
  const fmt = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };

  let frameQueued = false;
  function kick() { if (!frameQueued) { frameQueued = true; requestAnimationFrame(frame); } }

  /* ------------------------------------------------------------------ glass
     The floating controls use the Graph Notes glass material (js/glass.js, built from its
     src/rendering/glass). One renderer serves the controls over the music and refracts a copy
     of what lies beneath them, the roll canvas or the engraved systems; a second serves the
     controls under the keys, where the scene is the black page and never changes. */
  let sceneV = 0, glassUntil = 0, footTicks = 40;
  let glassTop = null, glassFoot = null;
  function glassKick() { glassUntil = performance.now() + 500; kick(); }
  function initGlass() {
    const GL = window.FBGlass;
    if (!GL) return;
    try {
      // like Graph Notes itself, full glass is the default; only a request for more contrast turns it off
      const reducedTransparency = () => window.matchMedia('(prefers-contrast: more)').matches;
      glassTop = new GL.GlassBackdrop({ root: () => el.stage, reducedTransparency });
      GL.attachGlassMaterials(glassTop, el.deck);
      glassFoot = new GL.GlassBackdrop({ root: () => el.rail, reducedTransparency });
      GL.attachGlassMaterials(glassFoot, el.rail);
    } catch (e) { glassTop = glassFoot = null; }
  }
  function paintScene(ctx) {
    const w = el.stage.clientWidth, h = el.stage.clientHeight;
    if (S.view === 'roll') {
      if (el.roll.width > 1) ctx.drawImage(el.roll, 0, 0, w, h);
      return;
    }
    ctx.fillStyle = theme.stage;
    ctx.fillRect(0, 0, w, h);
    const sr = el.stage.getBoundingClientRect();
    const bands = [];
    for (const g of el.deck.querySelectorAll('.glass-material')) {
      const r = g.getBoundingClientRect();
      if (r.height > 0) bands.push([r.top - 24, r.bottom + 24]);
    }
    notation.paint(ctx, sr, bands, theme);
  }
  function updateGlass(ms) {
    if (!glassTop) return false;
    if (S.view === 'roll') sceneV++;
    glassTop.update(el.stage.clientWidth, el.stage.clientHeight, ms, paintScene, String(sceneV));
    let busy = ms < glassUntil;
    if (footTicks > 0) {
      footTicks--;
      glassFoot.update(el.rail.clientWidth, el.rail.clientHeight, ms, () => {}, 'page');
      busy = true;
    }
    return busy;
  }

  function persist() {
    const o = store.get();
    o.hand = S.hand; o.view = S.view; o.speed = S.speed; o.pps = S.pps;
    if (S.meta) { o.pos = o.pos || {}; o.pos[S.meta.id] = Math.round(now() * 1e4) / 1e4; }
    store.set(o);
  }

  /* ------------------------------------------------------------------ transport */
  let timer = null, wakeLock = null;
  let pageActive = !document.hidden;

  function schedule() {
    if (!S.playing) return;
    const ctx = piano.ctx, t = now(), notes = S.score.notes;
    if (t >= S.score.duration - 1e-3) { pause(); return; }
    const horizon = t + 0.3 * S.speed + 0.05;
    while (S.schedIdx < notes.length && notes[S.schedIdx].t0 < horizon) {
      const n = notes[S.schedIdx++];
      if (!handOK(n)) continue;
      const when = S.anchorCtx + (n.t0 - S.anchorT) / S.speed;
      if (when < ctx.currentTime - 0.06) continue;
      piano.noteOn(n.midi, Math.max(when, ctx.currentTime), (n.tOff - n.t0) / S.speed, n.vel);
    }
  }

  function reanchor(t) {
    S.anchorT = t;
    S.anchorCtx = piano.ctx.currentTime + 0.07;
    S.schedIdx = lowerT0(t - 1e-4);
  }

  function attach(glideFrom) {
    if (S.viewT !== null || glideFrom !== undefined) {
      const from = glideFrom !== undefined ? glideFrom : S.viewT;
      S.viewT = null;
      S.offset = from - now();
    }
    S.inertia = 0;
    notation.attach();
    syncLiveBtn();
  }

  let waitingForPiano = null;
  function play() {
    if (!pageActive || !S.score || S.playing) return;
    if (!piano.usable && !piano.ready) {
      // the recordings are still arriving: start as soon as they are in
      piano.ensure();
      if (waitingForPiano) return;
      const request = (waitingForPiano = {});
      status('Tuning the piano…');
      piano.preload().then(() => {
        if (waitingForPiano !== request) return;
        waitingForPiano = null;
        status(null);
        if (!piano.failed) play();
        else toast('The piano recordings could not be loaded. Check the connection and reload.');
      });
      return;
    }
    if (waitingForPiano) {
      waitingForPiano = null;
      status(null);
    }
    if (S.t >= S.score.duration - 0.05) S.t = 0;
    const shown = dispTime();
    piano.ensure();
    piano.stopAll();
    reanchor(S.t);
    S.playing = true;
    attach(shown);
    clearInterval(timer);
    const playbackTimer = (timer = setInterval(schedule, 25));
    schedule();
    navigator.wakeLock?.request('screen').then((lock) => {
      if (pageActive && S.playing && timer === playbackTimer) wakeLock = lock;
      else return lock.release();
    }).catch(() => {});
    syncPlayBtn();
    kick();
  }

  function pause() {
    if (!S.playing) return;
    const shown = dispTime();
    S.t = now();
    S.playing = false;
    clearInterval(timer);
    timer = null;
    piano.stopAll();
    attach(shown);
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
    syncPlayBtn();
    persist();
    kick();
  }

  /* jump the playback position; the view glides (or snaps) back onto it */
  function seek(t, { sound = false, snap = false } = {}) {
    if (!S.score) return;
    const shown = dispTime();
    t = clamp(t, 0, S.score.duration);
    if (S.playing) { piano.stopAll(); reanchor(t); }
    S.t = t;
    attach(snap ? t : shown);
    if (sound && !S.playing) soundOnset(t);
    kick();
  }

  function soundOnset(t) {
    if (!pageActive) return;
    const notes = S.score.notes;
    const ctx = piano.ensure();
    for (let i = lowerT0(t - EPS); i < notes.length && notes[i].t0 <= t + EPS; i++) {
      const n = notes[i];
      if (handOK(n)) piano.noteOn(n.midi, ctx.currentTime + 0.012, clamp((n.t1 - n.t0) / S.speed, 0.45, 6), n.vel);
    }
  }

  function step(dir) {
    if (!S.score) return;
    const cur = now();
    if (S.playing) pause();
    const on = S.score.onsets[handKey()];
    let lo = 0, hi = on.length;
    if (dir > 0) {
      while (lo < hi) { const mid = (lo + hi) >> 1; if (on[mid] <= cur + EPS) lo = mid + 1; else hi = mid; }
      if (lo < on.length) seek(on[lo], { sound: true });
    } else {
      while (lo < hi) { const mid = (lo + hi) >> 1; if (on[mid] < cur - EPS) lo = mid + 1; else hi = mid; }
      if (lo > 0) seek(on[lo - 1], { sound: true });
    }
  }

  /* notes held at time t (key highlights) */
  function heldAt(t, playing) {
    const out = new Map();
    if (!S.score) return out;
    const notes = S.score.notes;
    for (let i = lowerT0(t - S.score.maxDur - EPS); i < notes.length && notes[i].t0 <= t + EPS; i++) {
      const n = notes[i];
      if (!handOK(n)) continue;
      const end = playing ? n.t1 - Math.min(0.035, (n.t1 - n.t0) * 0.25) : n.t1 - EPS;
      if (end > t) out.set(n.midi, n.hand);
    }
    return out;
  }

  /* ------------------------------------------------------------------ keyboard geometry */
  const keyX = (m) => (FB.isBlack(m) ? (WB[m] - G.left) * G.W - (G.W * BLACK_W) / 2 : (WB[m] - G.left) * G.W);

  function fitKeys(animate) {
    const width = G.width;
    if (!width) return;
    let lo = 21, hi = 108;
    if (S.score) {
      const r = S.score.range[handKey()];
      if (r[0] <= r[1]) { lo = clamp(r[0] - 1, 21, 108); hi = clamp(r[1] + 1, 21, 108); }
    }
    let i0 = WB[lo] - (FB.isBlack(lo) ? 1 : 0), i1 = WB[hi] + 1;
    if (i1 - i0 < 15) { const c = (i0 + i1) / 2; i0 = c - 7.5; i1 = c + 7.5; }
    if (width / (i1 - i0) > MAX_W) { const span = Math.min(N_WHITE, width / MAX_W), c = (i0 + i1) / 2; i0 = c - span / 2; i1 = c + span / 2; }
    if (i0 < 0) { i1 -= i0; i0 = 0; }
    if (i1 > N_WHITE) { i0 = Math.max(0, i0 - (i1 - N_WHITE)); i1 = N_WHITE; }
    G.fit = [i0, i1];
    if (!G.manual) {
      G.tW = Math.max(width / (i1 - i0), MIN_W);
      const vis = width / G.tW;
      G.tLeft = clamp(vis >= i1 - i0 - 0.01 ? i0 : G.tLeft, 0, Math.max(0, N_WHITE - vis));
    } else {
      G.tW = Math.max(G.tW, width / N_WHITE);
      G.tLeft = clamp(G.tLeft, 0, Math.max(0, N_WHITE - width / G.tW));
    }
    if (!animate) { G.W = G.tW; G.left = G.tLeft; }
    lastFollow = 0;
    kick();
  }

  let lastFollow = 0;
  function follow(t, ms) {
    if (!S.score || ms < G.holdUntil || ms - lastFollow < 110) return;
    lastFollow = ms;
    const vis = G.width / G.tW;
    if (G.fit[1] - G.fit[0] <= vis + 0.01 && !G.manual) return;
    const look = S.view === 'roll' ? Math.min(R.h / S.pps, 4) : 1.2;
    const notes = S.score.notes;
    let lo = 200, hi = -1;
    for (let i = lowerT0(t - S.score.maxDur - EPS); i < notes.length && notes[i].t0 < t + look; i++) {
      const n = notes[i];
      if (!handOK(n) || n.t1 <= t) continue;
      if (n.midi < lo) lo = n.midi;
      if (n.midi > hi) hi = n.midi;
    }
    if (hi < 0) return;
    const a = WB[lo] - 1, b = WB[hi] + 2;
    let target;
    if (b - a >= vis) target = (a + b) / 2 - vis / 2;
    else if (a < G.tLeft) target = a;
    else if (b > G.tLeft + vis) target = b - vis;
    else return;
    G.tLeft = clamp(target, 0, Math.max(0, N_WHITE - vis));
  }

  /* ------------------------------------------------------------------ drawing */
  const TOKENS = ['stage', 'lane', 'grid', 'grid-2', 'grid-ink', 'rh', 'rh-key', 'rh-hot', 'lh', 'lh-key', 'lh-hot', 'bar-ink',
    'now', 'brass', 'brass-lo', 'blue', 'blue-lo', 'paper', 'score-ink',
    'key-a', 'key-b', 'key-c', 'key-ink', 'ebony-a', 'ebony-b', 'ebony-c'];
  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    for (const k of TOKENS) theme[k] = cs.getPropertyValue('--' + k).trim();
    sceneV++;
  }
  /* '#rrggbb' -> 'rgba(r,g,b,a)' */
  function alpha(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function sizeCanvas(canvas, ctx, box) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(box.clientWidth)), h = Math.max(1, Math.round(box.clientHeight));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return [w, h];
  }

  /* rounded rectangle; rb is the radius of the two bottom corners when it differs */
  function rr(c, x, y, w, h, r, rb) {
    if (rb === undefined) rb = r;
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    rb = Math.max(0, Math.min(rb, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, rb);
    c.arcTo(x, y + h, x, y, rb);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  const beatUnit = (time) => (time.beatType === 8 && time.beats % 3 === 0 && time.beats > 3 ? 1.5 : 4 / time.beatType);
  const UI_FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", Inter, "Segoe UI", system-ui, sans-serif';

  const readouts = [el.barReadout, el.clock];
  let progressBounds = null, scoreObscured = null;
  function measureProgress() {
    const stage = el.stage.getBoundingClientRect();
    const readoutRects = readouts.map((readout) => readout.getBoundingClientRect());
    progressBounds = {
      readouts: readoutRects,
      roll: readoutRects.map((rect) => ({
        left: rect.left - stage.left - 2, right: rect.right - stage.left + 2,
        top: rect.top - stage.top - 2, bottom: rect.bottom - stage.top + 2,
      })),
    };
    scoreObscured = null;
  }

  function drawRoll(disp, live) {
    const c = rc, w = R.w, h = R.h, pps = S.pps, sc = S.score;
    c.fillStyle = theme.stage;
    c.fillRect(0, 0, w, h);
    const W = G.W, left = G.left, bw = W * BLACK_W;
    const mLo = WHITE_MIDI[clamp(Math.floor(left), 0, N_WHITE - 1)];
    const mHi = WHITE_MIDI[clamp(Math.ceil(left + w / W), 0, N_WHITE - 1)];

    /* pitch grid: a lane under every black key, a line at every C and a fainter one at every F */
    c.fillStyle = theme.lane;
    for (let m = mLo; m <= mHi; m++) if (FB.isBlack(m)) c.fillRect(keyX(m), 0, bw, h);
    for (let m = mLo; m <= mHi + 1; m++) {
      const pc = m % 12;
      if (pc !== 0 && pc !== 5) continue;
      c.fillStyle = pc === 0 ? theme['grid-2'] : theme.grid;
      c.fillRect(Math.round((WB[m] - left) * W), 0, 1, h);
    }
    if (!sc) {
      for (const readout of readouts) readout.classList.remove('is-obscured');
      return;
    }
    const Y = (t) => h - (t - disp) * pps;
    const tTop = disp + h / pps;

    /* time grid: bar lines with their numbers, beat lines when there is room */
    const labels = [];
    for (let oi = sc.measureAt(Math.max(0, disp)); oi < sc.measures.length; oi++) {
      const o = sc.measures[oi];
      if (o.t > tTop) break;
      const tEnd = oi + 1 < sc.measures.length ? sc.measures[oi + 1].t : sc.duration;
      const unit = beatUnit(o.time);
      const nb = Math.max(1, Math.round(o.lenQ / unit));
      if (((tEnd - o.t) / nb) * pps >= 14) {
        c.fillStyle = theme.grid;
        for (let k = 1; k < nb; k++) {
          const y = Math.round(Y(sc.beatToSec(o.beat + k * unit)));
          if (y >= 0 && y <= h) c.fillRect(0, y, w, 1);
        }
      }
      const y = Math.round(Y(o.t));
      if (y >= 0 && y <= h) {
        c.fillStyle = theme['grid-2'];
        c.fillRect(0, y, w, 1);
        labels.push([o.number, y]);
      }
    }

    /* notes: white-key notes first, black-key notes over them; sounding notes last so they glow on top */
    const notes = sc.notes;
    const start = lowerT0(disp - sc.maxDur - EPS);
    const fontPx = clamp(W * 0.46, 8.5, 11.5);
    const inset = Math.min(1.5, W * 0.07);
    const hot = [];
    const [bar, clock] = progressBounds.roll;
    let barObscured = false, clockObscured = false;
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = `700 ${fontPx}px ${UI_FONT}`;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = start; i < notes.length && notes[i].t0 < tTop; i++) {
        const n = notes[i];
        if (n.t1 < disp || !handOK(n)) continue;
        const black = FB.isBlack(n.midi);
        if (black !== (pass === 1)) continue;
        const x = keyX(n.midi) + (black ? 0 : inset), bwid = black ? bw : W - inset * 2;
        if (x > w || x + bwid < 0) continue;
        const y1 = Y(n.t0), y0 = Y(n.t1);
        const bh = Math.max(4, y1 - y0 - 1.5);
        if (!barObscured && y1 > bar.top && y1 - bh < bar.bottom && x < bar.right && x + bwid > bar.left) barObscured = true;
        if (!clockObscured && y1 > clock.top && y1 - bh < clock.bottom && x < clock.right && x + bwid > clock.left) clockObscured = true;
        const hk = n.hand === 0 ? 'rh' : 'lh';
        const rad = Math.min(5, bwid * 0.3);
        if (n.t0 <= live + EPS && n.t1 > live + EPS) { hot.push([n, x, bwid, y1, bh, hk, rad]); continue; }
        c.fillStyle = theme[black ? hk + '-key' : hk];
        rr(c, x, y1 - bh, bwid, bh, rad);
        c.fill();
        // the attack: a lighter foot where the note begins
        if (bh > 9) {
          c.fillStyle = theme[hk + '-hot'];
          c.globalAlpha = black ? 0.55 : 0.75;
          rr(c, x, y1 - 3, bwid, 3, 0, rad);
          c.fill();
          c.globalAlpha = 1;
        }
        if (bwid >= 14 && bh >= 22) {
          c.fillStyle = theme['bar-ink'];
          c.globalAlpha = 0.78;
          c.fillText(n.name, x + bwid / 2, y1 - 8);
          c.globalAlpha = 1;
        }
      }
    }
    /* the notes sounding now: the same block in the brighter tone, nothing else */
    for (const [n, x, bwid, y1, bh, hk, rad] of hot) {
      c.fillStyle = theme[hk + '-hot'];
      rr(c, x, y1 - bh, bwid, bh, rad);
      c.fill();
      if (bwid >= 14 && bh >= 22) { c.fillStyle = theme['bar-ink']; c.fillText(n.name, x + bwid / 2, Math.min(y1, h) - 8); }
    }
    el.barReadout.classList.toggle('is-obscured', barObscured);
    el.clock.classList.toggle('is-obscured', clockObscured);

    c.font = `600 10.5px ${UI_FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'bottom';
    c.fillStyle = theme['grid-ink'];
    for (const [num, y] of labels) {
      if (y <= 16) continue;
      // Fade grid numbers out before they reach the playback readouts.
      c.globalAlpha = clamp((h - y - 26) / 42, 0, 1);
      if (c.globalAlpha > 0) c.fillText(num, 7, y - 3);
    }
    c.globalAlpha = 1;

    /* playback line, shown when the view has been scrolled away from it */
    if (S.viewT !== null) {
      const y = Math.round(Y(live));
      if (y >= -2 && y <= h + 2) {
        c.fillStyle = theme.now;
        c.fillRect(0, y - 1, w, 2);
        c.beginPath(); c.moveTo(0, y - 6); c.lineTo(8, y); c.lineTo(0, y + 6); c.closePath(); c.fill();
      }
    }
  }

  function drawKbd(held) {
    const c = kc, w = G.width, h = G.height, W = G.W, left = G.left, bw = W * BLACK_W;
    c.clearRect(0, 0, w, h);
    const i0 = clamp(Math.floor(left), 0, N_WHITE - 1), i1 = clamp(Math.ceil(left + w / W), 0, N_WHITE - 1);
    const lip = clamp(h * 0.05, 3, 7);
    const grad = (a, b, cc) => {
      const g = c.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, a); g.addColorStop(0.82, b); g.addColorStop(1, cc);
      return g;
    };
    const ivory = grad(theme['key-a'], theme['key-b'], theme['key-c']);
    const ivoryDown = grad(theme['key-b'], theme['key-c'], theme['key-c']);
    // a sounding key keeps its shape and takes its hand's colour as a flat wash
    const lit = [alpha(theme.brass, 0.9), alpha(theme.blue, 0.9)];

    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    for (let i = i0; i <= i1; i++) {
      const m = WHITE_MIDI[i], x = (i - left) * W;
      const hand = held.get(m);
      c.fillStyle = hand !== undefined || pressed.has(m) ? ivoryDown : ivory;
      rr(c, x + 0.5, -4, W - 1, h + 4 - 0.5, 0, Math.min(4, W * 0.2));
      c.fill();
      if (hand !== undefined) { c.fillStyle = lit[hand]; c.fill(); }
      // the front lip catches the light
      c.fillStyle = 'rgba(255,255,255,0.35)';
      c.fillRect(x + 1.5, h - lip - 1, W - 3, 1);
      if (m % 12 === 0 && W >= 11) {
        const oct = FB.midiOctave(m);
        c.font = `${oct === 4 ? 700 : 600} ${W < 16 ? 8.5 : 10}px ${UI_FONT}`;
        c.fillStyle = hand === undefined ? theme['key-ink'] : 'rgba(20,16,4,0.7)';
        c.globalAlpha = oct === 4 || hand !== undefined ? 1 : 0.7;
        c.fillText((W < 15 ? '' : 'C') + oct, x + W / 2, h - lip - 5);
        c.globalAlpha = 1;
      }
    }

    const bh = Math.round(h * BLACK_H);
    const mLo = WHITE_MIDI[i0], mHi = WHITE_MIDI[i1];
    for (let m = Math.max(22, mLo - 1); m <= Math.min(106, mHi + 1); m++) {
      if (!FB.isBlack(m)) continue;
      const x = keyX(m);
      const hand = held.get(m);
      const down = hand !== undefined || pressed.has(m);
      // cast shadow on the ivory
      c.fillStyle = 'rgba(0,0,0,0.26)';
      rr(c, x - 0.5, -4, bw + 3, bh + (down ? 5 : 7), 3);
      c.fill();
      // body
      const body = c.createLinearGradient(x, 0, x + bw, 0);
      body.addColorStop(0, theme['ebony-b']); body.addColorStop(0.5, theme['ebony-c']); body.addColorStop(1, theme['ebony-b']);
      c.fillStyle = hand === undefined ? body : theme[hand === 0 ? 'brass-lo' : 'blue-lo'];
      rr(c, x, -4, bw, bh + 4, 0, 3);
      c.fill();
      // top face, with the slope at the front
      const slope = clamp(bh * 0.1, 4, 9) * (down ? 0.55 : 1);
      const side = Math.min(2.2, bw * 0.14);
      const face = c.createLinearGradient(0, 0, 0, bh - slope);
      face.addColorStop(0, theme['ebony-b']); face.addColorStop(0.85, pressed.has(m) ? theme['ebony-a'] : '#2a2a2e'); face.addColorStop(1, theme['ebony-a']);
      c.fillStyle = hand === undefined ? face : theme[hand === 0 ? 'brass' : 'blue'];
      rr(c, x + side, -4, bw - side * 2, bh - slope + 4, 0, 2);
      c.fill();
    }

    /* shadow cast by the felt and the fallboard above */
    const sh = c.createLinearGradient(0, 0, 0, 16);
    sh.addColorStop(0, 'rgba(0,0,0,0.5)'); sh.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = sh;
    c.fillRect(0, 0, w, 16);
  }

  /* ------------------------------------------------------------------ frame */
  let lastMs = 0, lastUi = '';
  function frame(ms) {
    frameQueued = false;
    const dt = Math.min(64, lastMs ? ms - lastMs : 16);
    lastMs = ms;
    let busy = S.playing;
    if (S.playing) schedule();
    const t = now();

    if (S.viewT === null && S.offset !== 0) {
      S.offset *= Math.exp(-dt / 70);
      if (Math.abs(S.offset * S.pps) < 0.5) S.offset = 0; else busy = true;
    }
    if (S.viewT !== null && S.inertia !== 0 && S.score) {
      S.viewT = clamp(S.viewT + S.inertia * dt, 0, S.score.duration);
      S.inertia *= Math.exp(-dt / 320);
      if (Math.abs(S.inertia * S.pps) < 0.02) S.inertia = 0; else busy = true;
    }

    follow(t, ms);
    if (G.W !== G.tW || G.left !== G.tLeft) {
      const k = 1 - Math.exp(-dt / 140);
      G.W += (G.tW - G.W) * k;
      G.left += (G.tLeft - G.left) * k;
      if (Math.abs(G.W - G.tW) < 0.01 && Math.abs(G.left - G.tLeft) < 0.002) { G.W = G.tW; G.left = G.tLeft; } else busy = true;
    }

    if (S.score) {
      const d = S.score.duration;
      const o = S.score.measures[S.score.measureAt(t)];
      const bpm = Math.round(S.score.tempoAt(t).bpm * S.speed);
      const ui = o.number + '|' + bpm + '|' + Math.round(t / S.speed) + '|' + S.speed;
      if (ui !== lastUi) {
        lastUi = ui;
        el.where.textContent = o.number;
        el.whereOf.textContent = 'of ' + S.score.measures[S.score.measures.length - 1].number;
        el.tempo.textContent = bpm;
        el.clock.textContent = fmt(t / S.speed) + ' / ' + fmt(d / S.speed);
        progressBounds = null;
      }
    }
    if (!progressBounds) measureProgress();
    if (S.view === 'roll') {
      drawRoll(dispTime(), t);
    } else {
      notation.update(t, S.playing);
      if (!scoreObscured) {
        scoreObscured = progressBounds.readouts.map((rect) => notation.hasNoteBehind(rect));
      }
      readouts.forEach((readout, i) => readout.classList.toggle('is-obscured', scoreObscured[i]));
    }
    drawKbd(heldAt(t, S.playing));
    scrubFrame();
    if (updateGlass(ms)) busy = true;
    if (busy) kick();
  }

  /* ------------------------------------------------------------------ small UI sync */
  function syncPlayBtn() {
    el.play.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    el.play.classList.toggle('is-playing', S.playing);
  }
  function syncLiveBtn() {
    const away = S.view === 'roll' ? S.viewT !== null : notation.detached;
    if (el.live.hidden !== !away) { el.live.hidden = !away; glassKick(); }
  }
  function syncSegs() {
    for (const b of el.viewSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.view === S.view));
    for (const b of el.handSeg.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.hand === S.hand));
    el.viewSeg.style.setProperty('--i', S.view === 'score' ? 1 : 0);
    el.handSeg.style.setProperty('--i', ['L', 'both', 'R'].indexOf(S.hand));
    el.handSlot.hidden = !(S.score && S.score.hasHands);
    el.handToggle.dataset.hand = S.hand;
    el.handToggle.setAttribute('aria-label', 'Hands: ' + { L: 'Left', both: 'Both', R: 'Right' }[S.hand]);
    el.speedOut.textContent = Math.round(S.speed * 100) + '%';
    el.speedToggle.setAttribute('aria-label', 'Playback speed: ' + el.speedOut.textContent);
    footTicks = 20;
    syncSpeed();
  }

  let toastTimer = null;
  function toast(msg) {
    el.toastText.textContent = msg;
    el.toast.hidden = false;
    glassKick();
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 7000);
  }
  function status(msg, isError) {
    if (isError) { el.status.hidden = true; toast(msg); return; }
    el.status.hidden = !msg;
    if (msg) el.status.textContent = msg;
    kick();
  }

  /* ------------------------------------------------------------------ notation view */
  const notation = new FB.Notation({
    box: el.notation,
    pages: el.pages,
    onStatus: status,
    onDetach: () => syncLiveBtn(),
    onChange: () => { scoreObscured = null; sceneV++; kick(); },
    onSeek: (t) => {
      const on = S.score.onsets.both;
      let lo = 0, hi = on.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (on[mid] < t) lo = mid + 1; else hi = mid; }
      let best = on[lo];
      if (lo > 0 && Math.abs(on[lo - 1] - t) < Math.abs(best - t)) best = on[lo - 1];
      seek(Math.abs(best - t) < 0.08 ? best : t, { sound: true });
    },
  });

  function setView(v) {
    S.view = v;
    el.app.dataset.view = v;
    el.roll.hidden = v !== 'roll';
    if (v === 'score') notation.show(); else { notation.hide(); status(null); }
    attach();
    syncSegs();
    sceneV++;
    glassKick();
    scrubPoke();
    resize();
    persist();
  }

  function setHand(h) {
    S.hand = h;
    sceneV++;
    notation.setHand(handKey());
    G.manual = false;
    fitKeys(true);
    if (S.playing) { piano.stopAll(); reanchor(now()); }
    syncSegs();
    persist();
    kick();
  }

  function setSpeed(v) {
    const t = now();
    S.speed = v;
    if (S.playing) { piano.stopAll(); reanchor(t); }
    lastUi = '';
    syncSegs();
    persist();
    kick();
  }

  /* ------------------------------------------------------------------ loading scores */
  function setScore(score, meta) {
    if (S.playing) pause();
    piano.stopAll();
    S.score = score;
    S.meta = meta;
    const pos = (store.get().pos || {})[meta.id];
    S.t = pos > 0 && pos < score.duration - 1 ? pos : 0;
    S.viewT = null; S.offset = 0; S.inertia = 0;
    if (!score.hasHands) S.hand = 'both';
    el.title.textContent = meta.title;
    el.composer.textContent = meta.composer || '';
    el.composer.hidden = !meta.composer;
    document.title = meta.title + ' – Fallboard';
    G.manual = false;
    notation.setHand(handKey());
    notation.setScore(score, meta);
    lastUi = '';
    syncSegs();
    resize();
    // fetch the engraved pages while the roll is on screen, so the score view opens at once
    setTimeout(() => notation.preload(), 600);
    scrubPoke();
  }

  let scoreRequest = 0;
  let scoreLoading = false;

  async function selectScore(message, readXml, getMeta, fallbackError) {
    const request = ++scoreRequest;
    scoreLoading = true;
    status(message);
    try {
      const xml = await readXml();
      if (request !== scoreRequest) return;
      const score = FB.parseMusicXML(xml);
      if (!score.notes.length) throw new Error('This score has no notes to play.');
      status(null);
      setScore(score, getMeta(score));
    } catch (e) {
      if (request !== scoreRequest) return;
      status(null);
      toast(fallbackError || e.message || 'This file could not be opened.');
    } finally {
      if (request === scoreRequest) scoreLoading = false;
    }
  }

  function loadBuiltin(piece) {
    // a deploy that caches files stamps itself (tools/stamp.js); the score files take the same version
    const base = 'scores/' + piece.file, v = window.FB_VERSION ? '?v=' + window.FB_VERSION : '';
    return selectScore('Loading the score…', async () => {
      const r = await fetch(base + '.musicxml' + v);
      if (!r.ok) throw new Error('Score download failed');
      return r.text();
    }, () => ({ ...piece, engraved: base + '.{layout}.json' + v }), 'This piece could not be loaded. Try selecting it again.');
  }

  function openFile(file) {
    return selectScore('Reading ' + file.name + '…', () => FB.readScoreFile(file), (score) => ({
      id: 'file:' + file.name,
      title: score.title || file.name.replace(/\.(musicxml|xml|mxl)$/i, ''),
      composer: score.composer || '',
    }));
  }

  /* ------------------------------------------------------------------ layout */
  function resize() {
    [G.width, G.height] = sizeCanvas(el.kbd, kc, el.kbdWrap);
    progressBounds = null;
    sceneV++;
    footTicks = 20;
    if (S.view === 'roll') {
      [R.w, R.h] = sizeCanvas(el.roll, rc, el.stage);
      if (!S.pps && R.h > 40) S.pps = clamp(R.h / 3.5, 70, 240);
    } else {
      notation.ensure();
      // one staff space in CSS pixels: bar numbers and the cursor scale with the engraving
      const lay = notation.layout();
      const engraving = notation.layoutKey === lay?.key ? notation.eng : null;
      if (lay && el.pages.clientWidth) el.pages.style.setProperty('--sp', (el.pages.clientWidth - 12) / (engraving?.wsp || lay.wsp) + 'px');
    }
    if (!S.pps) S.pps = 120;
    fitKeys(false);
    kick();
  }

  /* ------------------------------------------------------------------ roll gestures */
  const ptrs = new Map();
  let drag = null, pinch = null;

  function noteAt(x, y) {
    const sc = S.score;
    if (!sc) return null;
    const disp = dispTime(), tau = disp + (R.h - y) / S.pps, tTop = disp + R.h / S.pps;
    const bw = G.W * BLACK_W;
    let best = null, bestD = 1e9;
    for (let i = lowerT0(disp - sc.maxDur - EPS); i < sc.notes.length && sc.notes[i].t0 <= tTop; i++) {
      const n = sc.notes[i];
      if (!handOK(n) || n.t1 < disp) continue;
      const black = FB.isBlack(n.midi);
      const kx = keyX(n.midi), kw = black ? bw : G.W;
      const dx = x < kx ? kx - x : x > kx + kw ? x - kx - kw : 0;
      const dy = (tau < n.t0 ? n.t0 - tau : tau > n.t1 ? tau - n.t1 : 0) * S.pps;
      if (dx > 10 || dy > 10) continue;
      const d = dx + dy - (black && dx === 0 && dy === 0 ? 0.5 : 0);
      if (d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function panBy(startLeft, dxPx) {
    const vis = G.width / G.W;
    if (vis >= N_WHITE - 0.01) return;
    G.left = G.tLeft = clamp(startLeft - dxPx / G.W, 0, N_WHITE - vis);
    G.holdUntil = performance.now() + 2500;
  }

  /* a swipe moves through time or across the keys, never both: the first 8 px decide which */
  const canPan = () => G.width / G.W < N_WHITE - 0.01;
  const axisOf = (dx, dy) => (canPan() && Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');

  el.roll.addEventListener('pointerdown', (e) => {
    el.roll.setPointerCapture(e.pointerId);
    ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    S.inertia = 0;
    if (ptrs.size === 1) {
      drag = { x: e.offsetX, y: e.offsetY, t: performance.now(), disp: dispTime(), left: G.left, moved: false, axis: null, samples: [] };
      pinch = null;
    } else if (ptrs.size === 2) {
      const [a, b] = [...ptrs.values()];
      const dx = Math.abs(a.x - b.x), dy = Math.abs(a.y - b.y);
      pinch = { horiz: dx > dy, d0: Math.max(24, dx > dy ? dx : dy), W0: G.W, pps0: S.pps, cx: (a.x + b.x) / 2, anchor: G.left + (a.x + b.x) / 2 / G.W };
      if (drag) drag.moved = true;
    }
  });
  el.roll.addEventListener('pointermove', (e) => {
    const p = ptrs.get(e.pointerId);
    if (!p) return;
    p.x = e.offsetX; p.y = e.offsetY;
    if (pinch && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()];
      if (pinch.horiz) {
        const ratio = Math.max(24, Math.abs(a.x - b.x)) / pinch.d0;
        G.manual = true;
        G.W = G.tW = clamp(pinch.W0 * ratio, G.width / N_WHITE, 72);
        G.left = G.tLeft = clamp(pinch.anchor - pinch.cx / G.W, 0, Math.max(0, N_WHITE - G.width / G.W));
        G.holdUntil = performance.now() + 2500;
      } else {
        S.pps = clamp(pinch.pps0 * (Math.max(24, Math.abs(a.y - b.y)) / pinch.d0), 30, 800);
      }
      kick();
      return;
    }
    if (!drag || !S.score) return;
    const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.axis = axisOf(dx, dy);
      // start from where the finger is now, so the locked axis does not jump by the threshold
      drag.x = e.offsetX; drag.y = e.offsetY;
      return;
    }
    if (drag.axis === 'x') {
      panBy(drag.left, dx);
    } else {
      S.viewT = clamp(drag.disp + dy / S.pps, 0, S.score.duration);
      S.offset = 0;
      drag.samples.push([performance.now(), e.offsetY]);
      if (drag.samples.length > 6) drag.samples.shift();
      syncLiveBtn();
    }
    kick();
  });
  const rollUp = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (pinch) { if (ptrs.size < 2) { pinch = null; drag = null; persist(); } return; }
    if (!drag) return;
    const d = drag;
    drag = null;
    if (e.type === 'pointercancel') return;
    if (!d.moved) {
      if (performance.now() - d.t < 600) {
        const n = noteAt(e.offsetX, e.offsetY);
        if (n) seek(n.t0, { sound: true });
      }
      return;
    }
    const s = d.samples;
    if (d.axis === 'y' && s.length >= 2) {
      const a = s[0], b = s[s.length - 1];
      if (b[0] - a[0] > 8 && performance.now() - b[0] < 90) S.inertia = (b[1] - a[1]) / (b[0] - a[0]) / S.pps;
    }
    kick();
  };
  let wheelAxis = null, wheelAt = 0;
  el.roll.addEventListener('pointerup', rollUp);
  el.roll.addEventListener('pointercancel', rollUp);
  el.roll.addEventListener('wheel', (e) => {
    if (!S.score) return;
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 32 : 1;
    if (e.ctrlKey || e.metaKey) {
      S.pps = clamp(S.pps * Math.exp(-e.deltaY * unit * 0.002), 30, 800);
    } else {
      // a trackpad swipe arrives as a run of wheel events: its first event picks the axis for the run
      const ms = performance.now();
      const dx = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX, dy = e.shiftKey ? 0 : e.deltaY;
      if (!wheelAxis || ms - wheelAt > 180) wheelAxis = e.shiftKey ? (canPan() ? 'x' : 'y') : axisOf(dx, dy);
      wheelAt = ms;
      if (wheelAxis === 'x' && dx) panBy(G.left, -dx * unit);
      if (wheelAxis === 'y' && dy) {
        S.viewT = clamp(dispTime() - (e.deltaY * unit) / S.pps, 0, S.score.duration);
        S.offset = 0; S.inertia = 0;
        syncLiveBtn();
      }
    }
    kick();
  }, { passive: false });

  /* ------------------------------------------------------------------ keyboard touch */
  function midiAt(x, y) {
    const i = clamp(Math.floor(G.left + x / G.W), 0, N_WHITE - 1);
    const m = WHITE_MIDI[i];
    if (y < G.height * BLACK_H) {
      const bw = G.W * BLACK_W;
      for (const b of [m - 1, m + 1]) {
        if (b < 22 || b > 106 || !FB.isBlack(b)) continue;
        const bx = keyX(b);
        if (x >= bx && x <= bx + bw) return b;
      }
    }
    return m;
  }
  let kdrag = null;
  el.kbd.addEventListener('pointerdown', (e) => {
    if (!pageActive) return;
    el.kbd.setPointerCapture(e.pointerId);
    const m = midiAt(e.offsetX, e.offsetY);
    const ctx = piano.ensure();
    piano.noteOn(m, ctx.currentTime + 0.005, 1.4, 0.7);
    pressed.add(m);
    kdrag = { id: e.pointerId, x: e.offsetX, left: G.left, m, moved: false };
    kick();
  });
  el.kbd.addEventListener('pointermove', (e) => {
    if (!kdrag || kdrag.id !== e.pointerId) return;
    const dx = e.offsetX - kdrag.x;
    if (!kdrag.moved && Math.abs(dx) < 10) return;
    kdrag.moved = true;
    pressed.delete(kdrag.m);
    panBy(kdrag.left, dx);
    kick();
  });
  const kbdUp = (e) => {
    if (!kdrag || kdrag.id !== e.pointerId) return;
    pressed.delete(kdrag.m);
    kdrag = null;
    kick();
  };
  el.kbd.addEventListener('pointerup', kbdUp);
  el.kbd.addEventListener('pointercancel', kbdUp);

  /* ------------------------------------------------------------------ press feedback
     As in Graph Notes: a pressed control scales up slightly and shows a highlight pill inset from
     its edge. The state is held for at least 140 ms so a quick tap is still seen, and the glass is
     redrawn while the shell changes size. */
  const PRESSABLE = 'button:not(:disabled)';
  function pressGlass(b) { if (el.rail.contains(b)) footTicks = 24; else glassKick(); }
  document.addEventListener('pointerdown', (e) => {
    const b = e.target.closest && e.target.closest(PRESSABLE);
    if (!b) return;
    b.dataset.pressed = 'true';
    b._pressedAt = performance.now();
    // in a tab bar the pill itself follows the press; the click commits it, anything else puts it back
    const seg = b.parentElement && b.parentElement.classList.contains('seg') ? b.parentElement : null;
    if (seg) seg.style.setProperty('--i', [...seg.querySelectorAll('button')].indexOf(b));
    pressGlass(b);
    const end = () => {
      document.removeEventListener('pointerup', end, true);
      document.removeEventListener('pointercancel', end, true);
      setTimeout(() => { delete b.dataset.pressed; if (seg) syncSegs(); pressGlass(b); }, Math.max(0, 140 - (performance.now() - b._pressedAt)));
    };
    document.addEventListener('pointerup', end, true);
    document.addEventListener('pointercancel', end, true);
  }, true);

  /* audio may only start inside a tap: every tap and key press makes sure it is running */
  const unlockAudio = () => {
    if (!pageActive) return;
    const c = piano.ctx;
    if (!c || c.state !== 'running' || !piano.primed || (FB.Piano.IOS && (!piano.keeper || piano.keeper.paused))) piano.unlock();
  };
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) document.addEventListener(type, unlockAudio, true);

  /* ------------------------------------------------------------------ scroll indicator
     The iOS pattern: a thin pill on the right edge that appears while the view is moved by
     hand, shows where the view sits in the piece, and fades a second later. While it shows it
     can be grabbed and dragged; it widens and a glass bubble names the bar. In the roll the
     piece runs upward (its start is at the bottom, where the keys are); in the score it runs
     down like any page. Dragging moves the view only, like scrolling: playback stays put. */
  const SCRUB = { shown: false, hover: false, drag: null, hideAt: 0, timer: null, lastView: null, top: 0, size: 36, travel: 0 };

  function scrubPoke() {
    if (!S.score) return;
    SCRUB.hideAt = performance.now() + 1100;
    if (!SCRUB.shown) { SCRUB.shown = true; el.scrub.classList.add('is-shown'); }
    clearTimeout(SCRUB.timer);
    SCRUB.timer = setTimeout(scrubMaybeHide, 1150);
    kick();
  }
  function scrubMaybeHide() {
    if (SCRUB.drag || SCRUB.hover) return;
    const left = SCRUB.hideAt - performance.now();
    if (left > 0) { SCRUB.timer = setTimeout(scrubMaybeHide, left + 20); return; }
    SCRUB.shown = false;
    el.scrub.classList.remove('is-shown');
  }

  /* where the view is: fraction through the piece, and the share of it on screen */
  function scrubPosition() {
    const sc = S.score;
    if (!sc || !sc.duration) return null;
    if (S.view === 'roll') {
      const span = R.h / S.pps;
      return { f: clamp(dispTime() / sc.duration, 0, 1), vis: span / (sc.duration + span), up: true };
    }
    const box = el.notation, max = box.scrollHeight - box.clientHeight;
    if (!notation.eng || max <= 0) return null;
    return { f: clamp(box.scrollTop / max, 0, 1), vis: box.clientHeight / box.scrollHeight, up: false };
  }

  function scrubFrame() {
    if (S.view === 'roll' && S.viewT !== null && S.viewT !== SCRUB.lastView) scrubPoke();
    SCRUB.lastView = S.view === 'roll' ? S.viewT : null;
    if (!SCRUB.shown || SCRUB.drag) return;
    const pos = scrubPosition();
    if (!pos) return;
    const H = el.scrub.clientHeight;
    SCRUB.size = Math.round(clamp(H * pos.vis, 36, H * 0.5));
    SCRUB.travel = Math.max(0, H - SCRUB.size);
    SCRUB.top = (pos.up ? 1 - pos.f : pos.f) * SCRUB.travel;
    el.scrubThumb.style.height = SCRUB.size + 'px';
    el.scrubThumb.style.transform = 'translateY(' + SCRUB.top.toFixed(1) + 'px)';
  }

  function scrubLabel() {
    if (S.view === 'roll') return S.score.measures[S.score.measureAt(S.viewT !== null ? S.viewT : dispTime())].number;
    return notation.barAtTop();
  }

  el.scrubThumb.addEventListener('pointerdown', (e) => {
    if (!SCRUB.shown || !S.score) return;
    e.preventDefault();
    el.scrubThumb.setPointerCapture(e.pointerId);
    SCRUB.drag = { id: e.pointerId, y: e.clientY, top: SCRUB.top };
    el.scrub.classList.add('is-dragging');
    S.inertia = 0;
    scrubMove(e);
  });
  function scrubMove(e) {
    const d = SCRUB.drag;
    if (!d || d.id !== e.pointerId) return;
    const top = clamp(d.top + e.clientY - d.y, 0, SCRUB.travel);
    const f = SCRUB.travel ? top / SCRUB.travel : 0;
    if (S.view === 'roll') {
      S.viewT = (1 - f) * S.score.duration;
      S.offset = 0;
      syncLiveBtn();
    } else {
      notation.detach();
      el.notation.scrollTop = f * (el.notation.scrollHeight - el.notation.clientHeight);
    }
    SCRUB.top = top;
    el.scrubThumb.style.transform = 'translateY(' + top.toFixed(1) + 'px)';
    const bar = scrubLabel();
    el.scrubLabel.hidden = bar === null || bar === undefined;
    if (!el.scrubLabel.hidden) {
      el.scrubText.textContent = 'Bar ' + bar;
      const lh = el.scrubLabel.offsetHeight || 32;
      el.scrubLabel.style.transform = 'translateY(' + clamp(top + SCRUB.size / 2 - lh / 2, 0, el.scrub.clientHeight - lh).toFixed(1) + 'px)';
    }
    SCRUB.hideAt = performance.now() + 1100;
    glassKick();
  }
  el.scrubThumb.addEventListener('pointermove', scrubMove);
  const scrubEnd = (e) => {
    if (!SCRUB.drag || SCRUB.drag.id !== e.pointerId) return;
    SCRUB.drag = null;
    el.scrub.classList.remove('is-dragging');
    el.scrubLabel.hidden = true;
    persist();
    glassKick();
    scrubPoke();
  };
  el.scrubThumb.addEventListener('pointerup', scrubEnd);
  el.scrubThumb.addEventListener('pointercancel', scrubEnd);
  /* with a mouse, the indicator also shows while the pointer rests near the right edge */
  el.deck.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = el.scrub.getBoundingClientRect();
    const near = e.clientX > r.right - 36 && e.clientY > r.top - 12 && e.clientY < r.bottom + 12;
    if (near === SCRUB.hover) return;
    SCRUB.hover = near;
    if (near) scrubPoke(); else scrubMaybeHide();
  });
  el.deck.addEventListener('pointerleave', () => { if (SCRUB.hover) { SCRUB.hover = false; scrubMaybeHide(); } });

  /* ------------------------------------------------------------------ controls */
  const railControls = [
    { slot: el.handSlot, toggle: el.handToggle, options: el.handSeg },
    { slot: el.speedSlot, toggle: el.speedToggle, options: el.tempoBox },
  ];
  let openRailControl = null;

  function setRailControl(control, moveFocus = false) {
    const previous = openRailControl;
    if (previous === control) return;
    openRailControl = control;
    el.rail.toggleAttribute('data-open', !!control);
    el.railShield.hidden = !control;
    for (const item of railControls) {
      item.slot.classList.toggle('is-open', item === control);
      item.slot.inert = !!control && item !== control;
      item.toggle.setAttribute('aria-expanded', String(item === control));
    }
    el.steps.inert = !!control;
    if (moveFocus) {
      if (control) {
        const button = control.options.querySelector('[aria-pressed="true"], [role="slider"]') || control.options.querySelector('button:enabled');
        button?.focus();
      } else previous.toggle.focus();
    }
    footTicks = 24;
    kick();
  }

  for (const control of railControls) {
    control.toggle.addEventListener('click', (e) => setRailControl(control, e.detail === 0));
  }
  function dismissRailControl(e) {
    if (openRailControl && !openRailControl.slot.contains(e.target)) setRailControl(null);
  }
  document.addEventListener('pointerdown', dismissRailControl, true);
  document.addEventListener('wheel', dismissRailControl, { capture: true, passive: true });
  // Safari's native page gesture is separate from the roll's pointer-based pinch.
  for (const type of ['gesturestart', 'gesturechange']) {
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
  }

  el.play.addEventListener('click', () => (S.playing ? pause() : play()));
  el.next.addEventListener('click', () => step(1));
  el.prev.addEventListener('click', () => step(-1));
  el.live.addEventListener('click', () => { attach(); kick(); });
  el.viewSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.view !== S.view) setView(b.dataset.view); });
  el.handSeg.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b && b.dataset.hand !== S.hand) setHand(b.dataset.hand); });
  /* ------------------------------------------------------------------ speed slider
     Stepped: the thumb snaps to each speed in SPEEDS, evenly spaced. 100% catches the thumb from
     further away than the other steps, so normal speed is easy to land on. A tap on the track
     jumps there; the readout resets to 100%. */
  const SPEED_HOME = SPEEDS.indexOf(1);
  el.speedTicks.innerHTML = SPEEDS.map((v, i) => `<i${i === SPEED_HOME ? ' class="home"' : ''} style="left:${(i / (SPEEDS.length - 1)) * 100}%"></i>`).join('');
  let speedDrag = null;

  function syncSpeed() {
    const i = Math.max(0, SPEEDS.indexOf(S.speed)), pct = Math.round(S.speed * 100) + '%';
    el.speed.style.setProperty('--f', String(i / (SPEEDS.length - 1)));
    el.speed.setAttribute('aria-valuenow', String(Math.round(S.speed * 100)));
    el.speed.setAttribute('aria-valuetext', pct);
    el.speedTicks.querySelectorAll('i').forEach((t, k) => t.classList.toggle('on', k <= i));
  }
  function speedStep(i) {
    i = clamp(i, 0, SPEEDS.length - 1);
    if (SPEEDS[i] === S.speed) return;
    setSpeed(SPEEDS[i]);
    try { if (navigator.vibrate) navigator.vibrate(i === SPEED_HOME ? 12 : 5); } catch (e) { /* no haptics */ }
  }
  function speedAt(e) {
    const r = el.speedTrack.getBoundingClientRect();
    const raw = clamp((e.clientX - r.left) / r.width, 0, 1) * (SPEEDS.length - 1);
    speedStep(Math.abs(raw - SPEED_HOME) < 0.8 ? SPEED_HOME : Math.round(raw));
  }
  el.speed.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    el.speed.focus({ preventScroll: true });
    try { el.speed.setPointerCapture(e.pointerId); } catch (err) { /* a pointer that is already gone */ }
    speedDrag = { id: e.pointerId };
    el.speed.classList.add('is-dragging');
    speedAt(e);
  });
  el.speed.addEventListener('pointermove', (e) => { if (speedDrag && speedDrag.id === e.pointerId) speedAt(e); });
  const speedEnd = (e) => {
    if (!speedDrag || speedDrag.id !== e.pointerId) return;
    speedDrag = null;
    el.speed.classList.remove('is-dragging');
  };
  el.speed.addEventListener('pointerup', speedEnd);
  el.speed.addEventListener('pointercancel', speedEnd);
  el.speed.addEventListener('keydown', (e) => {
    const i = SPEEDS.indexOf(S.speed);
    const to = { ArrowLeft: i - 1, ArrowDown: i - 1, ArrowRight: i + 1, ArrowUp: i + 1, PageDown: i - 2, PageUp: i + 2, Home: 0, End: SPEEDS.length - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    e.stopPropagation();   // the arrows step through the notes everywhere else
    speedStep(to);
  });
  el.speedReset.addEventListener('click', () => speedStep(SPEED_HOME));

  document.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.key === ' ' || e.code === 'Space') { if (e.target.tagName !== 'BUTTON') { e.preventDefault(); S.playing ? pause() : play(); } }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'Escape') {
      if (openRailControl) setRailControl(null, true);
      else closeMenu();
    }
  });

  function closeMenu() { el.menu.hidden = true; el.menuBtn.setAttribute('aria-expanded', 'false'); }
  el.menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    el.menu.hidden = !el.menu.hidden;
    el.menuBtn.setAttribute('aria-expanded', String(!el.menu.hidden));
    glassKick();
  });
  document.addEventListener('pointerdown', (e) => { if (!el.menu.hidden && !el.menu.contains(e.target) && e.target !== el.menuBtn && !el.menuBtn.contains(e.target)) closeMenu(); });
  el.openBtn.addEventListener('click', () => { closeMenu(); el.file.click(); });
  for (const piece of BUILTINS) {
    const button = $('builtinScoreRow').content.firstElementChild.cloneNode(true);
    button.querySelector('b').textContent = piece.title;
    button.querySelector('small').textContent = piece.composer;
    button.addEventListener('click', () => {
      closeMenu();
      if (S.meta?.id !== piece.id) loadBuiltin(piece);
      else if (scoreLoading) {
        scoreRequest++;
        scoreLoading = false;
        status(null);
      }
    });
    el.builtinScores.appendChild(button);
  }
  el.file.addEventListener('change', () => { const f = el.file.files && el.file.files[0]; if (f) openFile(f); el.file.value = ''; });

  /* ------------------------------------------------------------------ boot */
  readTheme();
  new ResizeObserver(resize).observe(el.stage);
  new ResizeObserver(resize).observe(el.kbdWrap);
  const progressObserver = new ResizeObserver(() => { progressBounds = null; kick(); });
  for (const readout of readouts) progressObserver.observe(readout);
  notation.now = now;
  notation.topInset = 68;
  el.notation.addEventListener('scroll', () => { scoreObscured = null; sceneV++; if (notation.detached) scrubPoke(); kick(); }, { passive: true });
  initGlass();
  piano.preload();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { footTicks = 20; sceneV++; glassKick(); });
  function stopInBackground() {
    pageActive = false;
    if (waitingForPiano) {
      waitingForPiano = null;
      status(null);
    }
    if (S.playing) pause();
    else persist();
    piano.deactivate();
    pressed.clear();
    kdrag = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopInBackground();
    else { pageActive = true; kick(); }
  });
  window.addEventListener('pagehide', stopInBackground);
  window.addEventListener('pageshow', () => { pageActive = !document.hidden; });
  setInterval(() => { if (S.playing) persist(); }, 5000);

  el.app.dataset.view = S.view;
  el.roll.hidden = S.view !== 'roll';
  if (S.view === 'score') notation.show();
  syncSegs();
  syncPlayBtn();
  resize();
  loadBuiltin(BUILTINS[0]);

  FB.debug = { S, G, R, seek, play, pause, step, notation, piano, openFile, glass: () => [glassTop, glassFoot] };
})();
