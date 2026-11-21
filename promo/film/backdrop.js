/* The locked backdrop: the Continue card's renderer (FB.rollGL.thumb) with a cover mesh and real
   falling notes, faded to black in an ellipse weighted to the bottom (asymmetric C∞ curve, OKLCH,
   quadratic linear-light blur, dithered). Moved here unchanged from promo/src/scenes.html, where
   the stills were signed off; only the palettes it can be asked for were added. */
(function () {
  'use strict';
  const PALETTES = {
    orchid: {
      base: '#4d1499',
      fields: [
        { c: '#9b38f2', x: 84, y: 18, w: 92, h: 86, stop: 10 },
        { c: '#ff6fb2', x: 18, y: 24, w: 88, h: 78, stop: 8 },
        { c: '#ffd0ea', x: 10, y: 8, w: 62, h: 52, stop: 0 },
        { c: '#5a1aa8', x: 58, y: 86, w: 96, h: 80, stop: 14 },
      ],
      hands: ['#ff9ad0', '#a557ff'],
    },
    lagoon: {
      base: '#05396b',
      fields: [
        { c: '#0a6bd8', x: 22, y: 28, w: 90, h: 82, stop: 12 },
        { c: '#1fd3c3', x: 82, y: 72, w: 88, h: 80, stop: 8 },
        { c: '#bafff0', x: 92, y: 90, w: 58, h: 48, stop: 0 },
        { c: '#063e7a', x: 52, y: 14, w: 95, h: 76, stop: 14 },
      ],
      hands: ['#6ff0dc', '#3a86ff'],
    },
    dusk: {
      base: '#1d1450',
      fields: [
        { c: '#5b3fe0', x: 18, y: 30, w: 88, h: 84, stop: 10 },
        { c: '#ef6aa6', x: 82, y: 22, w: 84, h: 74, stop: 8 },
        { c: '#ffb489', x: 90, y: 82, w: 66, h: 58, stop: 4 },
        { c: '#2a1a6e', x: 46, y: 78, w: 94, h: 82, stop: 14 },
      ],
      hands: ['#ffb489', '#8f63ff'],
    },
    claret: {
      base: '#470b1a',
      fields: [
        { c: '#8e1c36', x: 24, y: 26, w: 90, h: 84, stop: 10 },
        { c: '#d9504e', x: 82, y: 66, w: 84, h: 76, stop: 8 },
        { c: '#f6b388', x: 92, y: 88, w: 56, h: 48, stop: 0 },
        { c: '#5a0f22', x: 50, y: 14, w: 96, h: 78, stop: 14 },
      ],
      hands: ['#f7b48a', '#e0435f'],
    },
  };

  let balladeScore = null, denseT0 = 47.0;
  function sliceRoll(sc, t0, dur = 8.0) {
    const notes = [];
    for (const n of sc.notes) {
      if (n.t1 < t0 - 0.02 || n.t0 >= t0 + dur) continue;
      const start = Math.max(0, Math.round((n.t0 - t0) * 100));
      const end = Math.round((Math.min(n.t1, t0 + dur) - Math.max(n.t0, t0)) * 100);
      if (end < 3) continue;
      notes.push(start, Math.max(5, end), n.midi, n.hand);
      if (notes.length >= 360 * 4) break;
    }
    return { end: Math.round(dur * 100), notes };
  }
  async function init() {
    if (balladeScore) return;
    const xml = await (await fetch('/scores/ballade-op23.musicxml')).text();
    balladeScore = await FB.parseScore(xml);
    let bestT = 47.0, bestScore = 0;
    for (const ot of balladeScore.onsets.both) {
      if (ot < 10 || ot > 260) continue;
      const chord = balladeScore.notes.filter((n) => Math.abs(n.t0 - ot) < 0.03);
      if (chord.length < 4) continue;
      const hands = new Set(chord.map((n) => n.hand)).size;
      const avgChordDur = chord.reduce((s, n) => s + (n.t1 - n.t0), 0) / chord.length;
      const follow = balladeScore.notes.filter((n) => n.t0 > ot && n.t0 < ot + 6.0);
      const avgFollowDur = follow.length ? follow.reduce((s, n) => s + (n.t1 - n.t0), 0) / follow.length : 0;
      if (avgChordDur < 0.35 || avgFollowDur < 0.28 || follow.length > 55) continue;
      const scVal = chord.length * 14 + (hands > 1 ? 20 : 0) + Math.min(25, avgChordDur * 18) + Math.min(25, avgFollowDur * 25);
      if (scVal > bestScore) { bestScore = scVal; bestT = ot; }
    }
    denseT0 = bestT;
  }

  /* WebGL2 2-pass linear-light quadratic progressive blur + asymmetric C∞ OKLCH fade + ±0.5 LSB IGN dithering */
  const oklchFade = (() => {
    const glc = document.createElement('canvas');
    const gl = glc.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true });
    if (!gl) return null;
    const vs = `#version 300 es
      void main() {
        vec2 p = vec2((gl_VertexID & 1) * 2 - 1, (gl_VertexID >> 1) * 2 - 1);
        gl_Position = vec4(p, 0.0, 1.0);
      }`;
    const fs = `#version 300 es
      precision highp float;
      uniform sampler2D uTex;
      uniform vec2 uSize, uDir;
      uniform vec4 uEll;
      uniform vec2 uAsym;
      uniform float uMostBlur, uDoFade;
      out vec4 o;
      vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
      vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
      float asymKeep(float d, float a, float b) {
        if (d <= 0.0) return 1.0;
        if (d >= 1.0) return 0.0;
        return 1.0 / (1.0 + exp(a / (1.0 - d) - b / d));
      }
      vec3 rgbToOklab(vec3 c) {
        float l = 0.4122214708 * c.r + 0.5363325363 * c.g + 0.0514459929 * c.b;
        float m = 0.2119034982 * c.r + 0.6806995451 * c.g + 0.1073969566 * c.b;
        float s = 0.0883024619 * c.r + 0.2817188376 * c.g + 0.6299787005 * c.b;
        float l_ = pow(max(l, 0.0), 1.0 / 3.0);
        float m_ = pow(max(m, 0.0), 1.0 / 3.0);
        float s_ = pow(max(s, 0.0), 1.0 / 3.0);
        return vec3(
          0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
          1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
          0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
        );
      }
      vec3 oklabToRgb(vec3 c) {
        float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
        float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
        float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
        float l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
        return vec3(
          +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
          -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
          -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
        );
      }
      float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }

      void main() {
        vec2 fc = gl_FragCoord.xy;
        vec2 uv = vec2(fc.x / uSize.x, 1.0 - fc.y / uSize.y);
        float d = clamp(length((uv - uEll.xy) / uEll.zw), 0.0, 1.0);
        float keep = asymKeep(d, uAsym.x, uAsym.y);
        float fadeOut = 1.0 - keep;

        if (uDoFade > 0.5 && keep <= 0.00001) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }

        float sigma = uMostBlur * fadeOut * fadeOut;
        vec3 lin;
        if (sigma < 0.35) {
          lin = dec(texture(uTex, fc / uSize).rgb);
        } else {
          vec3 acc = vec3(0.0); float sum = 0.0;
          for (int i = -12; i <= 12; i++) {
            float x = float(i) * sigma * 0.25;
            float wgt = exp(-0.5 * float(i * i) / 18.0);
            vec2 suv = clamp((fc + uDir * x) / uSize, vec2(0.0), vec2(1.0));
            acc += dec(texture(uTex, suv).rgb) * wgt;
            sum += wgt;
          }
          lin = acc / sum;
        }

        if (uDoFade > 0.5) {
          vec3 lab = rgbToOklab(lin);
          float L = lab.x * keep;
          float cScale = keep * (1.0 + 0.45 * (1.0 - keep));
          lin = oklabToRgb(vec3(L, lab.y * cScale, lab.z * cScale));
          float mn = min(min(lin.r, lin.g), lin.b);
          if (mn < 0.0) {
            float lum = max(0.0001, 0.2126 * lin.r + 0.7152 * lin.g + 0.0722 * lin.b);
            float t = lum / (lum - mn);
            lin = mix(vec3(lum), lin, t);
          }
          vec3 srgb = enc(clamp(lin, 0.0, 1.0));
          float dither = (ign(fc) + ign(fc + vec2(17.0, 31.0)) - 1.0) / 255.0;
          o = vec4(clamp(srgb + dither, 0.0, 1.0), 1.0);
          return;
        }
        o = vec4(enc(clamp(lin, 0.0, 1.0)), 1.0);
      }`;
    const comp = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return sh; };
    const prog = gl.createProgram();
    gl.attachShader(prog, comp(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, comp(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    const u = {};
    for (const k of ['uTex', 'uSize', 'uDir', 'uEll', 'uAsym', 'uMostBlur', 'uDoFade']) u[k] = gl.getUniformLocation(prog, k);
    const mkTex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const tIn = mkTex(), tMid = mkTex(), fbo = gl.createFramebuffer(), vao = gl.createVertexArray();
    return function apply(srcCanvas, cx, cy, rx, ry, a, b, mostBlurPx) {
      const cw = srcCanvas.width, ch = srcCanvas.height;
      if (glc.width !== cw || glc.height !== ch) {
        glc.width = cw; glc.height = ch;
        gl.bindTexture(gl.TEXTURE_2D, tMid);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      }
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tIn);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
      gl.useProgram(prog); gl.bindVertexArray(vao); gl.viewport(0, 0, cw, ch);
      gl.uniform1i(u.uTex, 0); gl.uniform2f(u.uSize, cw, ch);
      gl.uniform4f(u.uEll, cx, cy, rx, ry); gl.uniform2f(u.uAsym, a, b);
      gl.uniform1f(u.uMostBlur, mostBlurPx);

      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tMid, 0);
      gl.bindTexture(gl.TEXTURE_2D, tIn);
      gl.uniform2f(u.uDir, 1, 0); gl.uniform1f(u.uDoFade, 0.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.bindTexture(gl.TEXTURE_2D, tMid);
      gl.uniform2f(u.uDir, 0, 1); gl.uniform1f(u.uDoFade, 1.0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.bindVertexArray(null);
      return glc;
    };
  })();

  /* the falling notes move: each frame slides the slice window forward */
  let tmpCanvas = null;
  const spanCache = new Map();
  function render(c, paletteKey, rollOffsetSec, opts = {}) {
    const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
    const vert = w < h;
    const cw = Math.round(w * dpr), ch = Math.round(h * dpr);
    const pal = PALETTES[paletteKey] || PALETTES.orchid;

    const optScale = vert ? 0.62 : 0.48;
    const lw = Math.round(w * optScale);
    const lh = Math.round(h * optScale);
    const effDpr = cw / lw;

    // the keyboard span stays on the first chord window, so the notes never jitter sideways
    const spanKey = `${vert ? 'v' : 'h'}`;
    let span = spanCache.get(spanKey);
    if (!span) {
      const refRoll = sliceRoll(balladeScore, denseT0, 8.0);
      const notes = refRoll.notes;
      let lo = 127, hi = 0;
      for (let i = 0; i < notes.length; i += 4) { lo = Math.min(lo, notes[i + 2]); hi = Math.max(hi, notes[i + 2]); }
      const whiteOf = (m) => { let n = 0; for (let k = 21; k < m; k++) if (!FB.isBlack(k)) n++; return n; };
      const wLo = whiteOf(lo), wHi = whiteOf(hi) + 1;
      const wSpan = Math.max(12, wHi - wLo);
      const wMid = (wLo + wHi) * 0.5;
      const mult = vert ? 1.85 : 2.35;
      const totalW = wSpan * mult;
      span = [wMid - totalW * 0.5, wMid + totalW * 0.5];
      spanCache.set(spanKey, span);
    }

    const roll = sliceRoll(balladeScore, denseT0 + rollOffsetSec, 8.0);
    if (!tmpCanvas) {
      tmpCanvas = document.createElement('canvas');
      tmpCanvas.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;';
      document.body.appendChild(tmpCanvas);
    }
    tmpCanvas.style.width = lw + 'px';
    tmpCanvas.style.height = lh + 'px';

    FB.rollGL.thumb(tmpCanvas, {
      roll,
      hands: pal.hands,
      cover: { base: pal.base, fields: pal.fields },
      span,
      glass: false,
      dpr: effDpr,
    });

    const cx = 0.5;
    const cy = opts.cy ?? 1.12;
    const rx = opts.rx ?? (vert ? 1.35 : 1.24);
    const ry = opts.ry ?? (vert ? 1.04 : 1.06);
    const a = opts.a ?? 0.65;
    const b = opts.b ?? 0.45;
    const mostBlur = (opts.blur ?? 10) * dpr;
    const faded = oklchFade ? oklchFade(tmpCanvas, cx, cy, rx, ry, a, b, mostBlur) : tmpCanvas;

    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
    const ctx = c.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(faded, 0, 0, cw, ch);
    return c;
  }

  window.Backdrop = { init, render, PALETTES };
})();
