/* The roll and the keys, lit (js/roll-gl.js). Called from drawRoll and drawKbd in js/app.js;
   where WebGL 2 is missing or its context is lost, roll() returns false and the player draws its
   flat roll instead.

   The roll is three passes:
     1. the light field, into a texture at 0.6 of the screen's resolution (it is smooth, so this
        costs nothing visible). At each point, for each hand,
          v = 1 / (dk^(1/4) + dn + 0.1)^4
        dk: the height above the keys, 1 at half the roll's height; dn: the distance to the hand's
        nearest note, 1 at 8 px (the 48 notes nearest the keys). Both hands' v are added, with the
        heat strip's (below), and
          g = smootherstep(v / (v + 2))
        is coloured from black through the hand's colour (lightness 0.5) to white, both falloffs
        the fourth root; its lightness is then g^p, p from 1 to 1.5 with animated 3D simplex noise
        (one octave, drifting up 40 px a second), so the noise breaks the dim light up and leaves the
        bright light alone.
     2. that texture onto the screen, with the player's grid (lanes under the black keys, lines at
        C and F, bar and beat lines) added under the light at full resolution, in linear light.
     3. the notes, as tinted glass lit through their edges, bending the field behind them.
   The heat strip: along the keys, how long each has sounded, on a logarithm, cooling in a third of
   a second; it lifts the field above warm keys and adds a low bloom. It is never drawn.

   Colours come from the piece's cover (FB.pieceLook in js/library.js): two of its palette's
   colours, the lighter to the right hand, which the piece carries as meta.hands. An upload has a
   palette chosen from its name. There are no others: until they are known nothing is coloured.

   The keys: a white keyboard, neutral, below a black line, each white key a rounded rectangle, so
   black dents show between them at the top and bottom, with hairline seams between. A struck key
   wears one of the roll's notes, sounding, drawn by the roll's own note shader over the key, the
   key showing through it. Keys light
   fully the moment a note starts and go dark within 60 ms of its end. The hands' icons
   (--hand-r, --hand-l) and the sounding notes in the score (--note-r, --note-l) take the hands'
   colours. */
(function () {
  'use strict';
  const FB = (window.FB = window.FB || {});
  const NOTES = 48, HEAT_N = 256, HEAT_ROWS = 16, HEAT_STEP = 40, FIELD_RES = 0.6, RELEASE = 0.06;
  const STILL = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  /* The app's fades (here, and js/library.js, index.html): curves whose every derivative is
     continuous, so a fade has no start, end or crease the eye can find. The smooth step, 0 to 1
     over [0, 1], flat at both ends; the smooth ramp, 0 at 0 and 1 at 1, flat where it starts */
  const smoothStep = (t) => (t <= 0 ? 0 : t >= 1 ? 1 : 1 / (1 + Math.exp(1 / t - 1 / (1 - t))));
  const smoothRamp = (t) => (t <= 0 ? 0 : Math.exp(1.45 * (1 - 1 / t)));
  FB.smoothStep = smoothStep; FB.smoothRamp = smoothRamp;
  const SMOOTH_GLSL = `
    float smoothStep(float t) { return t <= 0.0 ? 0.0 : t >= 1.0 ? 1.0 : 1.0 / (1.0 + exp(1.0 / t - 1.0 / (1.0 - t))); }
    float smoothRamp(float t) { return t <= 0.0 ? 0.0 : exp(1.45 * (1.0 - 1.0 / t)); }`;

  /* ------------------------------------------------------------------ colour (OKLab) */
  const lin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const enc = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
  const hexLin = (hex) => { const n = parseInt(hex.slice(1), 16); return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)]; };
  function toLab([r, g, b]) {
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  function fromLab([L, a, b]) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  }
  const toLch = (rgb) => { const [L, a, b] = toLab(rgb); return [L, Math.hypot(a, b), Math.atan2(b, a)]; };
  /* linear rgb of an OKLCH colour, its chroma brought down until the screen can show it */
  function lch(L, C, h) {
    let lo = 0, hi = C, out = fromLab([L, 0, 0]);
    for (let i = 0; i < 14; i++) {
      const c = (lo + hi) / 2, rgb = fromLab([L, c * Math.cos(h), c * Math.sin(h)]);
      if (rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)) { lo = c; out = rgb; } else hi = c;
    }
    return out.map((v) => clamp(v, 0, 1));
  }
  const srgb = (rgb) => rgb.map((v) => enc(clamp(v, 0, 1)));
  const css = (rgb, a = 1) => `rgba(${srgb(rgb).map((v) => Math.round(v * 255)).join(',')},${a})`;
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const lift = (rgb, t) => { const [L, C, h] = toLch(rgb); return lch(L + (0.97 - L) * t, C, h); };

  /* ------------------------------------------------------------------ the piece's colours */
  /* a piece's hands, [right, left] hex: its cover palette's two hand colours (the palette's fifth
     entry, js/library.js FB.pieceLook), which the piece carries as meta.hands. There is no other
     pair: until a piece's are known its notes are not drawn */
  const handsMade = new Map();
  function handsOf(hex) {
    if (!hex) return null;
    const key = hex.join();
    if (!handsMade.has(key)) {
      handsMade.set(key, hex.map((x) => handColours(hexLin(x))));
      if (handsMade.size > 40) handsMade.delete(handsMade.keys().next().value);
    }
    return handsMade.get(key);
  }
  /* the player's: the hands' icons and the sounding notes in the score take the same colours */
  let shown = null;
  function colours(env) {
    const hands = handsOf(env.S.meta && env.S.meta.hands);
    if (hands && hands !== shown) {
      shown = hands;
      const root = document.documentElement.style;
      root.setProperty('--hand-r', css(hands[0].lin)); root.setProperty('--hand-l', css(hands[1].lin));
      root.setProperty('--note-r', css(hands[0].score)); root.setProperty('--note-l', css(hands[1].score));
    }
    return hands;
  }
  /* the flat roll's colours (js/app.js drawRoll, without WebGL 2): each hand's note, a deeper one
     for black keys' notes, a lighter one for the attack and the notes sounding */
  function flat(env) {
    const hands = colours(env);
    if (!hands) return null;
    const out = {};
    hands.forEach((hc, i) => {
      const k = i ? 'lh' : 'rh', [L, C, h] = toLch(hc.lin);
      out[k] = css(hc.lin); out[k + '-key'] = css(lch(L * 0.78, C, h)); out[k + '-hot'] = css(lift(hc.lin, 0.5));
    });
    return out;
  }
  function handColours(rgb) {
    const [, C, h] = toLch(rgb);
    /* on the keys: the hue as vivid as the screen can show it at a middle lightness: where the hue
       is most vivid (yellow light, blue dark), held within 0.5..0.62, since a colour that strong
       reads best neither light nor dark */
    const vivid = (L) => lch(clamp(L, 0.05, 0.97), 0.4, h);
    let cusp = 0.6, best = -1;
    for (let L = 0.3; L <= 0.97; L += 0.01) { const c = toLch(vivid(L))[1]; if (c > best) { best = c; cusp = L; } }
    const kL = clamp(cusp, 0.5, 0.62);
    return {
      lin: rgb,                                         // the bloom's colour
      note: srgb(rgb), rim: srgb(lift(rgb, 0.55)),      // a glass note's tint and its rim light
      score: lift(rgb, 0.3),                            // a sounding note in the score, on its dark paper
      lab: toLab(lch(0.5, Math.min(0.22, C * 1.5), h)), // the field's colour, at lightness 0.5
      key: vivid(kL),
    };
  }

  /* ------------------------------------------------------------------ shaders */
  const QUAD_VS = `#version 300 es
    layout(location = 0) in vec2 aPos; void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;
  const COMMON = `
    vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`;
  const FIELD_FS = `#version 300 es
    precision highp float;
    uniform vec2 uRes; uniform vec2 uScale; uniform float uT; uniform float uDrift;
    uniform int uN; uniform vec4 uNote[${NOTES}]; uniform float uHand[${NOTES}];
    uniform vec3 uLabR; uniform vec3 uLabL; uniform vec3 uToneR; uniform vec3 uToneL; uniform sampler2D uHeat;
    out vec4 o;
    ${COMMON}
    /* simplex noise in three dimensions (Ashima Arts / Stefan Gustavson, MIT) */
    vec4 perm(vec4 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
    float snoise(vec3 v) {
      const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0); const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
      vec3 i = floor(v + dot(v, C.yyy)); vec3 x0 = v - i + dot(i, C.xxx);
      vec3 g = step(x0.yzx, x0.xyz); vec3 l = 1.0 - g; vec3 i1 = min(g.xyz, l.zxy); vec3 i2 = max(g.xyz, l.zxy);
      vec3 x1 = x0 - i1 + C.xxx; vec3 x2 = x0 - i2 + 2.0 * C.xxx; vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
      i = mod(i, 289.0);
      vec4 p = perm(perm(perm(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
      float n_ = 1.0 / 7.0; vec3 ns = n_ * D.wyz - D.xzx;
      vec4 j = p - 49.0 * floor(p * ns.z * ns.z); vec4 x_ = floor(j * ns.z); vec4 y_ = floor(j - 7.0 * x_);
      vec4 x = x_ * ns.x + ns.yyyy; vec4 y = y_ * ns.x + ns.yyyy; vec4 h = 1.0 - abs(x) - abs(y);
      vec4 b0 = vec4(x.xy, y.xy); vec4 b1 = vec4(x.zw, y.zw);
      vec4 s0 = floor(b0) * 2.0 + 1.0; vec4 s1 = floor(b1) * 2.0 + 1.0; vec4 sh = -step(h, vec4(0.0));
      vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy; vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
      vec3 p0 = vec3(a0.xy, h.x); vec3 p1 = vec3(a0.zw, h.y); vec3 p2 = vec3(a1.xy, h.z); vec3 p3 = vec3(a1.zw, h.w);
      vec4 norm = 1.79284291400159 - 0.85373472095314 * vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3));
      p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
      vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0); m = m * m;
      return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
    }
    float box(vec2 p, vec4 r) { vec2 q = abs(p - r.xy - r.zw * 0.5) - r.zw * 0.5 + 3.0; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - 3.0; }
    vec3 labLin(vec3 c) {
      float l = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z, m = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z, s = c.x - 0.0894841775 * c.y - 1.291485548 * c.z;
      l = l * l * l; m = m * m * m; s = s * s * s;
      return vec3(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
    }
    float root4(float x) { return sqrt(sqrt(max(x, 0.0))); }
    /* black, through the hand's colour t (its lightness 0.5), to white; lightness g. Below the
       colour, lightness and colour fall together as the fourth root; above it the colour thins so */
    vec3 ramp(float g, vec3 t) { return g < 0.5 ? t * root4(2.0 * g) : vec3(g, t.yz * root4(2.0 - 2.0 * g)); }
    float rampL(float g) { return g < 0.5 ? 0.5 * root4(2.0 * g) : g; }
    void main() {
      vec2 px = vec2(gl_FragCoord.x / uScale.x, uRes.y - gl_FragCoord.y / uScale.y);
      float up = max(uRes.y - px.y, 0.0);
      float dR = 1e4, dL = 1e4;
      for (int i = 0; i < ${NOTES}; i++) {
        if (i >= uN) break;
        float d = max(box(px, uNote[i]), 0.0);
        if (uHand[i] < 0.5) dR = min(dR, d); else dL = min(dL, d);
      }
      float n = 0.5 + 0.5 * snoise(vec3(vec2(px.x, px.y + uDrift) * 0.03, uT * 0.35 + 7.0));
      float xs = px.x / uRes.x;
      vec2 heatUp = texture(uHeat, vec2(xs, (clamp(up / 80.0, 0.0, 15.0) + 0.5) / 16.0)).rg;
      vec2 wide = texture(uHeat, vec2(xs, (clamp(up / 40.0, 0.0, 15.0) + 0.5) / 16.0)).rg;
      float dk = up / (uRes.y * 0.5), kp = root4(dk), qH = dk * 1.5 + 0.7;
      float qR = kp + dR / 8.0 + 0.1, qL = kp + dL / 8.0 + 0.1;
      qR *= qR; qL *= qL;
      float vR = 1.0 / (qR * qR) + heatUp.r / (qH * qH);
      float vL = 1.0 / (qL * qL) + heatUp.g / (qH * qH);
      float v = vR + vL, share = vR / max(v, 1e-6);
      float g = clamp(v / (v + 2.0), 0.0, 1.0);
      g = g * g * g * (g * (g * 6.0 - 15.0) + 10.0);
      float L = pow(g, mix(1.0, 1.5, smoothstep(0.25, 0.75, n)));
      /* the colour from the clean g, both hands' hues blended without going grey; the lightness
         the ramp's own at the noisy L */
      vec3 a = ramp(g, uLabL), b = ramp(g, uLabR);
      vec3 lab = mix(a, b, share);
      float ch = mix(length(a.yz), length(b.yz), share);
      if (length(lab.yz) > 1e-4) lab.yz = normalize(lab.yz) * ch;
      lab *= rampL(L) / max(lab.x, 1e-5);
      vec3 col = max(labLin(lab), 0.0) + (uToneR * wide.r + uToneL * wide.g) * 0.08 / (1.0 + pow(up / 70.0, 2.0));
      o = vec4(enc(min(col, vec3(1.0))) + (hash(gl_FragCoord.xy) - 0.5) / 255.0, 1.0);
    }`;
  /* the field onto the screen, with the player's grid under its light */
  const SCREEN_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uTex; uniform vec2 uSize; uniform float uDpr;
    uniform float uW, uLeft, uBW; uniform vec3 uLane, uGrid, uGrid2;
    uniform int uNBar, uNBeat; uniform float uBar[64]; uniform float uBeat[64];
    out vec4 o;
    vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    void main() {
      vec3 col = dec(texture(uTex, gl_FragCoord.xy / uSize).rgb);
      vec2 px = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y) / uDpr;
      /* u: position in white keys, which run A B C D E F G from index 0; b: the nearest boundary
         between two; only B and E have no black key after them */
      float u = px.x / uW + uLeft, b = floor(u + 0.5), j = mod(b - 1.0, 7.0), jb = mod(b, 7.0);
      vec3 g = vec3(0.0);
      if (abs(j - 1.0) > 0.5 && abs(j - 4.0) > 0.5 && abs(u - b) * uW < uBW * 0.5) g = uLane;
      float lx = floor((b - uLeft) * uW + 0.5);
      if (px.x >= lx && px.x < lx + 1.0) { if (abs(jb - 2.0) < 0.5) g = max(g, uGrid2); else if (abs(jb - 5.0) < 0.5) g = max(g, uGrid); }
      for (int i = 0; i < 64; i++) { if (i >= uNBeat) break; if (px.y >= uBeat[i] && px.y < uBeat[i] + 1.0) g = max(g, uGrid); }
      for (int i = 0; i < 64; i++) { if (i >= uNBar) break; if (px.y >= uBar[i] && px.y < uBar[i] + 1.0) g = max(g, uGrid2); }
      o = vec4(enc(col + g), 1.0);
    }`;
  const NOTE_VS = `#version 300 es
    layout(location = 0) in vec2 aCorner; layout(location = 1) in vec4 iRect; layout(location = 2) in vec4 iA; layout(location = 3) in vec4 iB; layout(location = 4) in vec2 iParm;
    uniform vec2 uRes;
    out vec2 vP; out vec2 vHalf; out vec4 vA; out vec4 vB; out vec2 vParm;
    void main() {
      vec2 size = iRect.zw + 2.0, px = iRect.xy - 1.0 + aCorner * size;
      vP = (aCorner - 0.5) * size; vHalf = iRect.zw * 0.5; vA = iA; vB = iB; vParm = iParm;
      gl_Position = vec4(px.x / uRes.x * 2.0 - 1.0, 1.0 - px.y / uRes.y * 2.0, 0.0, 1.0);
    }`;
  /* a note: a tinted slab of glass lit through its edges. What lies behind shows through, bent toward
     the middle near the edges as a thick pane bends it; the tint is deep, so the slab is its hand's
     colour even over black; the light is in the rim, a hairline fading inward within a few pixels,
     and at the foot where the note begins. vA: tint, and how deep (notes on black keys sit a little
     deeper); vB: rim colour, and how far it has faded (a key's release); vParm: corner radius, sounding now */
  const NOTE_FS = `#version 300 es
    precision highp float;
    in vec2 vP; in vec2 vHalf; in vec4 vA; in vec4 vB; in vec2 vParm;
    uniform float uDpr; uniform sampler2D uBg; uniform vec2 uSize;
    out vec4 o;
    ${COMMON}
    float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
    void main() {
      float d = box(vP, vHalf, min(vParm.x, min(vHalf.x, vHalf.y)));
      float cov = clamp(0.5 - d * uDpr, 0.0, 1.0) * (1.0 - vB.a), hot = vParm.y, inner = max(-d, 0.0), fromFoot = vHalf.y - vP.y;
      vec2 gr = vec2(dFdx(d), dFdy(d));
      vec2 nrm = length(gr) > 1e-5 ? normalize(gr) : vec2(0.0);
      vec3 behind = pow(texture(uBg, (gl_FragCoord.xy - nrm * 11.0 * exp(-inner / 3.5) * uDpr) / uSize).rgb, vec3(2.2));
      vec3 tone = pow(vA.rgb, vec3(2.2)), lite = pow(vB.rgb, vec3(2.2));
      vec3 col = tone * (0.24 + 0.26 * hot) * vA.a;
      col += behind * mix(vec3(1.0), tone * 1.6, 0.5) * 1.5;
      col += lite * (exp(-inner / 0.8) * 0.85 + exp(-inner / 4.0) * (0.2 + 0.2 * hot));
      col += lite * exp(-fromFoot / 4.0) * (0.35 + 0.3 * hot);
      o = vec4((enc(col) + (hash(gl_FragCoord.xy) - 0.5) * 0.012) * cov, cov);
    }`;

  /* ------------------------------------------------------------------ WebGL */
  let gl = null, glc = null, failed = false, lost = false;
  let fieldP, screenP, noteP, UF, US, UN, quadVao, noteVao, instBuf, fbo, fieldTex, heatTex;
  const heatPx = new Uint8Array(HEAT_N * HEAT_ROWS * 4);
  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    return p;
  }
  const uni = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
  function texture(w, h, data) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    return t;
  }
  function init() {
    glc = document.createElement('canvas');
    /* a lost context draws the flat roll until it is given back; then everything is made again */
    glc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; lost = true; });
    glc.addEventListener('webglcontextrestored', () => { lost = false; });
    gl = glc.getContext('webgl2', { alpha: false, antialias: false, premultipliedAlpha: true });
    if (!gl) throw new Error('no WebGL 2');
    fieldP = compile(QUAD_VS, FIELD_FS); screenP = compile(QUAD_VS, SCREEN_FS); noteP = compile(NOTE_VS, NOTE_FS);
    UF = uni(fieldP, ['uRes', 'uScale', 'uT', 'uDrift', 'uN', 'uNote', 'uHand', 'uLabR', 'uLabL', 'uToneR', 'uToneL', 'uHeat']);
    US = uni(screenP, ['uTex', 'uSize', 'uDpr', 'uW', 'uLeft', 'uBW', 'uLane', 'uGrid', 'uGrid2', 'uNBar', 'uNBeat', 'uBar', 'uBeat']);
    UN = uni(noteP, ['uRes', 'uDpr', 'uBg', 'uSize']);
    quadVao = gl.createVertexArray(); gl.bindVertexArray(quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    /* a note instance: rect (4), tint and depth (4), rim colour (3, and a spare), radius and hot (2) */
    noteVao = gl.createVertexArray(); gl.bindVertexArray(noteVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    [[1, 4, 0], [2, 4, 16], [3, 4, 32], [4, 2, 48]].forEach(([loc, size, off]) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 56, off); gl.vertexAttribDivisor(loc, 1); });
    gl.bindVertexArray(null);
    heatTex = texture(HEAT_N, HEAT_ROWS, heatPx);
    fieldTex = texture(1, 1, null);
    fbo = gl.createFramebuffer();
  }

  /* one pass of a running box blur; three in a row come close to a Gaussian */
  const blurA = new Float32Array(HEAT_N), blurB = new Float32Array(HEAT_N);
  function boxPass(src, dst, r) {
    const n = src.length;
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[clamp(k, 0, n - 1)];
    for (let i = 0; i < n; i++) { dst[i] = acc / (2 * r + 1); acc += src[Math.min(n - 1, i + r + 1)] - src[Math.max(0, i - r)]; }
  }
  const gridLin = new Map();
  const gridColour = (hex) => { if (!gridLin.has(hex)) gridLin.set(hex, new Float32Array(hexLin(hex))); return gridLin.get(hex); };
  const clock = () => (STILL ? 12 : performance.now() / 1000);

  /* WebGL 2 made on first use; false while it cannot be had (the flat roll stands in) */
  function ready() {
    if (failed || lost) return false;
    if (gl) return true;
    try { init(); return true; } catch (e) {
      failed = true;
      if (e.message !== 'no WebGL 2') console.error('roll-gl:', e);   // a browser without it simply keeps the flat roll
      return false;
    }
  }
  /* the heat strip into its texture rows. Row 0: the strip, barely softened; row r: as wide as the
     bloom is r * 40 px above the keys, so the shader reads the bloom in one sample (spaced taps
     striped it at key width) */
  function blurHeat(heat, w) {
    for (let row = 0; row < HEAT_ROWS; row++) {
      const sigma = row === 0 ? 0.7 : ((3.8 + 0.23 * row * HEAT_STEP) * HEAT_N) / w;
      const r = Math.max(1, Math.round((Math.sqrt(4 * sigma * sigma + 1) - 1) / 2));
      for (let hand = 0; hand < 2; hand++) {
        boxPass(heat[hand], blurA, r); boxPass(blurA, blurB, r); boxPass(blurB, blurA, r);
        for (let k = 0; k < HEAT_N; k++) heatPx[(row * HEAT_N + k) * 4 + hand] = Math.round(Math.min(1, blurA[k]) * 255);
      }
      for (let k = 0; k < HEAT_N; k++) heatPx[(row * HEAT_N + k) * 4 + 3] = 255;
    }
  }
  /* The three passes into glc, sized cw x ch device pixels for a stage w x h css pixels: o.inst the
     notes (14 numbers each), o.fieldNotes [x, y, w, h, hand, foot y], o.bars and o.beats the grid's
     time lines, o.W, o.left, o.bw the key geometry, o.T the noise's time, o.hands, o.theme */
  function draw(o) {
    const { cw, ch, w, h, dpr, hands, theme } = o;
    if (glc.width !== cw || glc.height !== ch) { glc.width = cw; glc.height = ch; }
    /* 1. the field */
    const fw = Math.max(1, Math.round(cw * FIELD_RES)), fh = Math.max(1, Math.round(ch * FIELD_RES));
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    if (fieldTex.w !== fw || fieldTex.h !== fh) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, fw, fh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); fieldTex.w = fw; fieldTex.h = fh; }
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, heatTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HEAT_N, HEAT_ROWS, gl.RGBA, gl.UNSIGNED_BYTE, heatPx);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fieldTex, 0);
    gl.viewport(0, 0, fw, fh); gl.disable(gl.BLEND);
    gl.useProgram(fieldP);
    o.fieldNotes.sort((p, q) => q[5] - p[5]);   // the notes nearest the keys: further up the field is too faint to matter
    const fn = o.fieldNotes.slice(0, NOTES), rects = new Float32Array(NOTES * 4), handOf = new Float32Array(NOTES);
    fn.forEach((r, i) => { rects.set(r.slice(0, 4), i * 4); handOf[i] = r[4]; });
    gl.uniform2f(UF.uRes, w, h); gl.uniform2f(UF.uScale, fw / w, fh / h);
    gl.uniform1f(UF.uT, o.T); gl.uniform1f(UF.uDrift, STILL ? 0 : o.T * 40);   // 40 px a second, up
    gl.uniform1i(UF.uN, fn.length); gl.uniform4fv(UF.uNote, rects); gl.uniform1fv(UF.uHand, handOf);
    gl.uniform3fv(UF.uLabR, hands[0].lab); gl.uniform3fv(UF.uLabL, hands[1].lab);
    gl.uniform3fv(UF.uToneR, hands[0].lin); gl.uniform3fv(UF.uToneL, hands[1].lin);
    gl.uniform1i(UF.uHeat, 1);
    gl.bindVertexArray(quadVao); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    /* 2. onto the screen, with the grid */
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(screenP);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fieldTex);
    gl.uniform1i(US.uTex, 0); gl.uniform2f(US.uSize, cw, ch); gl.uniform1f(US.uDpr, dpr);
    gl.uniform1f(US.uW, o.W); gl.uniform1f(US.uLeft, o.left); gl.uniform1f(US.uBW, o.bw);
    gl.uniform3fv(US.uLane, gridColour(theme.lane)); gl.uniform3fv(US.uGrid, gridColour(theme.grid)); gl.uniform3fv(US.uGrid2, gridColour(theme['grid-2']));
    gl.uniform1i(US.uNBar, o.bars.length); gl.uniform1i(US.uNBeat, o.beats.length);
    if (o.bars.length) gl.uniform1fv(US.uBar, new Float32Array(o.bars));
    if (o.beats.length) gl.uniform1fv(US.uBeat, new Float32Array(o.beats));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    /* 3. the notes */
    if (o.inst.length) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(noteP);
      gl.uniform2f(UN.uRes, w, h); gl.uniform1f(UN.uDpr, dpr); gl.uniform1i(UN.uBg, 0); gl.uniform2f(UN.uSize, cw, ch);
      gl.bindVertexArray(noteVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(o.inst), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, o.inst.length / 14);
    }
    gl.bindVertexArray(null);
  }
  /* a note's 14 numbers for the notes pass */
  const noteOf = (x, y, w, h, black, hc, hot, faded = 0) => [x, y, w, h, hc.note[0], hc.note[1], hc.note[2], black ? 0.88 : 1, hc.rim[0], hc.rim[1], hc.rim[2], faded, Math.min(6, w * 0.32), hot ? 1 : 0];

  /* ------------------------------------------------------------------ the roll */
  function roll(env, disp, live) {
    if (!ready()) return false;
    const { S, G, R, rc: c, theme, BLACK_W, EPS, keyX, el } = env;
    const w = R.w, h = R.h, pps = S.pps, sc = S.score, W = G.W, left = G.left, bw = W * BLACK_W;
    const cw = el.roll.width, chh = el.roll.height, dpr = cw / w;
    const hands = colours(env), T = clock();
    if (!hands) { c.fillStyle = theme.stage; c.fillRect(0, 0, w, h); return true; }   // its colours are on their way (js/app.js setScore)

    const inst = [], fieldNotes = [], names = [], labels = [], bars = [], beats = [];
    const heat = [new Float32Array(HEAT_N), new Float32Array(HEAT_N)];
    let barObscured = false, clockObscured = false;
    if (sc) {
      const Y = (t) => h - (t - disp) * pps, tTop = disp + h / pps;
      /* the time grid: bar lines with their numbers, beat lines when they are 14 px apart */
      for (let oi = sc.measureAt(Math.max(0, disp)); oi < sc.measures.length; oi++) {
        const o = sc.measures[oi];
        if (o.t > tTop) break;
        const tEnd = oi + 1 < sc.measures.length ? sc.measures[oi + 1].t : sc.duration;
        const unit = env.beatUnit(o.time), nb = Math.max(1, Math.round(o.lenQ / unit));
        if (((tEnd - o.t) / nb) * pps >= 14) {
          for (let k = 1; k < nb; k++) { const y = Math.round(Y(sc.beatToSec(o.beat + k * unit))); if (y >= 0 && y <= h && beats.length < 64) beats.push(y); }
        }
        const y = Math.round(Y(o.t));
        if (y >= 0 && y <= h && bars.length < 64) { bars.push(y); labels.push([o.number, y]); }
      }
      /* the notes: white-key notes first, black-key notes over them */
      const notes = sc.notes, inset = Math.min(1.5, W * 0.07);
      const [bar, clk] = env.progressBounds.roll;
      for (let pass = 0; pass < 2; pass++) {
        for (let i = env.lowerT0(disp - sc.maxDur - EPS); i < notes.length && notes[i].t0 < tTop; i++) {
          const n = notes[i];
          if (n.t1 < disp || !env.handOK(n)) continue;
          const black = FB.isBlack(n.midi);
          if (black !== (pass === 1)) continue;
          const x = keyX(n.midi) + (black ? 0 : inset), bwid = black ? bw : W - inset * 2;
          if (x > w || x + bwid < 0) continue;
          const y1 = Y(n.t0), bh = Math.max(4, y1 - Y(n.t1) - 1.5);
          if (!barObscured && y1 > bar.top && y1 - bh < bar.bottom && x < bar.right && x + bwid > bar.left) barObscured = true;
          if (!clockObscured && y1 > clk.top && y1 - bh < clk.bottom && x < clk.right && x + bwid > clk.left) clockObscured = true;
          const hot = n.t0 <= live + EPS && n.t1 > live + EPS, hc = hands[n.hand];
          inst.push(...noteOf(x, y1 - bh, bwid, bh, black, hc, hot));
          if (y1 - bh < h) fieldNotes.push([x, y1 - bh, bwid, Math.min(bh, h - (y1 - bh)), n.hand, y1]);
          if (bwid >= 14 && bh >= 22) names.push([n.name, x + bwid / 2, Math.min(y1, hot ? h : y1) - 8]);
        }
      }
      /* the heat strip: how long each key has sounded, on a logarithm so it never grows without end,
         cooling in a third of a second; worked out from the score's times, so it is the same at any
         frame rate */
      const full = Math.log1p(18);
      for (let i = env.lowerT0(live - sc.maxDur - 2); i < notes.length && notes[i].t0 <= live + EPS; i++) {
        const n = notes[i];
        if (!env.handOK(n) || n.t1 < live - 1.5) continue;
        const sounding = n.t1 > live;
        const v = Math.min(1, Math.log1p(6 * ((sounding ? live : n.t1) - n.t0)) / full) * (sounding ? 1 : Math.exp(-(live - n.t1) / 0.33));
        const x = keyX(n.midi), kw = FB.isBlack(n.midi) ? bw : W;
        const a = Math.max(0, Math.floor((x / w) * HEAT_N)), b = Math.min(HEAT_N - 1, Math.ceil(((x + kw) / w) * HEAT_N));
        for (let k = a; k <= b; k++) heat[n.hand][k] = Math.max(heat[n.hand][k], v);
      }
    }
    blurHeat(heat, w);
    draw({ cw, ch: chh, w, h, dpr, T, hands, inst, fieldNotes, bars, beats, W, left, bw, theme });

    /* onto the roll canvas (the glass reads it), then the lettering, as the player has it */
    c.drawImage(glc, 0, 0, w, h);
    const { UI_FONT } = env;
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    c.font = `700 ${clamp(W * 0.46, 8.5, 11.5)}px ${UI_FONT}`;
    c.fillStyle = 'rgba(255,255,255,0.86)';
    for (const [name, x, y] of names) c.fillText(name, x, y);
    el.barReadout.classList.toggle('is-obscured', barObscured);
    el.clock.classList.toggle('is-obscured', clockObscured);
    c.font = `600 11px ${UI_FONT}`; c.textAlign = 'left'; c.textBaseline = 'bottom';
    c.fillStyle = theme['grid-ink'];
    for (const [num, y] of labels) {
      if (y <= 16) continue;
      c.globalAlpha = clamp((h - y - 26) / 42, 0, 1);   // fade before the playback readouts
      if (c.globalAlpha > 0) c.fillText(num, 7, y - 3);
    }
    c.globalAlpha = 1;
    /* the playback line, shown when the view has been scrolled away from it */
    if (S.viewT !== null && sc) {
      const y = Math.round(h - (live - disp) * pps);
      if (y >= -2 && y <= h + 2) {
        c.fillStyle = theme.now;
        c.fillRect(0, y - 1, w, 2);
        c.beginPath(); c.moveTo(0, y - 6); c.lineTo(8, y); c.lineTo(0, y + 6); c.closePath(); c.fill();
      }
    }
    return true;
  }

  /* ------------------------------------------------------------------ a recent piece's card
     Its opening bars (r.roll: start and length in hundredths of a second, pitch and hand, the bar
     starts and the end; js/app.js rollOf) as the player shows them as it begins: on the player's
     keys, the first notes landing on the card's bottom edge, where the keyboard would be, the rest
     rising to 0.2 of its height from the top, lit in the piece's hands' colours (r.hands), with no
     grid, blurred more and more toward the top (blurTop). Then the card's cover (r.cover, its
     colour fields as js/library.js meshOf lays them out), as it is, and the roll's light added to
     it in linear light, fading out toward the top, and the card's glass over both (GLASS_FS); on a cover too pale for that light to show
     (r.cover.ink, the cream classic edition), as its ink instead, as much ink as there is light.
     Still: a card's noise does not move. Drawn into
     the card's 2D canvas; false without WebGL 2 or the piece's colours. */
  const COVER_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uRoll; uniform vec2 uSize;
    uniform vec3 uBase; uniform int uN; uniform vec4 uRect[4]; uniform vec4 uCol[4]; uniform vec4 uInk;
    out vec4 o;
    vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    ${SMOOTH_GLSL}
    void main() {
      vec2 fc = gl_FragCoord.xy, uv = vec2(fc.x / uSize.x, 1.0 - fc.y / uSize.y);
      /* the cover's fields as CSS lays them: an ellipse each, solid to its stop, then fading out,
         the first over the rest, over the base; in sRGB as the browser composites them */
      vec3 col = uBase;
      for (int i = 3; i >= 0; i--) {
        if (i >= uN) continue;
        float d = length((uv - uRect[i].xy) / uRect[i].zw), st = uCol[i].a;
        col = mix(col, uCol[i].rgb, clamp(1.0 - (d - st) / (1.0 - st), 0.0, 1.0));
      }
      /* the roll's light, added, from none at the top to all of it 0.8 of the way down (the smooth
         step, spread as the smoothstep it replaced, over -0.145 to 0.945) */
      vec3 roll = dec(texture(uRoll, fc / uSize).rgb) * smoothStep((uv.y + 0.145) / 1.09);
      float ink = 1.0 - exp(-2.5 * dot(roll, vec3(0.2126, 0.7152, 0.0722)));   // in ink (uInk.a): as much as there is light
      vec3 rgb = uInk.a > 0.5 ? mix(dec(col), dec(uInk.rgb), ink * 0.85) : dec(col) + roll;
      o = vec4(enc(min(rgb, 1.0)), 1.0);
    }`;
  /* A card's glass: the controls' glass (js/glass.js), the same solid and optics, as a clear slab
     over the whole card, under its name: a squircle in plan (the card's own corner, softness 1/2),
     its edge rising over the corner's radius to a cap that is mostly flat (capFlatness 0.8),
     index 1.46. A ray from the eye enters the front, crosses the solid and leaves at its back, so
     near the edge what lies under the card (its cover and the roll's light) is bent inward; Fresnel
     loss at both faces, normalised so the flat middle is the cover as it is; the controls' rim
     light along the top and bottom edges (0.2, as the controls). No coating: the controls' grey would dull the
     cover. Functions as js/glass.js writes them. */
  const GLASS_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uScene; uniform vec2 uSize; uniform vec4 rectangle; uniform float corner;
    out vec4 o;
    const float shapeSoftness = 0.5, capFlatness = 0.8, lightScale = 0.04, ior = 1.46, backgroundGap = 0.0, rimGain = 0.2;
    vec3 dec(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
    vec3 enc(vec3 c) { return mix(c * 12.92, 1.055 * pow(max(c, 0.0), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
    float squircleHinge(float q, float e) { float root = sqrt(q * q + e * e); return q < 0.0 ? e * e / max(root - q, 0.00000001) : q + root; }
    vec2 squircleAxis(float x, float halfExtent, float r, float softness) {
      if (abs(halfExtent - r) < 0.000001) return vec2(x * x / (r * r), 2.0 * x / (r * r));
      float e = r * softness, c = halfExtent - r;
      float qp = x - c, qm = -x - c, rp = sqrt(qp * qp + e * e), rm = sqrt(qm * qm + e * e);
      float vp = squircleHinge(qp, e), vm = squircleHinge(qm, e), v0 = squircleHinge(-c, e);
      float edgeP = squircleHinge(r, e), edgeM = squircleHinge(r - 2.0 * halfExtent, e);
      float denominator = max((edgeP - v0) * (edgeP + v0) + (edgeM - v0) * (edgeM + v0), 0.00000001);
      return vec2(max(0.0, ((vp - v0) * (vp + v0) + (vm - v0) * (vm + v0)) / denominator), 2.0 * (vp * vp / max(rp, 0.00000001) - vm * vm / max(rm, 0.00000001)) / denominator);
    }
    float axisValue(float x, float halfExtent, out float derivative) { vec2 axis = squircleAxis(x, halfExtent, corner, shapeSoftness); derivative = axis.y; return axis.x; }
    float verticalHeight(float value) { return corner * sqrt(max(0.0, value)); }
    float solidValue(vec3 p) {
      float dx, dy, dz;
      float s = axisValue(p.x, rectangle.z * 0.5, dx) + axisValue(p.y, rectangle.w * 0.5, dy);
      if (capFlatness >= 1.0) return max(s, abs(p.z) / corner) - 1.0;
      if (abs(p.z) > corner) return max(abs(p.z) / corner - 1.0, 0.000001);
      float a = axisValue(p.z, corner, dz), q = 1.0 - capFlatness;
      return s + q * a / max(0.0000001, 1.0 - capFlatness * a) - 1.0;
    }
    vec3 solidNormal(vec3 p) {
      float dx, dy, dz; float ax = axisValue(p.x, rectangle.z * 0.5, dx), ay = axisValue(p.y, rectangle.w * 0.5, dy);
      float a = axisValue(p.z, corner, dz), denominator = max(0.0000001, 1.0 - capFlatness * a);
      return normalize(vec3(dx, dy, (1.0 - capFlatness) * dz / (denominator * denominator)));
    }
    void surface(vec2 p, out float dist, out vec3 optical, out vec3 lighting, out float z) {
      vec2 halfSize = rectangle.zw * 0.5;
      float dx, dy; float sum = axisValue(p.x, halfSize.x, dx) + axisValue(p.y, halfSize.y, dy);
      dist = (sum - 1.0) / max(length(vec2(dx, dy)), 0.00001);
      float remaining = clamp(1.0 - sum, 0.0, 1.0), q = 1.0 - capFlatness;
      float denominator = q + capFlatness * remaining;
      float vertical = remaining / max(denominator, 0.00000001);
      z = verticalHeight(vertical);
      float dz; float unused = axisValue(z, corner, dz);
      float slope = q / max(denominator * denominator, 0.00000001);
      vec3 g = vec3(slope * dx, slope * dy, dz);
      optical = normalize(g);
      lighting = normalize(vec3(g.xy, g.z / lightScale));
    }
    vec2 displacement(vec2 p, vec3 normal, float z, out float tir, out vec3 inside, out vec3 backNormal) {
      inside = refract(vec3(0.0, 0.0, -1.0), normal, 1.0 / ior);
      vec3 entry = vec3(p, z); float low = 0.00001, high = length(vec3(rectangle.zw, corner * 2.0)) + 1.0;
      for (int iteration = 0; iteration < 18; iteration++) {
        float middle = (low + high) * 0.5;
        if (solidValue(entry + inside * middle) <= 0.0) low = middle; else high = middle;
      }
      vec3 exitPoint = entry + inside * (low + high) * 0.5;
      backNormal = solidNormal(exitPoint);
      vec3 leaving = refract(inside, -backNormal, ior);
      tir = dot(leaving, leaving) < 0.01 || leaving.z >= -0.00001 ? 1.0 : 0.0;
      if (tir > 0.5) return vec2(0.0);
      float airTravel = max(0.0, (-corner - backgroundGap - exitPoint.z) / leaving.z);
      return exitPoint.xy + leaving.xy * airTravel - p;
    }
    float dielectricFresnel(float cosine, float incidentIOR, float transmittedIOR) {
      float c = clamp(abs(cosine), 0.0, 1.0), eta = incidentIOR / transmittedIOR;
      float k = 1.0 - eta * eta * (1.0 - c * c);
      if (k <= 0.0) return 1.0;
      float ct = sqrt(k);
      float rs = (incidentIOR * c - transmittedIOR * ct) / max(incidentIOR * c + transmittedIOR * ct, 0.000001);
      float rp = (transmittedIOR * c - incidentIOR * ct) / max(transmittedIOR * c + incidentIOR * ct, 0.000001);
      return 0.5 * (rs * rs + rp * rp);
    }
    void main() {
      vec2 fc = gl_FragCoord.xy, p = vec2(fc.x, uSize.y - fc.y) - uSize * 0.5;   // from the middle, y down, as js/glass.js
      vec3 normal, lightingNormal; float dist, height;
      surface(p, dist, normal, lightingNormal, height);
      float tir; vec3 inside, backNormal;
      vec2 bend = displacement(p, normal, height, tir, inside, backNormal);
      float frontR = dielectricFresnel(normal.z, 1.0, ior), rearR = tir > 0.5 ? 1.0 : dielectricFresnel(dot(inside, -backNormal), ior, 1.0);
      float f0 = (ior - 1.0) / (ior + 1.0); f0 *= f0;
      vec2 q = p + bend;
      vec3 behind = dec(texture(uScene, clamp(vec2(q.x + uSize.x * 0.5, uSize.y * 0.5 - q.y) / uSize, 0.0, 1.0)).rgb);
      vec3 col = tir < 0.5 ? behind * (1.0 - frontR) * (1.0 - rearR) / ((1.0 - f0) * (1.0 - f0)) : vec3(0.0);
      col += vec3(rimGain * abs(lightingNormal.y) * (1.0 - abs(lightingNormal.x)));
      o = vec4(enc(col), 1.0);
    }`;
  let glassP = null, UG = null;
  /* the glass over what is on the screen (copied away first) */
  function glassOver(cw, ch, corner) {
    if (!glassP) { glassP = compile(QUAD_VS, GLASS_FS); UG = uni(glassP, ['uScene', 'uSize', 'rectangle', 'corner']); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, cw, ch, 0);
    gl.useProgram(glassP); gl.disable(gl.BLEND); gl.bindVertexArray(quadVao); gl.viewport(0, 0, cw, ch);
    gl.uniform1i(UG.uScene, 0); gl.uniform2f(UG.uSize, cw, ch); gl.uniform4f(UG.rectangle, 0, 0, cw, ch); gl.uniform1f(UG.corner, corner);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
  let coverP = null, UC = null;
  const hexRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
  /* the cover under the roll on the screen (the roll copied away first) */
  function cover(cw, ch, look) {
    if (!coverP) { coverP = compile(QUAD_VS, COVER_FS); UC = uni(coverP, ['uRoll', 'uSize', 'uBase', 'uN', 'uRect', 'uCol', 'uInk']); }
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, cw, ch, 0);
    const n = Math.min(4, look.fields.length), rect = new Float32Array(16), col = new Float32Array(16);
    look.fields.slice(0, n).forEach((m, i) => { rect.set([m.x / 100, m.y / 100, m.w / 100, m.h / 100], i * 4); col.set([...hexRgb(m.c), m.stop / 100], i * 4); });
    gl.useProgram(coverP); gl.disable(gl.BLEND); gl.bindVertexArray(quadVao); gl.viewport(0, 0, cw, ch);
    gl.uniform1i(UC.uRoll, 0); gl.uniform2f(UC.uSize, cw, ch);
    gl.uniform3fv(UC.uBase, hexRgb(look.base)); gl.uniform1i(UC.uN, n);
    gl.uniform4fv(UC.uRect, rect); gl.uniform4fv(UC.uCol, col);
    gl.uniform4fv(UC.uInk, look.ink ? [...hexRgb(look.ink), 1] : [0, 0, 0, 0]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
  let whiteAt = null;   // how many white keys lie below each key, from A0
  const CARD_GRID = { lane: '#000000', grid: '#000000', 'grid-2': '#000000' };   // a card's roll has no grid
  function thumb(cv, r) {
    const hands = handsOf(r.hands);
    if (!hands || !r.cover || !r.roll || !r.roll.notes.length || !ready()) return false;
    const w = cv.clientWidth, H = cv.clientHeight;
    if (!w || !H) return true;
    if (!whiteAt) { whiteAt = new Int16Array(128); for (let m = 21, n = 0; m < 128; m++) { whiteAt[m] = n; if (!FB.isBlack(m)) n++; } }
    const dpr = Math.min(2, window.devicePixelRatio || 1), h = H, top = Math.round(H * 0.2), roll = r.roll, t = roll.notes;
    let lo = 127, hi = 0;
    for (let i = 0; i < t.length; i += 4) { lo = Math.min(lo, t[i + 2]); hi = Math.max(hi, t[i + 2]); }
    const left = whiteAt[clamp(lo, 21, 108)] - 1.5, W = w / (whiteAt[clamp(hi, 21, 108)] + 2.5 - left), bw = W * 0.58;
    const keyX = (m) => (FB.isBlack(m) ? (whiteAt[m] - left) * W - bw / 2 : (whiteAt[m] - left) * W);
    const yOf = (cs) => h - (cs / roll.end) * (h - top), inset = Math.min(1.5, W * 0.07);
    const inst = [], fieldNotes = [];
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < t.length; i += 4) {
        const m = t[i + 2], black = FB.isBlack(m);
        if (black !== (pass === 1)) continue;
        const x = keyX(m) + (black ? 0 : inset), bwid = black ? bw : W - inset * 2;
        const y1 = yOf(t[i]), bh = Math.max(3, y1 - yOf(t[i] + t[i + 1]) - 1);
        inst.push(...noteOf(x, y1 - bh, bwid, bh, black, hands[t[i + 3]], t[i] === 0));
        fieldNotes.push([x, y1 - bh, bwid, bh, t[i + 3], y1]);
      }
    }
    heatPx.fill(0);
    draw({ cw: Math.round(w * dpr), ch: Math.round(h * dpr), w, h, dpr, T: 12, hands, inst, fieldNotes, bars: [], beats: [], W, left, bw, theme: CARD_GRID });
    blurTop(Math.round(w * dpr), Math.round(h * dpr), Math.round(H * 0.6 * dpr), 6 * dpr);
    cover(Math.round(w * dpr), Math.round(h * dpr), r.cover);
    /* the glass's corner, bevel and height: the card's corner radius (before the squircle lowers it) */
    const card = cv.parentNode, corner = card._sqR !== undefined ? card._sqR : parseFloat(getComputedStyle(card).borderTopLeftRadius) || 0;
    glassOver(Math.round(w * dpr), Math.round(h * dpr), corner * dpr);
    cv.width = Math.round(w * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.drawImage(glc, 0, 0, w, h);
    cv.classList.add('whole');   // the cover is in it: not added to the CSS one (index.html .card .roll.whole)
    return true;
  }
  /* A progressive blur over a card's top, where its name is (a card is drawn once, so it can
     afford one): a Gaussian, across and then down, its radius growing as the square of the way
     into the blurred band, from nothing at `reach` device px from the top to `most` at the top, averaged in linear light so the glow
     blurs as light does. What draw() left on the canvas is copied to a texture, blurred across
     into a second, then down onto the canvas. */
  const BLUR_FS = `#version 300 es
    precision highp float;
    uniform sampler2D uTex; uniform vec2 uSize; uniform vec2 uDir; uniform float uMost, uReach;
    out vec4 o;
    ${SMOOTH_GLSL}
    void main() {
      vec2 fc = gl_FragCoord.xy;
      float k = clamp(1.0 - (uSize.y - fc.y) / uReach, 0.0, 1.0);
      float sigma = uMost * smoothRamp(k);
      if (sigma < 0.35) { o = vec4(texture(uTex, fc / uSize).rgb, 1.0); return; }
      vec3 acc = vec3(0.0); float sum = 0.0;
      for (int i = -12; i <= 12; i++) {
        float x = float(i) * sigma * 0.25, wgt = exp(-0.5 * float(i * i) / 16.0);
        acc += pow(texture(uTex, (fc + uDir * x) / uSize).rgb, vec3(2.2)) * wgt; sum += wgt;
      }
      o = vec4(pow(acc / sum, vec3(1.0 / 2.2)), 1.0);
    }`;
  let blurP = null, UBl = null, sceneTex = null, blurTex = null, blurFbo = null;
  function blurTop(cw, ch, reach, most) {
    if (!blurP) {
      blurP = compile(QUAD_VS, BLUR_FS);
      UBl = uni(blurP, ['uTex', 'uSize', 'uDir', 'uMost', 'uReach']);
      sceneTex = texture(1, 1, null); blurTex = texture(1, 1, null); blurFbo = gl.createFramebuffer();
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGB, 0, 0, cw, ch, 0);
    gl.bindTexture(gl.TEXTURE_2D, blurTex);
    if (blurTex.w !== cw || blurTex.h !== ch) { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, cw, ch, 0, gl.RGBA, gl.UNSIGNED_BYTE, null); blurTex.w = cw; blurTex.h = ch; }
    gl.useProgram(blurP); gl.disable(gl.BLEND); gl.bindVertexArray(quadVao); gl.viewport(0, 0, cw, ch);
    gl.uniform1i(UBl.uTex, 0); gl.uniform2f(UBl.uSize, cw, ch); gl.uniform1f(UBl.uMost, most); gl.uniform1f(UBl.uReach, reach);
    gl.bindFramebuffer(gl.FRAMEBUFFER, blurFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, blurTex, 0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex); gl.uniform2f(UBl.uDir, 1, 0); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, blurTex); gl.uniform2f(UBl.uDir, 0, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /* ------------------------------------------------------------------ the keys
     A struck key wears one of the roll's notes, sounding, drawn by the roll's own note shader
     (NOTE_VS, NOTE_FS) over the key as it is drawn, the key showing through it as the roll's
     light does through a note: the white keys' before the black keys are drawn over them, the
     black keys' after. On a canvas of the keyboard's own (the roll's is the roll's size); without
     WebGL 2, a flat fill of the hand's colour */
  let kgl = null, kglc = null, kFailed = false, keyP = null, UK = null, keyVao = null, keyBuf = null, keyTex = null;
  /* the keys' own WebGL 2 (the roll's canvas is the roll's size); false while it cannot be had */
  function keysReady() {
    if (kFailed) return false;
    if (kgl) return true;
    try {
      kglc = document.createElement('canvas');
      kglc.addEventListener('webglcontextlost', (e) => { e.preventDefault(); kgl = null; });
      const g = kglc.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false });
      if (!g) throw new Error('no WebGL 2');
      const prog = (vs, fs) => {
        const p = g.createProgram();
        for (const [type, src] of [[g.VERTEX_SHADER, vs], [g.FRAGMENT_SHADER, fs]]) {
          const sh = g.createShader(type); g.shaderSource(sh, src); g.compileShader(sh);
          if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(sh));
          g.attachShader(p, sh);
        }
        g.linkProgram(p);
        if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p));
        return p;
      };
      keyP = prog(NOTE_VS, NOTE_FS);
      UK = Object.fromEntries(['uRes', 'uDpr', 'uBg', 'uSize'].map((n) => [n, g.getUniformLocation(keyP, n)]));
      keyVao = g.createVertexArray(); g.bindVertexArray(keyVao);
      g.bindBuffer(g.ARRAY_BUFFER, g.createBuffer());
      g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), g.STATIC_DRAW);
      g.enableVertexAttribArray(0); g.vertexAttribPointer(0, 2, g.FLOAT, false, 0, 0);
      keyBuf = g.createBuffer(); g.bindBuffer(g.ARRAY_BUFFER, keyBuf);
      [[1, 4, 0], [2, 4, 16], [3, 4, 32], [4, 2, 48]].forEach(([loc, size, off]) => { g.enableVertexAttribArray(loc); g.vertexAttribPointer(loc, size, g.FLOAT, false, 56, off); g.vertexAttribDivisor(loc, 1); });
      g.bindVertexArray(null);
      keyTex = g.createTexture(); g.bindTexture(g.TEXTURE_2D, keyTex);
      for (const [k, v] of [[g.TEXTURE_MIN_FILTER, g.LINEAR], [g.TEXTURE_MAG_FILTER, g.LINEAR], [g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE], [g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE]]) g.texParameteri(g.TEXTURE_2D, k, v);
      kgl = g;
      return true;
    } catch (e) {
      kFailed = true;
      if (e.message !== 'no WebGL 2') console.error('roll-gl keys:', e);
      return false;
    }
  }
  /* notes over the keyboard as drawn on c so far (w x h css px), inst as noteOf makes them */
  function keysGlass(c, w, h, inst) {
    const g = kgl, cw = c.canvas.width, ch = c.canvas.height;
    if (kglc.width !== cw || kglc.height !== ch) { kglc.width = cw; kglc.height = ch; }
    g.viewport(0, 0, cw, ch); g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, keyTex);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, c.canvas);
    g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, false);
    g.useProgram(keyP); g.disable(g.BLEND);
    g.uniform2f(UK.uRes, w, h); g.uniform1f(UK.uDpr, cw / w); g.uniform1i(UK.uBg, 0); g.uniform2f(UK.uSize, cw, ch);
    g.bindVertexArray(keyVao); g.bindBuffer(g.ARRAY_BUFFER, keyBuf);
    g.bufferData(g.ARRAY_BUFFER, new Float32Array(inst), g.DYNAMIC_DRAW);
    g.drawArraysInstanced(g.TRIANGLE_STRIP, 0, 4, inst.length / 14);
    g.bindVertexArray(null);
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.drawImage(kglc, 0, 0); c.restore();
  }
  function keys(env, held) {
    const { S, G, kc: c, WHITE_MIDI, N_WHITE, BLACK_H, BLACK_W, keyX, pressed, rr, UI_FONT, EPS } = env;
    const w = G.width, h = G.height, W = G.W, left = G.left, bw = W * BLACK_W;
    const hands = colours(env), hair = w > 0 ? w / c.canvas.width : 1;
    const bh = Math.round(h * BLACK_H);
    if (!hands) held = new Map();   // the piece's colours are on their way: no key lights yet
    /* which keys give light: those sounding, fully, and those whose note ended within the release */
    const lit = new Map();
    for (const [m, hand] of held) lit.set(m, [hand, 1]);
    if (S.score && hands) {
      const t = env.now(), notes = S.score.notes;
      for (let i = env.lowerT0(t - S.score.maxDur - RELEASE - EPS); i < notes.length && notes[i].t0 <= t + EPS; i++) {
        const n = notes[i];
        if (lit.has(n.midi) || !env.handOK(n)) continue;
        const end = S.playing ? n.t1 - Math.min(0.035, (n.t1 - n.t0) * 0.25) : n.t1 - EPS;
        if (end <= t && t < end + RELEASE) lit.set(n.midi, [n.hand, 1 - (t - end) / RELEASE]);
      }
    }
    c.clearRect(0, 0, w, h);
    const i0 = clamp(Math.floor(left), 0, N_WHITE - 1), i1 = clamp(Math.ceil(left + w / W), 0, N_WHITE - 1);
    /* each white key a rounded rectangle: black behind them shows as a small dent where two keys'
       corners meet, at the top and the bottom; between, a hairline seam of grey. The keys start
       below a black line (TOP px) that parts them from the roll */
    const TOP = 4, rad = Math.min(3.5, W * 0.22);
    c.fillStyle = '#000'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#bcbcbc'; c.fillRect(0, TOP + rad, w, h - TOP - 2 * rad);
    const grad = (a, b, cc) => { const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, a); g.addColorStop(0.88, b); g.addColorStop(1, cc); return g; };
    const ivory = grad('#fdfdfd', '#f4f4f4', '#e6e6e6'), ivoryDown = grad('#f1f1f1', '#e7e7e7', '#dadada');
    const whitePath = (x) => rr(c, x + hair, TOP, W - hair, h - TOP, rad, rad);
    c.textAlign = 'center'; c.textBaseline = 'alphabetic';
    for (let i = i0; i <= i1; i++) {
      const m = WHITE_MIDI[i], x = (i - left) * W;
      c.fillStyle = pressed.has(m) && !lit.has(m) ? ivoryDown : ivory;
      whitePath(x); c.fill();
      if (m % 12 === 0 && W >= 11) {
        const oct = FB.midiOctave(m);
        c.font = `${oct === 4 ? 650 : 550} ${W < 16 ? 8 : 9.5}px ${UI_FONT}`;
        c.fillStyle = oct === 4 ? '#8a8a8a' : '#a8a8a8';
        c.fillText((W < 15 ? '' : 'C') + oct, x + W / 2, h - 6);
      }
    }
    /* the fallboard's shadow */
    /* (the smooth step, spread as the 9 px linear fade it replaced, over 3.4 px above to 12.4 below) */
    const sh = c.createLinearGradient(0, TOP - 3.42, 0, TOP + 12.42);
    for (let i = 0; i <= 16; i++) sh.addColorStop(i / 16, 'rgba(0,0,0,' + (0.16 * (1 - smoothStep(i / 16))).toFixed(4) + ')');
    c.fillStyle = sh; c.fillRect(0, TOP, w, 12.42);
    /* the struck white keys' notes, before the black keys are drawn over them */
    const glass = lit.size && keysReady(), inst = [];
    for (let i = i0; i <= i1; i++) {
      const k = lit.get(WHITE_MIDI[i]);
      if (!k) continue;
      const x = (i - left) * W, hc = hands[k[0]];
      if (glass) inst.push(...noteOf(x + hair, TOP, W - hair, h - TOP, false, hc, true, 1 - k[1]));
      else { c.globalAlpha = 0.85 * k[1]; c.fillStyle = css(hc.key); whitePath(x); c.fill(); c.globalAlpha = 1; }
    }
    if (inst.length) { keysGlass(c, w, h, inst); inst.length = 0; }
    /* the black keys: a soft shadow on the white keys, a dark top face lifting a little toward the
       front, a hairline where it meets the front slope */
    const side = Math.min(1.4, bw * 0.12), dpr = c.canvas.width / Math.max(1, w);
    const body = c.createLinearGradient(0, 0, 0, bh); body.addColorStop(0, '#1d1d1d'); body.addColorStop(1, '#101010');
    const mLo = WHITE_MIDI[i0], mHi = WHITE_MIDI[i1];
    for (let m = Math.max(22, mLo - 1); m <= Math.min(106, mHi + 1); m++) {
      if (!FB.isBlack(m)) continue;
      const x = keyX(m), k = lit.get(m), down = !!k || pressed.has(m);
      const slope = clamp(bh * 0.09, 3, 6) * (down ? 0.6 : 1);
      c.save();
      c.shadowColor = 'rgba(0,0,0,0.32)'; c.shadowBlur = 3.5 * dpr; c.shadowOffsetY = 1.2 * dpr;
      c.fillStyle = body; rr(c, x, -4, bw, bh + 4, 0, 2); c.fill();
      c.restore();
      const face = c.createLinearGradient(0, 0, 0, bh - slope);
      face.addColorStop(0, '#202020'); face.addColorStop(0.75, pressed.has(m) ? '#2e2e2e' : '#262626'); face.addColorStop(1, '#303030');
      c.fillStyle = face; rr(c, x + side, -4, bw - side * 2, bh - slope + 4, 0, 1.5); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.10)'; c.fillRect(x + side, bh - slope - hair, bw - side * 2, hair);
      if (k && !glass) { c.globalAlpha = k[1]; c.fillStyle = css(hands[k[0]].key); rr(c, x, -4, bw, bh + 4, 0, 2); c.fill(); c.globalAlpha = 1; }
      else if (k) inst.push(...noteOf(x, TOP, bw, bh - TOP, true, hands[k[0]], true, 1 - k[1]));
    }
    if (inst.length) keysGlass(c, w, h, inst);
    /* the line between the roll and the keys, over the black keys' tops too */
    c.fillStyle = '#000'; c.fillRect(0, 0, w, TOP);
    return true;
  }

  FB.rollGL = {
    roll, keys, thumb, flat, colours,
    /* the field moves on its own (the noise), so the roll wants frames while it shows */
    get moving() { return !STILL && !failed && !lost && !!gl; },
  };
})();
