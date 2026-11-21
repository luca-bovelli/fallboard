'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { launchBrowser } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const OUT16 = path.join(ROOT, 'promo', 'clips', '16x9');
const OUT9 = path.join(ROOT, 'promo', 'clips', '9x16');
const PREV = path.join(ROOT, 'promo', '_preview');
[OUT16, OUT9, PREV].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const FPS = 60;
const DT_MS = 1000 / FPS;
const PORT = 5215 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const FORMAT = process.argv.find((a) => a.startsWith('--format='))?.slice(9); // '16x9' | '9x16' | undefined
const want = (name) => !ONLY || ONLY.includes(name);

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);

function bezier(x, x1, y1, x2, y2) {
  x = clamp(x, 0, 1);
  if (x <= 0 || x >= 1) return x;
  const bx = (u) => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  const by = (u) => 3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u;
  let lo = 0, hi = 1;
  for (let i = 0; i < 16; i++) { const m = (lo + hi) * 0.5; if (bx(m) < x) lo = m; else hi = m; }
  return by((lo + hi) * 0.5);
}
const easeOut = (x) => bezier(x, 0.18, 0.9, 0.25, 1.0);
const easeInOut = (x) => bezier(x, 0.32, 0.72, 0.0, 1.0);
const easeIn = (x) => bezier(x, 0.55, 0.0, 0.9, 0.35);

/* Evaluate piecewise-eased camera keyframes:
   keys: [{ t, scale, fx, fy, ease?: 'inOut'|'out'|'in' }] where fx, fy in [0..1] viewport focus */
function evalCamera(t, keys, vw, vh, outW, outH) {
  let k0 = keys[0], k1 = keys[0];
  for (let i = 0; i < keys.length; i++) {
    if (t >= keys[i].t) {
      k0 = keys[i];
      k1 = keys[Math.min(keys.length - 1, i + 1)];
    }
  }
  const span = Math.max(1e-6, k1.t - k0.t);
  const raw = clamp((t - k0.t) / span, 0, 1);
  const efn = k1.ease === 'in' ? easeIn : k1.ease === 'out' ? easeOut : easeInOut;
  const p = k0 === k1 ? 0 : efn(raw);

  const zoom = lerp(k0.scale, k1.scale, p);
  const fx = lerp(k0.fx, k1.fx, p);
  const fy = lerp(k0.fy, k1.fy, p);

  const cw = vw / zoom;
  const ch = vh / zoom;
  const x = clamp(fx * vw - cw * 0.5, 0, Math.max(0, vw - cw));
  const y = clamp(fy * vh - ch * 0.5, 0, Math.max(0, vh - ch));
  const scale = outW / cw;
  return { x, y, width: cw, height: ch, scale, zoom };
}

function encodePipe(outFile, fps, outW, outH) {
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(fps),
    '-i', '-',
    '-vf', `scale=${outW}:${outH}:flags=lanczos`,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outFile,
  ], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', (d) => { err += d.toString(); });
  const done = new Promise((res, rej) => {
    ff.on('close', (code) => (code === 0 ? res() : rej(new Error('ffmpeg failed ' + code + ': ' + err.slice(-400)))));
  });
  return { ff, done };
}

async function installPromoRuntime(page, vertical) {
  await page.evaluate((isVert) => {
    if (document.getElementById('promoRuntimeStyle')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,500..700&family=Newsreader:ital,opsz,wght@1,6..72,500..600&display=swap';
    document.head.appendChild(link);

    const st = document.createElement('style');
    st.id = 'promoRuntimeStyle';
    st.textContent = `
      :focus-visible, *:focus-visible { outline: none !important; }
      .promo-tap {
        position: fixed; z-index: 99990; pointer-events: none;
        width: 44px; height: 44px; border-radius: 50%;
        border: 2px solid rgba(255,255,255,0.92);
        background: rgba(255,255,255,0.18);
        box-shadow: 0 0 22px rgba(255,255,255,0.38);
        transform: translate(-50%, -50%) scale(0.45);
        opacity: 0;
        will-change: transform, opacity;
      }
      #promoCamHud {
        position: fixed; left: 0; top: 0; z-index: 99995; pointer-events: none;
        overflow: hidden; transform-origin: top left;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", system-ui, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      #promoCapWrap {
        position: absolute; left: 0; right: 0;
        display: flex; flex-direction: column; align-items: center; text-align: center;
        padding: 0 ${isVert ? '26px' : '80px'};
        opacity: 0; will-change: transform, opacity;
      }
      #promoCapWrap::before {
        content: ""; position: absolute; left: 50%; top: 50%;
        width: ${isVert ? '340px' : '680px'}; height: ${isVert ? '150px' : '180px'};
        transform: translate(-50%, -50%);
        background: radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.28) 46%, rgba(0,0,0,0) 76%);
        z-index: -1; pointer-events: none;
      }
      #promoCapH {
        font-weight: 700; color: #f5f5f7;
        font-size: ${isVert ? '25px' : '38px'};
        line-height: 1.12; letter-spacing: -0.032em;
        text-shadow: 0 4px 28px rgba(0,0,0,0.75);
      }
      #promoCapH em.hi {
        font-family: "Newsreader", Georgia, serif;
        font-style: italic; font-weight: 500;
        font-variation-settings: "opsz" 48;
        font-size: 1.07em; letter-spacing: -0.01em;
        color: var(--cap-hi, #ff9ad0);
      }
      #promoCapSub {
        margin-top: ${isVert ? '6px' : '8px'};
        font-size: ${isVert ? '13px' : '16px'}; font-weight: 500;
        color: rgba(245,245,247,0.82); letter-spacing: -0.01em;
        text-shadow: 0 2px 16px rgba(0,0,0,0.8);
      }
    `;
    document.head.appendChild(st);

    const hud = document.createElement('div');
    hud.id = 'promoCamHud';
    hud.innerHTML = '<div id="promoCapWrap"><div id="promoCapH"></div><div id="promoCapSub"></div></div>';
    document.body.appendChild(hud);

    // Virtual-clock-driven tap halos (zero setTimeout -> buttery 60fps!)
    window.__taps = [];
    window.__tapAt = (selector) => {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width && !r.height) return;
      const d = document.createElement('div');
      d.className = 'promo-tap';
      d.style.left = (r.left + r.width / 2) + 'px';
      d.style.top = (r.top + r.height / 2) + 'px';
      document.body.appendChild(d);
      window.__taps.push({ el: d, t0: window.__vclock.now() });
    };
    window.__updateTaps = () => {
      const now = window.__vclock.now();
      for (let i = window.__taps.length - 1; i >= 0; i--) {
        const tap = window.__taps[i];
        const age = now - tap.t0; // ms
        if (age >= 380) {
          tap.el.remove();
          window.__taps.splice(i, 1);
          continue;
        }
        const pIn = Math.min(1, age / 150);
        const eIn = 1 - Math.pow(1 - pIn, 3);
        const pOut = Math.max(0, (age - 130) / 250);
        const eOut = pOut * pOut;
        const sc = 0.45 + 0.72 * eIn + 0.35 * eOut;
        const op = age < 130 ? eIn * 0.92 : (1 - eOut) * 0.92;
        tap.el.style.transform = `translate(-50%, -50%) scale(${sc.toFixed(4)})`;
        tap.el.style.opacity = op.toFixed(4);
      }
    };

    window.__setCaption = (cam, vw, vh, spec) => {
      const hudEl = document.getElementById('promoCamHud');
      const wrap = document.getElementById('promoCapWrap');
      if (!spec || spec.opacity <= 0.002) {
        wrap.style.opacity = '0';
        return;
      }
      // Match camera viewport 1:1 so typography floats rock-steady in foreground plane while UI zooms underneath!
      hudEl.style.left = cam.x.toFixed(2) + 'px';
      hudEl.style.top = cam.y.toFixed(2) + 'px';
      hudEl.style.width = vw + 'px';
      hudEl.style.height = vh + 'px';
      hudEl.style.transform = `scale(${(1 / cam.zoom).toFixed(6)})`;

      const hEl = document.getElementById('promoCapH');
      const sEl = document.getElementById('promoCapSub');
      if (hEl.dataset.raw !== spec.html) { hEl.innerHTML = spec.html; hEl.dataset.raw = spec.html; }
      if (sEl.textContent !== (spec.sub || '')) { sEl.textContent = spec.sub || ''; sEl.style.display = spec.sub ? 'block' : 'none'; }
      wrap.style.setProperty('--cap-hi', spec.hi || '#ff9ad0');
      wrap.style.top = spec.top || (isVert ? '15.5%' : '15%');
      wrap.style.opacity = spec.opacity.toFixed(4);
      wrap.style.transform = `translateY(${(spec.y || 0).toFixed(2)}px)`;
    };
  }, vertical);
}

/* Compute smooth caption envelope for a list of caption windows [{ t0, t1, html, sub, hi, top }] */
function activeCaption(t, caps) {
  if (!caps) return null;
  for (const c of caps) {
    if (t >= c.t0 && t <= c.t1) {
      const fadeIn = easeOut(seg(t, c.t0, c.t0 + 0.28));
      const fadeOut = 1 - easeIn(seg(t, c.t1 - 0.24, c.t1));
      const op = fadeIn * fadeOut;
      const y = lerp(12, 0, fadeIn) - lerp(0, 6, 1 - fadeOut);
      return { html: c.html, sub: c.sub || '', hi: c.hi, top: c.top, opacity: op, y };
    }
  }
  return null;
}

async function waitForScore(page) {
  await page.waitForFunction(() => !!(window.FB && FB.debug && FB.debug.S && FB.debug.S.score && FB.debug.S.score.notes.length > 0), { timeout: 25000 });
  await page.waitForTimeout(450);
}

async function openBuiltin(page, file, title, composer, id) {
  await page.evaluate(() => window.__vclock && window.__vclock.unlock());
  await page.evaluate(([file, title, composer, id]) => {
    FB.app.open({ kind: 'builtin', file }, { id, title, composer });
  }, [file, title, composer, id]);
  await page.waitForFunction((targetId) => FB.debug.S.meta && FB.debug.S.meta.id === targetId && FB.debug.S.score, id, { timeout: 25000 });
  await page.waitForTimeout(550);
}

/* Query an element's normalized viewport center (0..1, 0..1) so camera focuses cleanly on both 16:9 and 9:16! */
async function elemFocus(page, selector, fallback = [0.5, 0.5]) {
  return page.evaluate(([sel, fb]) => {
    const el = document.querySelector(sel);
    if (!el) return fb;
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return fb;
    return [(r.left + r.width / 2) / window.innerWidth, (r.top + r.height / 2) / window.innerHeight];
  }, [selector, fallback]);
}

async function captureFormat(browser, vertical) {
  const tag = vertical ? '9x16' : '16x9';
  const outDir = vertical ? OUT9 : OUT16;
  const vw = vertical ? 360 : 1280;
  const vh = vertical ? 640 : 720;
  const dpr = vertical ? 3 : 1.5;
  const outW = Math.round(vw * dpr);
  const outH = Math.round(vh * dpr);

  const ctx = await browser.newContext({
    viewport: { width: vw, height: vh },
    deviceScaleFactor: dpr,
    isMobile: vertical,
    hasTouch: vertical,
  });
  const page = await ctx.newPage();

  // Seed localStorage + install deterministic 60fps virtual clock BEFORE app.js boots!
  await page.addInitScript(() => {
    localStorage.setItem('fallboard:v1', JSON.stringify({
      last: 'chopin-op23',
      view: 'roll',
      hand: 'both',
      speed: 1,
      recent: [{ id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23', open: { kind: 'builtin', file: 'ballade-op23' } }],
    }));

    const realNow = performance.now.bind(performance);
    const realDateNow = Date.now.bind(Date);
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCaf = window.cancelAnimationFrame.bind(window);
    let locked = false, vNow = 0, vDateBase = 0, rafId = 1;
    const rafQueue = new Map();
    const animStarts = new WeakMap();

    performance.now = () => (locked ? vNow : realNow());
    Date.now = () => (locked ? Math.round(vDateBase + vNow) : realDateNow());
    window.requestAnimationFrame = (cb) => {
      if (!locked) return realRaf(cb);
      const id = rafId++;
      rafQueue.set(id, cb);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      if (!locked) return realCaf(id);
      rafQueue.delete(id);
    };

    window.__vclock = {
      lock() {
        if (locked) return;
        vNow = realNow();
        vDateBase = realDateNow() - vNow;
        locked = true;
        for (const a of document.getAnimations()) {
          animStarts.set(a, vNow - (Number(a.currentTime) || 0));
          try { a.pause(); } catch {}
        }
      },
      unlock() {
        if (!locked) return;
        locked = false;
        for (const a of document.getAnimations()) { try { a.play(); } catch {} }
        const q = [...rafQueue.values()];
        rafQueue.clear();
        q.forEach((cb) => realRaf(cb));
      },
      step(dtMs) {
        vNow += dtMs;
        // Force style recalc so any newly-triggered CSS transitions appear in document.getAnimations()
        void document.body.offsetHeight;
        for (const a of document.getAnimations()) {
          if (!animStarts.has(a)) {
            animStarts.set(a, vNow - dtMs);
            try { a.pause(); } catch {}
          }
          const elapsed = Math.max(0, vNow - animStarts.get(a));
          try { a.currentTime = elapsed; } catch {}
        }
        if (window.__updateTaps) window.__updateTaps();
        const entries = [...rafQueue.entries()];
        rafQueue.clear();
        for (const [, cb] of entries) { try { cb(vNow); } catch {} }
      },
      now: () => vNow,
    };
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForScore(page);
  await installPromoRuntime(page, vertical);
  await page.evaluate(() => document.fonts && document.fonts.ready);

  const cdp = await ctx.newCDPSession(page);
  const force = process.argv.includes('--force');
  const exists = (name) => !want(name) || (!force && fs.existsSync(path.join(outDir, name)) && fs.statSync(path.join(outDir, name)).size > 50000);

  /* Helper: advance score playback by dtScore and return all newly triggered notes with sub-frame video timing! */
  async function advancePlaybackAndCollect(frameIdx, dtScore, includeStartWindow, pieceKey) {
    return page.evaluate(([f, dt, incStart, pKey, fps]) => {
      const S = FB.debug.S;
      const sc = S.score;
      const tPrev = S.t;
      const tCurr = Math.min(sc.duration, tPrev + dt);
      FB.debug.seek(tCurr, { snap: true });
      const handOK = (n) => S.hand === 'both' || (S.hand === 'R' ? n.hand === 0 : n.hand === 1);
      const speed = S.speed || 1;
      const notes = [];
      const eps = incStart ? 0.018 : 0;
      for (const n of sc.notes) {
        if (!handOK(n)) continue;
        if (incStart ? (n.t0 >= tPrev - eps && n.t0 <= tCurr) : (n.t0 > tPrev && n.t0 <= tCurr)) {
          const frac = dt > 1e-6 ? Math.max(0, Math.min(1, (n.t0 - tPrev) / dt)) : 0;
          const tVid = (f + frac) / fps;
          notes.push({
            t: +tVid.toFixed(5),
            dur: +Math.max(0.08, (n.t1 - n.t0) / speed).toFixed(4),
            midi: n.midi,
            vel: +(n.vel || 0.72).toFixed(3),
            hand: n.hand,
            piece: pKey,
          });
        }
      }
      return notes;
    }, [frameIdx, dtScore, includeStartWindow, pieceKey, FPS]);
  }

  /* Helper: execute FB.debug.step(1) and log the exact chord notes lighting up on this frame! */
  async function stepChordAndCollect(frameIdx, pieceKey) {
    return page.evaluate(([f, pKey, fps]) => {
      window.__tapAt('#nextBtn');
      FB.debug.step(1);
      document.activeElement?.blur();
      const S = FB.debug.S;
      const handOK = (n) => S.hand === 'both' || (S.hand === 'R' ? n.hand === 0 : n.hand === 1);
      const notes = [];
      for (const n of S.score.notes) {
        if (!handOK(n)) continue;
        if (Math.abs(n.t0 - S.t) < 0.025) {
          notes.push({
            t: +(f / fps).toFixed(5),
            dur: +Math.min(0.65, Math.max(0.28, n.t1 - n.t0)).toFixed(4),
            midi: n.midi,
            vel: +Math.min(0.92, (n.vel || 0.75) * 1.02).toFixed(3),
            hand: n.hand,
            piece: pKey,
          });
        }
      }
      return notes;
    }, [frameIdx, pieceKey, FPS]);
  }

  /* Helper: step 1 virtual 60fps frame, update camera-space caption, capture vector-sharp zoomed screenshot */
  async function captureOneFrame(ff, frameIdx, camKeys, captions, previewOut, previewAt) {
    const t = frameIdx / FPS;
    const cam = evalCamera(t, camKeys, vw, vh, outW, outH);
    const capSpec = activeCaption(t, captions);
    await page.evaluate(([c, w, h, spec, dtMs]) => {
      if (window.__setCaption) window.__setCaption(c, w, h, spec);
      window.__vclock.step(dtMs);
    }, [cam, vw, vh, capSpec, DT_MS]);

    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 94,
      clip: { x: cam.x, y: cam.y, width: cam.width, height: cam.height, scale: cam.scale },
    });
    const buf = Buffer.from(data, 'base64');
    if (previewOut && frameIdx === previewAt) fs.writeFileSync(previewOut, buf);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }

  // ============================================================================
  // CLIP 1: app-01-open-and-step.mp4 (7.4s = 444f @ 60fps — Chopin Ballade No. 1)
  // Opens straight on Fallboard playing -> Step chord-by-chord -> Isolate Left -> 50% speed!
  // ============================================================================
  if (!exists('app-01-open-and-step.mp4')) {
    const t0 = Date.now();
    const FRAMES = 444;
    const events = { fps: FPS, duration: FRAMES / FPS, clip: 'app-01-open-and-step', notes: [], sfx: [] };

    await openBuiltin(page, 'ballade-op23', 'Ballade No. 1 in G minor', 'Frédéric Chopin, Op. 23', 'chopin-op23');
    await page.evaluate(() => {
      FB.debug.S.speed = 1;
      document.querySelector('#viewSeg button[data-view="roll"]').click();
      document.querySelector('#handSeg button[data-hand="both"]').click();
      FB.debug.seek(47.10, { snap: true });
      document.getElementById('playBtn').classList.add('is-playing');
    });
    await page.waitForTimeout(250);

    const handFocus = await elemFocus(page, vertical ? '#handToggle' : '#handSeg', [0.18, 0.92]);
    const speedFocus = await elemFocus(page, vertical ? '#speedToggle' : '#speed', [0.82, 0.92]);

    const camKeys = [
      { t: 0.00, scale: 1.18, fx: 0.50, fy: 0.72 },
      { t: 1.30, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
      { t: 3.65, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 4.10, scale: vertical ? 1.20 : 1.28, fx: clamp(handFocus[0] + 0.08, 0.25, 0.75), fy: 0.84, ease: 'inOut' },
      { t: 5.15, scale: vertical ? 1.12 : 1.18, fx: 0.44, fy: 0.76, ease: 'inOut' },
      { t: 5.75, scale: vertical ? 1.20 : 1.26, fx: clamp(speedFocus[0] - 0.06, 0.25, 0.78), fy: 0.84, ease: 'inOut' },
      { t: 6.75, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
      { t: 7.12, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 7.40, scale: 1.12, fx: 0.50, fy: 0.50, ease: 'in' }, // anticipated exit push!
    ];
    const captions = [
      { t0: 0.14, t1: 1.65, html: 'Fallboard', sub: 'Every note, in sync.', hi: '#ff9ad0', top: vertical ? '17%' : '16%' },
      { t0: 1.92, t1: 3.55, html: 'Step <em class="hi">chord by chord.</em>', hi: '#ff9ad0', top: vertical ? '17%' : '16%' },
      { t0: 3.92, t1: 5.38, html: 'Isolate <em class="hi">either hand.</em>', hi: '#ff9ad0', top: vertical ? '17%' : '16%' },
      { t0: 5.75, t1: 7.08, html: 'Slow to <em class="hi">25%.</em>', sub: 'Crystal-clear grand piano.', hi: '#ff9ad0', top: vertical ? '17%' : '16%' },
    ];

    await page.evaluate(() => window.__vclock.lock());
    const { ff, done } = encodePipe(path.join(outDir, 'app-01-open-and-step.mp4'), FPS, outW, outH);

    for (let f = 0; f < FRAMES; f++) {
      // Phase 1 (0..112f = 1.87s): Smooth real-time Ballade opening playback
      if (f < 112) {
        const ns = await advancePlaybackAndCollect(f, 1 / FPS, f === 0, 'ballade-op23');
        events.notes.push(...ns);
      }
      // Pause cleanly at f=112 to demonstrate chord-by-chord stepping
      if (f === 112) {
        await page.evaluate(() => { document.getElementById('playBtn').classList.remove('is-playing'); });
      }
      // Phase 2 (f=122, 150, 178, 206): 4 rhythmic chord steps (every 0.467s)
      if ([122, 150, 178, 206].includes(f)) {
        const ns = await stepChordAndCollect(f, 'ballade-op23');
        events.notes.push(...ns);
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'tap' });
      }
      // Phase 3 (f=230..336): Isolate Left Hand & play smoothly!
      if (f === 230 && vertical) {
        await page.evaluate(() => { window.__tapAt('#handToggle'); document.getElementById('handToggle').click(); document.activeElement?.blur(); });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'tap' });
      }
      if (f === 242) {
        await page.evaluate(() => { window.__tapAt('#handSeg button[data-hand="L"]'); document.querySelector('#handSeg button[data-hand="L"]').click(); document.activeElement?.blur(); });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'toggle' });
      }
      if (f === 256 && vertical) {
        await page.evaluate(() => { document.getElementById('handToggle').click(); document.activeElement?.blur(); });
      }
      if (f === 250) {
        await page.evaluate(() => { document.getElementById('playBtn').classList.add('is-playing'); });
      }
      if (f >= 250 && f < 338) {
        const ns = await advancePlaybackAndCollect(f, 1 / FPS, f === 250, 'ballade-op23');
        events.notes.push(...ns);
      }
      // Phase 4 (f=338..444): Back to Both + drop Speed to 50%!
      if (f === 338 && vertical) {
        await page.evaluate(() => { document.getElementById('handToggle').click(); document.activeElement?.blur(); });
      }
      if (f === 344) {
        await page.evaluate(() => { window.__tapAt('#handSeg button[data-hand="both"]'); document.querySelector('#handSeg button[data-hand="both"]').click(); document.activeElement?.blur(); });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'toggle' });
      }
      if (f === 350 && vertical) {
        await page.evaluate(() => { document.getElementById('handToggle').click(); window.__tapAt('#speedToggle'); document.getElementById('speedToggle').click(); document.activeElement?.blur(); });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'tap' });
      }
      if (f === 362) {
        await page.evaluate(() => {
          const track = document.getElementById('speedTrack');
          const r = track.getBoundingClientRect();
          const x = r.left + r.width * (1 / 6); // exact 50% stop
          const y = r.top + r.height / 2;
          window.__tapAt('#speed');
          document.getElementById('speed').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
          document.getElementById('speed').dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
        });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'toggle' });
      }
      if (f >= 338) {
        const sp = await page.evaluate(() => FB.debug.S.speed || 1);
        const ns = await advancePlaybackAndCollect(f, (1 / FPS) * sp, false, 'ballade-op23');
        events.notes.push(...ns);
      }
      if (f === 430) events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'whoosh' });

      await captureOneFrame(ff, f, camKeys, captions, path.join(PREV, `${tag}-app-01-open.jpg`), 285);
    }

    ff.stdin.end();
    await done;
    await page.evaluate(() => {
      window.__vclock.unlock();
      document.getElementById('playBtn').classList.remove('is-playing');
      document.getElementById('speedReset').click();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    fs.writeFileSync(path.join(outDir, 'app-01-open-and-step.events.json'), JSON.stringify(events));
    console.log(`[${tag}] app-01-open-and-step.mp4 (${FRAMES}f, ${events.notes.length} notes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ============================================================================
  // CLIP 2: app-02-roll-to-score.mp4 (5.6s = 336f @ 60fps — Rachmaninoff C# minor!)
  // Different piece & palette! Roll -> guided zoom to glass Roll|Score pill -> dark engraved Score in 1:1 sync!
  // ============================================================================
  if (!exists('app-02-roll-to-score.mp4')) {
    const t0 = Date.now();
    const FRAMES = 336;
    const events = { fps: FPS, duration: FRAMES / FPS, clip: 'app-02-roll-to-score', notes: [], sfx: [] };

    await openBuiltin(page, 'rach-cs', 'Prelude in C♯ minor', 'Sergei Rachmaninoff, Op. 3 No. 2', 'rachmaninoff-op3-2');
    // Pre-warm engraved score once so the Roll -> Score switch is 100% instant!
    await page.evaluate(() => {
      FB.debug.S.speed = 1;
      document.querySelector('#handSeg button[data-hand="both"]').click();
      FB.debug.seek(6.92, { snap: true });
      document.querySelector('#viewSeg button[data-view="score"]').click();
    });
    await page.waitForSelector('.sys svg', { timeout: 25000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.querySelector('#viewSeg button[data-view="roll"]').click();
      FB.debug.seek(6.92, { snap: true });
      document.getElementById('playBtn').classList.add('is-playing');
    });
    await page.waitForTimeout(250);

    const viewFocus = await elemFocus(page, '#viewSeg', [0.86, 0.08]);

    const camKeys = [
      { t: 0.00, scale: 1.11, fx: 0.50, fy: 0.50 },
      { t: 0.30, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' }, // anticipated settle on Bar 2 downbeat!
      { t: 1.50, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 1.98, scale: vertical ? 1.24 : 1.36, fx: clamp(viewFocus[0], 0.3, 0.92), fy: clamp(viewFocus[1] + 0.06, 0.08, 0.3), ease: 'inOut' },
      { t: 2.48, scale: vertical ? 1.24 : 1.36, fx: clamp(viewFocus[0], 0.3, 0.92), fy: clamp(viewFocus[1] + 0.06, 0.08, 0.3) },
      { t: 3.10, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
      { t: 5.32, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 5.60, scale: 1.12, fx: 0.50, fy: 0.50, ease: 'in' },
    ];
    const captions = [
      { t0: 1.72, t1: 3.65, html: 'One tap to <em class="hi">sheet music.</em>', sub: 'Live engraved score, synced to every key.', hi: '#bafff0', top: vertical ? '61%' : '62%' },
    ];

    await page.evaluate(() => window.__vclock.lock());
    const { ff, done } = encodePipe(path.join(outDir, 'app-02-roll-to-score.mp4'), FPS, outW, outH);

    for (let f = 0; f < FRAMES; f++) {
      if (f === 124) {
        await page.evaluate(() => {
          window.__tapAt('#viewSeg button[data-view="score"]');
          document.querySelector('#viewSeg button[data-view="score"]').click();
          document.activeElement?.blur();
        });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'toggle' });
      }
      const ns = await advancePlaybackAndCollect(f, 1 / FPS, f === 0, 'rach-cs');
      events.notes.push(...ns);
      if (f === 322) events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'whoosh' });

      await captureOneFrame(ff, f, camKeys, captions, path.join(PREV, `${tag}-app-02-score.jpg`), 210);
    }

    ff.stdin.end();
    await done;
    await page.evaluate(() => { window.__vclock.unlock(); document.getElementById('playBtn').classList.remove('is-playing'); });
    fs.writeFileSync(path.join(outDir, 'app-02-roll-to-score.events.json'), JSON.stringify(events));
    console.log(`[${tag}] app-02-roll-to-score.mp4 (${FRAMES}f, ${events.notes.length} notes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ============================================================================
  // CLIP 3: app-03-color-worlds.mp4 (4.2s = 252f @ 60fps — 3 pieces × 1.4s = 84f)
  // Revolutionary Etude -> Rachmaninoff G minor -> Chopin Ballade No. 1, with anticipated zoom-push cuts!
  // ============================================================================
  if (!exists('app-03-color-worlds.mp4')) {
    const t0 = Date.now();
    const SEG_F = 84;
    const FRAMES = SEG_F * 3;
    const events = { fps: FPS, duration: FRAMES / FPS, clip: 'app-03-color-worlds', notes: [], sfx: [] };

    const worlds = [
      { file: 'revolutionary', id: 'chopin-op10-12', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12', seek: 0.0, hi: '#ffb489' },
      { file: 'rach-gm', id: 'rachmaninoff-op23-5', title: 'Prelude in G minor', composer: 'Sergei Rachmaninoff, Op. 23 No. 5', seek: 0.0, hi: '#6ff0dc' },
      { file: 'ballade-op23', id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23', seek: 50.13, hi: '#ff9ad0' },
    ];

    const { ff, done } = encodePipe(path.join(outDir, 'app-03-color-worlds.mp4'), FPS, outW, outH);

    for (let wi = 0; wi < worlds.length; wi++) {
      const w = worlds[wi];
      await openBuiltin(page, w.file, w.title, w.composer, w.id);
      await page.evaluate((s) => {
        FB.debug.S.speed = 1;
        document.querySelector('#viewSeg button[data-view="roll"]').click();
        document.querySelector('#handSeg button[data-hand="both"]').click();
        FB.debug.seek(s, { snap: true });
        document.getElementById('playBtn').classList.add('is-playing');
      }, w.seek);
      await page.waitForTimeout(250);
      await page.evaluate(() => window.__vclock.lock());

      const segDur = SEG_F / FPS;
      const segCamKeys = [
        { t: 0.00, scale: 1.13, fx: 0.50, fy: 0.55 },
        { t: 0.24, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },   // punchy settle on downbeat!
        { t: segDur - 0.20, scale: 1.00, fx: 0.50, fy: 0.50 },
        { t: segDur, scale: 1.13, fx: 0.50, fy: 0.55, ease: 'in' }, // anticipated zoom-push into next piece!
      ];
      const segCaptions = wi === 0
        ? [{ t0: 0.14, t1: 1.24, html: 'Every piece, its own <em class="hi">world.</em>', hi: w.hi, top: vertical ? '17%' : '16%' }]
        : null;

      for (let lf = 0; lf < SEG_F; lf++) {
        const gf = wi * SEG_F + lf;
        const ns = await advancePlaybackAndCollect(gf, 1 / FPS, lf === 0, w.file);
        events.notes.push(...ns);
        if (lf === SEG_F - 10) events.sfx.push({ t: +(gf / FPS).toFixed(5), kind: 'whoosh' });

        // Pass local frame index for per-segment camera & caption timing
        const lt = lf / FPS;
        const cam = evalCamera(lt, segCamKeys, vw, vh, outW, outH);
        const capSpec = activeCaption(lt, segCaptions);
        await page.evaluate(([c, wv, hv, spec, dtMs]) => {
          if (window.__setCaption) window.__setCaption(c, wv, hv, spec);
          window.__vclock.step(dtMs);
        }, [cam, vw, vh, capSpec, DT_MS]);

        const { data } = await cdp.send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 94,
          clip: { x: cam.x, y: cam.y, width: cam.width, height: cam.height, scale: cam.scale },
        });
        const buf = Buffer.from(data, 'base64');
        if (wi === 1 && lf === 36) fs.writeFileSync(path.join(PREV, `${tag}-app-03-world2.jpg`), buf);
        if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
      }
      await page.evaluate(() => window.__vclock.unlock());
    }

    ff.stdin.end();
    await done;
    await page.evaluate(() => { document.getElementById('playBtn').classList.remove('is-playing'); });
    fs.writeFileSync(path.join(outDir, 'app-03-color-worlds.events.json'), JSON.stringify(events));
    console.log(`[${tag}] app-03-color-worlds.mp4 (${FRAMES}f, ${events.notes.length} notes) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ============================================================================
  // CLIP 4: app-04-library-henle-pdf.mp4 (5.4s = 324f @ 60fps — ZERO piano playback, UI SFX ONLY!)
  // Opens real Fallboard Library -> eased scroll -> brisk "henle 6" search -> iOS cover -> A4 PDF zoom!
  // ============================================================================
  if (!exists('app-04-library-henle-pdf.mp4')) {
    const t0 = Date.now();
    const FRAMES = 324;
    const events = { fps: FPS, duration: FRAMES / FPS, clip: 'app-04-library-henle-pdf', notes: [], sfx: [] };

    // Populate recent shelf with 3 rich pieces so Continue shelf looks authentic
    for (const w of [
      { file: 'revolutionary', id: 'chopin-op10-12', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12' },
      { file: 'rach-gm', id: 'rachmaninoff-op23-5', title: 'Prelude in G minor', composer: 'Sergei Rachmaninoff, Op. 23 No. 5' },
      { file: 'ballade-op23', id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23' },
    ]) {
      await openBuiltin(page, w.file, w.title, w.composer, w.id);
    }
    await page.evaluate(() => {
      document.querySelector('#viewSeg button[data-view="roll"]').click();
      FB.debug.seek(50.13, { snap: true });
    });
    await page.waitForTimeout(200);

    // Pre-open once to warm catalog.json, then close so our real on-camera open is instant!
    await page.evaluate(() => FB.library.open());
    await page.waitForSelector('.explore-tabs', { timeout: 20000 });
    await page.waitForTimeout(600);
    await page.evaluate(() => FB.library.close());
    await page.waitForTimeout(350);
    await installPromoRuntime(page, vertical);

    const { ff, done } = encodePipe(path.join(outDir, 'app-04-library-henle-pdf.mp4'), FPS, outW, outH);

    // Part A + B (f=0..186 = 3.10s): Real Library open -> eased scroll -> zoom to search -> type "henle 6"
    await page.evaluate(() => window.__vclock.lock());

    const camKeysAB = [
      { t: 0.00, scale: 1.09, fx: 0.50, fy: 0.50 },
      { t: 0.30, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
      { t: 1.72, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 2.08, scale: vertical ? 1.15 : 1.22, fx: 0.50, fy: 0.24, ease: 'inOut' },
      { t: 2.86, scale: vertical ? 1.15 : 1.22, fx: 0.50, fy: 0.26 },
      { t: 3.10, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
    ];
    const capsAB = [
      { t0: 0.38, t1: 1.78, html: '650+ scores. <em class="hi">Henle levels.</em>', hi: '#f7b48a', top: vertical ? '79%' : '80%' },
    ];

    const searchChars = 'henle 6';
    for (let f = 0; f < 186; f++) {
      if (f === 2) {
        await page.evaluate(() => { FB.library.open(); });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'whoosh' });
      }
      // Smooth C∞-eased scroll down through Continue shelf + Composers + Henle pills (f=26..102)
      if (f >= 26 && f <= 102) {
        const p = easeInOut(seg(f, 26, 102));
        const y = Math.round(p * (vertical ? 340 : 410));
        await page.evaluate((top) => {
          const sc = document.getElementById('libScroll');
          if (sc) sc.scrollTop = top;
        }, y);
      }
      // Focus search bar (f=112) & brisk natural typing (f=122..158, every 6f = 100ms!)
      if (f === 112) {
        await page.evaluate(() => {
          window.__tapAt('#libSearch');
          const inp = document.getElementById('libQuery');
          if (inp) inp.focus();
        });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'tap' });
      }
      if (f >= 122 && f < 122 + searchChars.length * 6 && (f - 122) % 6 === 0) {
        const idx = (f - 122) / 6;
        const val = searchChars.slice(0, idx + 1);
        await page.evaluate((v) => {
          const inp = document.getElementById('libQuery');
          if (inp) { inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true })); }
        }, val);
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'key' });
      }
      if (f === 178) {
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#libPage .row')];
          const pick = rows.find((r) => !r.querySelector('.dot')) || rows[0];
          if (pick) window.__tapAt(pick);
        });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'tap' });
      }
      await captureOneFrame(ff, f, camKeysAB, capsAB, path.join(PREV, `${tag}-app-04-search.jpg`), 168);
    }

    // Unlock briefly so clicking the Henle 6 row lets webmscore engrave the real A4 PDF page!
    await page.evaluate(() => window.__vclock.unlock());
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#libPage .row')];
      const pick = rows.find((r) => !r.querySelector('.dot')) || rows[0];
      if (pick) pick.click();
    });
    await page.waitForSelector('.sheet-page img', { timeout: 90000 });
    await page.waitForTimeout(400);
    await page.evaluate(() => window.__vclock.lock());
    events.sfx.push({ t: +(186 / FPS).toFixed(5), kind: 'page' });

    // Part C (f=186..324 = 2.30s): Generative cover -> eased scroll to A4 PDF -> full-screen PDF zoom -> exit into endcard!
    const camKeysC = [
      { t: 3.10, scale: 1.07, fx: 0.50, fy: 0.48 },
      { t: 3.36, scale: 1.00, fx: 0.50, fy: 0.50, ease: 'out' },
      { t: 4.55, scale: 1.00, fx: 0.50, fy: 0.50 },
      { t: 4.92, scale: 1.05, fx: 0.50, fy: 0.50, ease: 'inOut' },
      { t: 5.14, scale: 1.05, fx: 0.50, fy: 0.50 },
      { t: 5.40, scale: 1.14, fx: 0.50, fy: 0.50, ease: 'in' }, // anticipated exit push into Endcard!
    ];
    const capsC = [
      { t0: 3.35, t1: 4.95, html: 'Printable <em class="hi">A4 PDFs.</em>', sub: 'Engraved right in your browser.', hi: '#f7b48a', top: vertical ? '14%' : '12%' },
    ];

    for (let f = 186; f < FRAMES; f++) {
      if (f >= 208 && f <= 262) {
        const p = easeInOut(seg(f, 208, 262));
        await page.evaluate((frac) => {
          const sc = document.getElementById('libScroll');
          if (sc) sc.scrollTop = Math.round(frac * (sc.scrollHeight - sc.clientHeight));
        }, p);
      }
      if (f === 272) {
        await page.evaluate(() => {
          window.__tapAt('.sheet-page');
          const pg = document.querySelector('.sheet-page');
          if (pg) pg.click();
        });
        events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'page' });
      }
      if (f === 310) events.sfx.push({ t: +(f / FPS).toFixed(5), kind: 'whoosh' });

      await captureOneFrame(ff, f, camKeysC, capsC, path.join(PREV, `${tag}-app-04-pdf.jpg`), 296);
    }

    ff.stdin.end();
    await done;
    await page.evaluate(() => window.__vclock.unlock());
    fs.writeFileSync(path.join(outDir, 'app-04-library-henle-pdf.events.json'), JSON.stringify(events));
    console.log(`[${tag}] app-04-library-henle-pdf.mp4 (${FRAMES}f, UI SFX only) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  await ctx.close();
}

(async () => {
  const srv = spawn(process.execPath, [path.join(ROOT, 'dev-server.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 900));

  const browser = await launchBrowser();
  try {
    if (!FORMAT || FORMAT === '16x9') await captureFormat(browser, false);
    if (!FORMAT || FORMAT === '9x16') await captureFormat(browser, true);
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log('ALL LIVE APP CLIPS CAPTURED.');
})();
