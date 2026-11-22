# Fallboard Launch Video & Audience Playbook

Everything in `promo/` is modular and reproducible. You can post the ready-made drafts in `promo/exports/` immediately **or** drop single shots from `promo/film/out/<format>/` (one MP4 per shot, plus the whole soundtrack as `sound.wav`) into CapCut / DaVinci Resolve / Premiere alongside your own filmed piano clips.

---

## 1. The Film (`promo/film/`)

One timeline, two formats: `promo/exports/fallboard-16x9.mp4` (X, landing page, GitHub) and `promo/exports/fallboard-9x16.mp4` (Shorts, Reels, TikTok). About 41 seconds.

| Time | What you see | What you hear |
| :--- | :--- | :--- |
| 0:00 | A generic video tutorial of the Revolutionary Étude. *It's too fast.* The cursor drags back: *Too far.* Speed menu → 0.5×: *And 0.5× sounds like this.* | The piece through a laptop speaker; scrub ticks; at 0.5× a smeared, warbling time-stretch |
| 0:07 | A crooked scan slides in: *The sheet music doesn't play.* A paywall: *One hand at a time? Subscribe.* Everything drops away. | Silence, paper, a pop, a low drop |
| 0:11 | The signed-off backdrop, icon and name; the camera dives into the icon and it becomes the app | A clean C minor chord in the app's hall |
| 0:13 | The real app plays bar 9, pauses, steps: *Step through it, chord by chord.* | The app's own piano, each step's chord |
| 0:18 | Hands → Left, play: *One hand at a time. Free.* | The left hand alone |
| 0:22 | Speed → 50%: *Slow it down. Still a real piano.* | Half speed, nothing smeared |
| 0:26 | Roll → Score: *Real sheet music, in sync.* | The same playback |
| 0:31 | The library, down to Rachmaninoff, his page, Play: *650 pieces, ready to play.* / *Each in its own colours.* | The étude under the library, then the Bells of Moscow |
| 0:37 | The app pulls back into the icon: the signed-off endcard | The C♯ ringing out |

Each fix answers one problem from the opening. Everything the app plays is what the app asked its piano for on that frame, rendered with the same sampler, so sound and picture cannot drift apart.

---

---

## 2. How to Splice In Your Real Filmed Piano Clips (10-Minute CapCut Recipes)

### Recipe A: "The Botched Chord" Viral Short (Highest TikTok Ceiling)
1. **0:00–0:04 (You film):** Prop phone behind your hands at the piano. Play the first 2 bars of Chopin Ballade No. 1 (or Rachmaninoff C♯ minor), **deliberately smash a horribly wrong dissonant chord**, freeze for 0.5s, sigh, and toss/flip messy printed pages.
2. **0:04–0:18 (Drop in our clips):** Hard cut straight into `promo/film/out/9x16/02-hands.mp4` + `04-score.mp4`, with the same stretch of `sound.wav`.
3. **0:18–0:22:** Drop in `promo/film/out/9x16/06-end.mp4`.

### Recipe B: "Dark-Room Music Stand" Credibility Clip (Zero Talking, Zero Acting)
1. **0:00–0:04:** Use the first seconds of `promo/film/out/9x16/00-opening.mp4` (*"It's too fast."*).
2. **0:04–0:14 (You film):** Lights off, iPad/phone on your piano's music stand running Fallboard in dark mode. Film over your shoulder for 10 seconds as you tap `→` to step through a tricky chord and play the glowing keys in real time.
3. **0:14–0:18:** Drop in `promo/film/out/9x16/06-end.mp4`.

### Recipe C: "Comment-Request" Infinite Content Loop (Zero Filming)
Whenever someone comments *"Do you have Liebestraum?"* or *"Check Debussy Arabesque"*:
1. Screen-record 12 seconds on your phone: open Fallboard Library → type their piece → open the glowing cover + Henle rating → hit Play for 4 seconds.
2. Tack `promo/film/out/9x16/06-end.mp4` onto the end and reply directly to their comment.

---

## 3. Ready-to-Use Platform Copy

### X (Twitter) — Main Launch Post (Attach `fallboard-16x9.mp4`)
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
* **For `fallboard-9x16.mp4`:**
  `pov: trying to learn bar 34 from a youtube piano tutorial 💀 built a free tool so you can step chord-by-chord & mute one hand without a $120/yr sub. link in bio 🎹 #piano #classicalpiano #chopin #pianotutorial`
* **For a later purist cut (not made yet):**
  `wait until the switch 🎹 both falling notes AND real engraved sheet music synced to the exact same bar (plus instant printable PDFs). free, no account needed. #piano #sheetmusic #pianist #classicalmusic`
* **For a later library cut (not made yet):**
  `every piece gets its own color palette + real Henle difficulty rating (1/9 to 9/9) 🎹 drop a piece in the comments and i'll check its Henle level & play the opening #piano #classicalmusic #rachmaninoff #chopin`

### Reddit — `r/piano` Post (attach a raw screen recording; not made yet)
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

## 4. Re-Rendering

All of it is `promo/film/film.html` + `promo/film/film.js` (the timeline), `promo/film/backdrop.js` (the signed-off backdrop) and `promo/film/app-runtime.js` (the app's virtual clock).

```sh
# stills to check a change (promo/_preview/film-<format>-<t>.png)
node promo/scripts/film.js --format=16x9 --stills=12.4,16,24.5
# the full film in the cloud: Actions → Render Film, or
gh workflow run render-film.yml -f formats=16x9,9x16
# the hook (Rousseau's video → Fallboard), one export per sound mix
gh workflow run render-film.yml -f cut=hook -f formats=16x9 -f mixes=A,B,C
```

The hook's sources (Rousseau's video, its 60 fps frames, the meme sounds) stay out of git in `promo/_src/`. The cloud gets them from the encrypted `promo-src` release asset, opened with the `PROMO_SRC_KEY` Actions secret (the key is also kept locally in `~/.config/fallboard/promo-src-key`). After changing anything in `promo/_src/`, re-upload it:

```sh
GH_TOKEN=… PROMO_SRC_KEY=$(cat ~/.config/fallboard/promo-src-key) promo/scripts/src-assets.sh push
```
