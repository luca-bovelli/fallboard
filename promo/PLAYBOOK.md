# Fallboard Launch Video & Audience Playbook

Everything in `promo/` is modular and reproducible. You can post the ready-made drafts in `promo/exports/` immediately **or** drop individual clips from `promo/clips/` and piano stems from `promo/audio/` into CapCut / DaVinci Resolve / Premiere alongside your own filmed piano clips.

---

## 1. What Was Generated For You

### Ready-to-Post Draft Exports (`promo/exports/`)
| File | Aspect | Length | Target Platform | What's Inside |
| :--- | :---: | :---: | :--- | :--- |
| `x-master-showcase-16x9.mp4` | 16:9 (1080p) | ~40s | **X / Landing Page / GitHub** | 5-Tab Frankenstein + Paywall roast → Live Stepping & Hand Isolation → `Roll ↔ Score` sync → Library, Henle `6/9` Search & Full-Screen A4 PDF → Signature Endcard + Salamander Grand Piano audio |
| `short-01-ledger-step-9x16.mp4` | 9:16 (1080×1920) | ~24s | **TikTok / Reels / Shorts** | 6-ledger-line jump scare (*"What note even IS this?!"*) → Clean chord-by-chord stepping + Left Hand isolation + `Roll ↔ Score` → Real-glass Endcard *(or swap the first 4s with a real 4s YouTube Synthesia screen recording!)* |
| `short-02-purist-uno-reverse-9x16.mp4` | 9:16 (1080×1920) | ~20s | **TikTok / Reels / Shorts** | *"“Falling notes are for people who can’t read sheet music.”"* → Glass `Roll → Score` pill slide → Live Roll-to-Score flip → Full-Screen A4 PDF → Endcard |
| `short-03-color-worlds-library-9x16.mp4` | 9:16 (1080×1920) | ~19s | **TikTok / Reels / Shorts** | 3 luminous piece color worlds (Chopin Ballade, Rachmaninoff C♯ minor, Revolutionary Étude) → Library covers + Henle search + A4 PDF → Endcard |
| `reddit-raw-demo-16x9.mp4` | 16:9 (1080p) | ~16s | **Reddit (`r/piano`, `r/SideProject`)** | Zero hype, zero marketing bumpers — pure raw Fallboard app demo (stepping, hand isolation, speed, `Roll ↔ Score`) with clean Salamander Grand Piano audio |

### Modular Building Blocks (`promo/clips/16x9/` & `promo/clips/9x16/`)
Every clip is rendered in **both 16:9 and 9:16** at 30fps H.264 (`yuv420p`, CRF 17), using Fallboard's **real `dist/js/glass.js` WebGL refractive glass** & `.seg` / `.btn` components:
* `02-pain-frankenstein.mp4` — IMSLP 15s wait + YouTube Ad + `r/piano` confusion + `$119.99/yr` paywall → *"Learning a piece shouldn't take five apps. Meet Fallboard."*
* `03-hook-purist.mp4` — Purist quote + Fallboard's **real WebGL `glass.js` `Roll → Score` segmented control**
* `04-hook-ledger.mp4` — 6-ledger-line jump scare (*"What note even IS this?!"*) — **ideal hook to splice into your own piano clip or `app-01-step-and-hands.mp4`**
* `05-endcard.mp4` — Signature Fallboard icon + real WebGL `glass.js` pills (*"Free to play · No account required · Works offline"*)
* `06-bumper-step.mp4`, `07-bumper-sync.mp4`, `08-bumper-library.mp4` — Editorial feature chapter bumpers
* `app-01-step-and-hands.mp4` — Live Fallboard WebGL2 Roll: 4 chord steps → Left hand isolated → 50% speed
* `app-02-roll-to-score.mp4` — Live Fallboard: `Roll → Score → Roll` synced on Bar 12
* `app-03-color-worlds.mp4` — Live Fallboard: 3 pieces showing each cover's unique color world
* `app-04-library-henle-pdf.mp4` — Live Fallboard: Library home → `henle 6` search → Chopin cover + full-screen A4 PDF

### Audio Stems (`promo/audio/`)
Rendered directly from Fallboard's own Yamaha C5 Salamander Grand samples (`dist/samples/*.mp3`) and MusicXML scores:
* `pain-youtube-muffled.wav` — Fast Chopin → scrub clicks → underwater muffled 0.5× → glass whoosh
* `pain-frankenstein-sfx.wav` — 4 escalating card hits → glass whoosh → serene G-minor grand chord
* `chopin-step-demo.wav` — 4 crisp single-chord steps → Left Hand only → Both hands
* `chopin-ballade-bed.wav` — 36s lush Chopin Ballade No. 1 main theme
* `rach-cs-bed.wav` — 18s iconic Rachmaninoff Prelude in C♯ minor opening

---

## 2. How to Splice In Your Real Filmed Piano Clips (10-Minute CapCut Recipes)

### Recipe A: "The Botched Chord" Viral Short (Highest TikTok Ceiling)
1. **0:00–0:04 (You film):** Prop phone behind your hands at the piano. Play the first 2 bars of Chopin Ballade No. 1 (or Rachmaninoff C♯ minor), **deliberately smash a horribly wrong dissonant chord**, freeze for 0.5s, sigh, and toss/flip messy printed pages.
2. **0:04–0:18 (Drop in our clips):** Hard cut straight into `promo/clips/9x16/app-01-step-and-hands.mp4` + `app-02-roll-to-score.mp4` with `promo/audio/chopin-step-demo.wav`.
3. **0:18–0:22:** Drop in `promo/clips/9x16/05-endcard.mp4`.

### Recipe B: "Dark-Room Music Stand" Credibility Clip (Zero Talking, Zero Acting)
1. **0:00–0:04:** Use `promo/clips/9x16/04-hook-ledger.mp4` (*"What note even IS this?!"*).
2. **0:04–0:14 (You film):** Lights off, iPad/phone on your piano's music stand running Fallboard in dark mode. Film over your shoulder for 10 seconds as you tap `→` to step through a tricky chord and play the glowing keys in real time.
3. **0:14–0:18:** Drop in `promo/clips/9x16/05-endcard.mp4`.

### Recipe C: "Comment-Request" Infinite Content Loop (Zero Filming)
Whenever someone comments *"Do you have Liebestraum?"* or *"Check Debussy Arabesque"*:
1. Screen-record 12 seconds on your phone: open Fallboard Library → type their piece → open the glowing cover + Henle rating → hit Play for 4 seconds.
2. Tack `promo/clips/9x16/05-endcard.mp4` onto the end and reply directly to their comment.

---

## 3. Ready-to-Use Platform Copy

### X (Twitter) — Main Launch Post (Attach `x-master-showcase-16x9.mp4`)
> I got tired of juggling YouTube tutorials at 0.5× garbled speed, crooked 1890s IMSLP scans, and $120/yr subscription piano apps just to learn one Chopin piece.
>
> So I built **Fallboard** — a free piano practice app that runs in your browser (and works offline):
>
> • Luminous WebGL falling notes synced 1:1 with real engraved sheet music
> • Step chord-by-chord, isolate Left/Right hand, slow down to 25% cleanly
> • 650+ classical scores (3,700+ catalogued with Henle difficulty levels) + instant A4 PDFs
> • Drop in any `.musicxml` of your own
>
> No account. No paywall. Try it here: [link]

*(Follow-up reply 1 for Design/Dev X):*
> A few craft details under the hood: zero build step (static HTML/JS), WebGL2 real-time refractive liquid glass controls, generative typography covers whose color palettes dynamically light the roll & piano keys, and browser-side MuseScore WASM engraving.

### TikTok / Reels / Shorts Captions
* **For `short-01-scrubbing-rage-9x16.mp4`:**
  `pov: trying to learn bar 34 from a youtube piano tutorial 💀 built a free tool so you can step chord-by-chord & mute one hand without a $120/yr sub. link in bio 🎹 #piano #classicalpiano #chopin #pianotutorial`
* **For `short-02-purist-uno-reverse-9x16.mp4`:**
  `wait until the switch 🎹 both falling notes AND real engraved sheet music synced to the exact same bar (plus instant printable PDFs). free, no account needed. #piano #sheetmusic #pianist #classicalmusic`
* **For `short-03-color-worlds-library-9x16.mp4`:**
  `every piece gets its own color palette + real Henle difficulty rating (1/9 to 9/9) 🎹 drop a piece in the comments and i'll check its Henle level & play the opening #piano #classicalmusic #rachmaninoff #chopin`

### Reddit — `r/piano` Post (Attach `reddit-raw-demo-16x9.mp4`)
* **Title:** `I built a free, no-account web app that syncs falling notes with real engraved sheet music (650+ classical scores + Henle ratings + MusicXML upload)`
* **Body:**
  > Hey r/piano — I built this mostly to scratch my own itch while practicing Chopin and Rachmaninoff. I wanted to read real sheet music, but whenever I hit a dense passage I ended up scrubbing back and forth on YouTube videos or digging through crooked IMSLP scans.
  >
  > **Fallboard** is a free static web app (no account, no subscription, works offline as a PWA):
  > - Toggle between a falling-note roll and real engraved sheet music (MuseScore engine) synced to the exact same bar & keyboard
  > - Step forward/back one onset at a time (arrow keys) to inspect dense chords
  > - Isolate Left or Right hand (fades the other hand in both the roll and the sheet music)
  > - Adjust playback speed from 25% to 200% using sampled Salamander Grand Piano audio
  > - Browse ~650 ready-to-play classical scores (out of 3,700+ catalogued works with Henle 1–9 difficulty levels) with printable A4 PDFs, or upload any `.musicxml` / `.mxl` file of your own
  >
  > Note for sheet-music purists: I'm not trying to replace reading notation — the whole point was making it easy to verify a tricky voicing or hand-crossing and immediately jump back to the engraved score.
  >
  > Link: [link] — I'm a solo dev actively adding missing scores from the catalogue, so let me know what pieces you want engraved next or what bugs you hit!

---

## 4. Re-Rendering Anything Later

```powershell
# Re-render motion graphic hooks/bumpers/endcards (edit promo/src/scenes.html first)
node promo/scripts/render-scenes.js

# Re-render Salamander Grand Piano WAV stems
node promo/scripts/make-audio.js

# Re-capture live Fallboard app clips
node promo/scripts/capture-app.js

# Re-assemble all 5 final exports in promo/exports/
node promo/scripts/assemble.js
```
