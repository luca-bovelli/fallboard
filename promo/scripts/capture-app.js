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

const FPS = 30;
const PORT = 5215 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}/`;
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const FORMAT = process.argv.find((a) => a.startsWith('--format='))?.slice(9); // '16x9' | '9x16' | undefined
const want = (name) => !ONLY || ONLY.includes(name);

function encodePipe(outFile, fps) {
  const ff = spawn('ffmpeg', [
    '-y',
    '-f', 'image2pipe',
    '-vcodec', 'mjpeg',
    '-r', String(fps),
    '-i', '-',
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

async function installTapHalo(page) {
  await page.evaluate(() => {
    if (document.getElementById('promoTapStyle')) return;
    const st = document.createElement('style');
    st.id = 'promoTapStyle';
    st.textContent = `
      :focus-visible, *:focus-visible { outline: none !important; }
      .promo-tap {
        position: fixed; z-index: 99999; pointer-events: none;
        width: 46px; height: 46px; border-radius: 50%;
        border: 2.5px solid rgba(255,255,255,0.92);
        background: rgba(255,255,255,0.22);
        box-shadow: 0 0 24px rgba(255,255,255,0.45);
        transform: translate(-50%, -50%) scale(0.4);
        opacity: 0;
        transition: transform 280ms cubic-bezier(0.22, 1, 0.36, 1), opacity 280ms ease-out;
      }
      .promo-tap.show { transform: translate(-50%, -50%) scale(1.15); opacity: 0.95; }
      .promo-tap.fade { transform: translate(-50%, -50%) scale(1.45); opacity: 0; }
    `;
    document.head.appendChild(st);
    window.__tapAt = (selector) => {
      const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = document.createElement('div');
      d.className = 'promo-tap';
      d.style.left = (r.left + r.width / 2) + 'px';
      d.style.top = (r.top + r.height / 2) + 'px';
      document.body.appendChild(d);
      requestAnimationFrame(() => {
        d.classList.add('show');
        setTimeout(() => d.classList.add('fade'), 150);
        setTimeout(() => d.remove(), 480);
      });
    };
  });
}

async function waitRaf(page, n = 2) {
  await page.evaluate((count) => new Promise((res) => {
    let i = 0;
    const tick = () => (++i >= count ? res() : requestAnimationFrame(tick));
    requestAnimationFrame(tick);
  }), n);
}

async function waitForScore(page) {
  await page.waitForFunction(() => !!(window.FB && FB.debug && FB.debug.S && FB.debug.S.score && FB.debug.S.score.notes.length > 0), { timeout: 25000 });
  await page.waitForTimeout(600);
}

async function captureFrames(cdp, page, ff, count, onFrame, previewOut, previewAt, clip) {
  for (let f = 0; f < count; f++) {
    if (onFrame) await onFrame(f);
    await waitRaf(page, 1);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, clip });
    const buf = Buffer.from(data, 'base64');
    if (previewOut && f === previewAt) fs.writeFileSync(previewOut, buf);
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
}

async function openBuiltin(page, file, title, composer, id) {
  await page.evaluate(([file, title, composer, id]) => {
    FB.app.open({ kind: 'builtin', file }, { id, title, composer });
  }, [file, title, composer, id]);
  await page.waitForFunction((targetId) => FB.debug.S.meta && FB.debug.S.meta.id === targetId && FB.debug.S.score, id, { timeout: 25000 });
  await page.waitForTimeout(800);
}

async function captureFormat(browser, vertical) {
  const tag = vertical ? '9x16' : '16x9';
  const outDir = vertical ? OUT9 : OUT16;
  const ctxOpts = vertical
    ? { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 };

  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();

  // Seed localStorage so first-visit doesn't auto-cover the player with the library
  await page.addInitScript(() => {
    localStorage.setItem('fallboard:v1', JSON.stringify({
      last: 'chopin-op23',
      view: 'roll',
      hand: 'both',
      speed: 1,
      recent: [{ id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23', open: { kind: 'builtin', file: 'ballade-op23' } }],
    }));
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await waitForScore(page);
  await installTapHalo(page);
  const cdp = await ctx.newCDPSession(page);
  const clip = { x: 0, y: 0, width: ctxOpts.viewport.width, height: ctxOpts.viewport.height, scale: ctxOpts.deviceScaleFactor };
  const cap = (ff, count, onFrame, previewOut, previewAt) => captureFrames(cdp, page, ff, count, onFrame, previewOut, previewAt, clip);

  const force = process.argv.includes('--force');
  const exists = (name) => !want(name) || (!force && fs.existsSync(path.join(outDir, name)) && fs.statSync(path.join(outDir, name)).size > 50000);

  // ---------------- CLIP 1: app-01-step-and-hands (8.5s = 255f) ----------------
  if (!exists('app-01-step-and-hands.mp4')) {
    const t0 = Date.now();
    await page.evaluate(() => {
      FB.debug.S.speed = 1;
      document.querySelector('#viewSeg button[data-view="roll"]').click();
      document.querySelector('#handSeg button[data-hand="both"]').click();
      FB.debug.seek(47.0, { snap: true });
    });
    await waitRaf(page, 4);

    const { ff, done } = encodePipe(path.join(outDir, 'app-01-step-and-hands.mp4'), FPS);
    await cap(ff, 255, async (f) => {
      // 4 crisp steps at f=10, 34, 58, 82 (every 0.8s)
      if ([10, 34, 58, 82].includes(f)) {
        await page.evaluate(() => { window.__tapAt('#nextBtn'); FB.debug.step(1); document.activeElement?.blur(); });
      }
      // Open hand menu at f=102, select Left at f=116
      if (f === 102) await page.evaluate(() => { window.__tapAt('#handToggle'); document.getElementById('handToggle').click(); document.activeElement?.blur(); });
      if (f === 116) await page.evaluate(() => { window.__tapAt('#handSeg button[data-hand="L"]'); document.querySelector('#handSeg button[data-hand="L"]').click(); document.activeElement?.blur(); });
      if (f === 132) await page.evaluate(() => { document.getElementById('handToggle').click(); document.activeElement?.blur(); });
      // Smooth playback during Left hand isolated (f=120..176)
      if (f >= 120 && f < 176) {
        await page.evaluate(() => {
          document.getElementById('playBtn').classList.add('is-playing');
          FB.debug.S.t += 1 / 30;
        });
      }
      // Back to Both + open Speed dial to 50%
      if (f === 176) await page.evaluate(() => { document.getElementById('handToggle').click(); document.activeElement?.blur(); });
      if (f === 184) await page.evaluate(() => { window.__tapAt('#handSeg button[data-hand="both"]'); document.querySelector('#handSeg button[data-hand="both"]').click(); document.activeElement?.blur(); });
      if (f === 192) await page.evaluate(() => { document.getElementById('handToggle').click(); window.__tapAt('#speedToggle'); document.getElementById('speedToggle').click(); document.activeElement?.blur(); });
      if (f === 204) {
        // Click 50% on speed track (index 1 of 7 -> 1/6 across)
        await page.evaluate(() => {
          const track = document.getElementById('speedTrack');
          const r = track.getBoundingClientRect();
          const x = r.left + r.width * (1 / 6);
          const y = r.top + r.height / 2;
          document.getElementById('speed').dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
          document.getElementById('speed').dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true }));
        });
      }
      if (f >= 190) {
        await page.evaluate(() => {
          const sp = FB.debug.S.speed || 1;
          FB.debug.S.t += (1 / 30) * sp;
        });
      }
    }, path.join(PREV, `${tag}-app-01-step.jpg`), 145);

    ff.stdin.end();
    await done;
    await page.evaluate(() => {
      document.getElementById('playBtn').classList.remove('is-playing');
      document.getElementById('speedReset').click();
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    console.log(`[${tag}] app-01-step-and-hands.mp4 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ---------------- CLIP 2: app-02-roll-to-score (7.5s = 225f) ----------------
  if (!exists('app-02-roll-to-score.mp4')) {
    const t0 = Date.now();
    // Pre-warm score engraving once so the toggle is instant!
    await page.evaluate(() => {
      FB.debug.seek(47.8, { snap: true });
      document.querySelector('#viewSeg button[data-view="score"]').click();
    });
    await page.waitForSelector('.sys svg', { timeout: 25000 });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      document.querySelector('#viewSeg button[data-view="roll"]').click();
      FB.debug.seek(47.8, { snap: true });
      document.getElementById('playBtn').classList.add('is-playing');
    });
    await waitRaf(page, 4);

    const { ff, done } = encodePipe(path.join(outDir, 'app-02-roll-to-score.mp4'), FPS);
    await cap(ff, 225, async (f) => {
      if (f === 68) {
        await page.evaluate(() => {
          window.__tapAt('#viewSeg button[data-view="score"]');
          document.querySelector('#viewSeg button[data-view="score"]').click();
        });
      }
      if (f === 182) {
        await page.evaluate(() => {
          window.__tapAt('#viewSeg button[data-view="roll"]');
          document.querySelector('#viewSeg button[data-view="roll"]').click();
        });
      }
      await page.evaluate(() => { FB.debug.S.t += 1 / 30; });
    }, path.join(PREV, `${tag}-app-02-score.jpg`), 115);

    ff.stdin.end();
    await done;
    await page.evaluate(() => { document.getElementById('playBtn').classList.remove('is-playing'); });
    console.log(`[${tag}] app-02-roll-to-score.mp4 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ---------------- CLIP 3: app-03-color-worlds (6.0s = 180f, 3 pieces × 2s) ----------------
  if (!exists('app-03-color-worlds.mp4')) {
    const t0 = Date.now();
    const { ff, done } = encodePipe(path.join(outDir, 'app-03-color-worlds.mp4'), FPS);
    const worlds = [
      { file: 'ballade-op23', id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23', seek: 52.0 },
      { file: 'rach-cs', id: 'rachmaninoff-op3-2', title: 'Prelude in C♯ minor', composer: 'Sergei Rachmaninoff, Op. 3 No. 2', seek: 3.5 },
      { file: 'revolutionary', id: 'chopin-op10-12', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12', seek: 4.0 },
    ];
    for (let wi = 0; wi < worlds.length; wi++) {
      const w = worlds[wi];
      await openBuiltin(page, w.file, w.title, w.composer, w.id);
      await page.evaluate((s) => {
        document.querySelector('#viewSeg button[data-view="roll"]').click();
        FB.debug.seek(s, { snap: true });
        document.getElementById('playBtn').classList.add('is-playing');
      }, w.seek);
      await waitRaf(page, 4);
      await cap(ff, 60, async () => {
        await page.evaluate(() => { FB.debug.S.t += 1 / 30; });
      }, wi === 1 ? path.join(PREV, `${tag}-app-03-world2.jpg`) : null, 30);
    }
    ff.stdin.end();
    await done;
    await page.evaluate(() => { document.getElementById('playBtn').classList.remove('is-playing'); });
    console.log(`[${tag}] app-03-color-worlds.mp4 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  }

  // ---------------- CLIP 4: app-04-library-henle-pdf (9.0s = 270f) ----------------
  if (!exists('app-04-library-henle-pdf.mp4')) {
    const t0 = Date.now();
    // Ensure all 3 built-ins are in recent so Continue shelf looks lush even when app-03 was skipped
    for (const w of [
      { file: 'ballade-op23', id: 'chopin-op23', title: 'Ballade No. 1 in G minor', composer: 'Frédéric Chopin, Op. 23' },
      { file: 'rach-cs', id: 'rachmaninoff-op3-2', title: 'Prelude in C♯ minor', composer: 'Sergei Rachmaninoff, Op. 3 No. 2' },
      { file: 'revolutionary', id: 'chopin-op10-12', title: 'Revolutionary Étude', composer: 'Frédéric Chopin, Op. 10 No. 12' },
    ]) {
      await openBuiltin(page, w.file, w.title, w.composer, w.id);
    }
    // Open library cleanly (now recent has all 3 pieces with rich thumbnails!)
    await page.evaluate(() => { FB.library.open(); });
    await page.waitForSelector('.explore-tabs', { timeout: 20000 });
    await page.waitForTimeout(1000);
    await installTapHalo(page);

    const { ff, done } = encodePipe(path.join(outDir, 'app-04-library-henle-pdf.mp4'), FPS);

    // Part A: Library Home & scroll through Explore + Henle pills (0..80f = 2.67s)
    await cap(ff, 80, async (f) => {
      if (f >= 14 && f <= 72) {
        const p = (f - 14) / 58;
        const y = Math.round(p * 420);
        await page.evaluate((top) => { document.getElementById('libScroll').scrollTop = top; }, y);
      }
    }, path.join(PREV, `${tag}-app-04-lib.jpg`), 20);

    // Part B: Type "henle 6" in search bar (80..150f = 2.33s)
    const searchChars = 'henle 6';
    await cap(ff, 70, async (f) => {
      if (f === 2) {
        await page.evaluate(() => {
          window.__tapAt('#libSearch');
          document.getElementById('libQuery').focus();
        });
      }
      if (f >= 8 && f < 8 + searchChars.length * 4 && (f - 8) % 4 === 0) {
        const idx = (f - 8) / 4;
        const val = searchChars.slice(0, idx + 1);
        await page.evaluate((v) => {
          const inp = document.getElementById('libQuery');
          inp.value = v;
          inp.dispatchEvent(new Event('input', { bubbles: true }));
        }, val);
      }
    }, path.join(PREV, `${tag}-app-04-search.jpg`), 55);

    // Part C: Tap the first playable Henle 6 result row -> iOS slide into cover + A4 sheet music!
    await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#libPage .row')];
      const pick = rows.find((r) => !r.querySelector('.dot')) || rows[0];
      if (pick) { window.__tapAt(pick); pick.click(); }
    });
    await page.waitForSelector('.sheet-page img', { timeout: 90000 });
    await page.waitForTimeout(500);

    // Capture cover + scroll down to A4 sheet music + zoom into full-screen PDF page (120f = 4.0s)
    await cap(ff, 120, async (f) => {
      if (f >= 28 && f <= 66) {
        const p = (f - 28) / 38;
        await page.evaluate((frac) => {
          const sc = document.getElementById('libScroll');
          sc.scrollTop = Math.round(frac * (sc.scrollHeight - sc.clientHeight));
        }, p);
      }
      if (f === 78) {
        await page.evaluate(() => {
          window.__tapAt('.sheet-page');
          const pg = document.querySelector('.sheet-page');
          if (pg) pg.click();
        });
      }
    }, path.join(PREV, `${tag}-app-04-pdf.jpg`), 98);

    ff.stdin.end();
    await done;
    console.log(`[${tag}] app-04-library-henle-pdf.mp4 in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
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
