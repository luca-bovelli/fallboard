# Fallboard Audience & Lead-Capture Blueprint (Zero-Auth, High-Intent)

Keeping Fallboard **100% free and account-free to play** is your biggest growth moat—especially on TikTok, X, and `r/piano`, where forcing signup kills 90% of first-session conversions.

The mistake most solo devs make is thinking *"no auth = no audience."* You don't need forced login to build a massive, reusable audience. You just need **high-intent, opt-in moments** where leaving an email or joining your circle actually gives the pianist something they *already want right now*.

---

## 1. Why Discord Alone Isn't Enough (And What Works Better)

Discord is great for **depth**, terrible as your **only net**:
- **Audience mismatch:** Many classical / hobbyist pianists (and 30+ learners, teachers, students on iPads at a piano) either don't use Discord or won't create an account just to say *"please add Debussy Arabesque."*
- **The empty-room problem:** A Discord with 12 quiet members feels dead; an email list of 12 people feels personal and converts at 40–60% when you hit Send.
- **No ownership:** Discord buries servers in folders and mutes notifications by default. **Email is the only channel you truly own**—when you ship MIDI keyboard input, a native iOS/iPad app, or a paid Pro tier a year from now, one email reactivates thousands of pianists instantly.

**The winning formula for Fallboard:**
> **Email = The Net** (embedded right where pianists have peak intent inside the app, framed as a solo dev building *with* them)
> **Discord = The Inner Circle** (invited via your welcome email & in-app link—your top 2–5% superfans who upload `.musicxml` scores, test betas, and vote on features)

---

## 2. Four Zero-Friction Lead-Capture Hooks Built Specifically for Fallboard

### Hook 1: Turn Your ~3,050 "Red-Dot" Missing Scores into a Goldmine *(Highest Conversion)*
Right now in `dist/js/library.js` (line 1092), when a pianist searches for one of the ~3,050 catalogued pieces that doesn't have a playable score yet, they hit a dead end:
> *"This piece has no score of its own yet."*

That exact second is **peak user intent**. They literally just searched for a piece they want to practice!

**Replace that dead end with a 1-field inline glass card:**
> **Want this score next?**
> I engrave requested scores every week. Leave your email and I'll send you a direct link the moment **[Piece Name]** goes live — *Luca (solo dev)*
> `[ your@email.com ]` `[ Request & notify me ]`

**Why this is insanely powerful:**
1. Zero annoyance—it *solves* their frustration instead of interrupting them.
2. Every signup is **auto-tagged with the exact piece & composer they want** (`chopin/op-48/1`, `debussy/l-66/1`, etc.), giving you a live priority queue of which scores from `catalog/requests/` to engrave next!
3. When you publish their score 4 days later and email *"Hey — you asked for Debussy's Arabesque No. 1, it's live on Fallboard now [link]"*, open rates hit **65–80%** and people reply directly like you're a friend.

---

### Hook 2: The "Build Fallboard With Me" Solo-Dev Entry in the Library `…` Menu
Right next to `Share`, `Upload a score`, and `Install Fallboard` in `#libMenu`, add one understated row:
> **Build with me**
> *Request a piece, report a bug, or hear when big updates drop*

Tapping it opens a clean dark modal/sheet (matching Fallboard's liquid glass) with **two simple choices**—no corporate "Contact Support" energy:
1. **"Get updates & vote on what's next"** (1-field email input + optional 1-line note: *"What piece or feature should I add next?"* — framed as: *"I'm Luca, building Fallboard solo. No spam—just a short note when I add big features like MIDI keyboard support or new repertoire batches. Hit reply on any email and it goes straight to me."*)
2. **"Join the small Discord"** (for pianists who *do* live on Discord and want to share `.musicxml` scores or test early builds).

---

### Hook 3: "Notify Me" Feature Waitlists (Demand Validation + Lead Segmentation)
When a pianist finishes a session or opens settings/menu, you can list **2–3 upcoming features** pianists constantly ask for, each as a quiet *"Notify me when ready"* tap:
- **Connect a digital piano (MIDI / Wait-mode)**
- **iOS & iPad App Store version**
- **Sync my recent pieces & progress across devices**

Every click does two things at once:
1. Proves *before you write a line of code* which feature people actually care about (and would pay for later!).
2. Captures segmented emails (`tag: midi-waitlist`, `tag: ios-app`, `tag: sync`) so you can launch each feature to an audience that literally raised its hand for it.

---

### Hook 4: Post-Session Gentle Nudge (Only for Engaged Users, Never First-Timers)
Because Fallboard already saves `fallboard:v1` in `localStorage`, you know who your **most engaged users** are without any server or tracking!
- Trigger condition: **only after a user has opened 3+ pieces OR practiced on 2+ separate days** (and never show it again once dismissed or submitted).
- Show a tiny, non-blocking glass toast/banner at the bottom of the Library home:
  > *"Enjoying Fallboard? I'm building it solo—tell me what piece or feature you want next →"*

Zero first-visit friction, 100% focused on your most engaged leads!

---

## 3. Recommended Zero-Cost Solo-Dev Stack (Fits Your Static Site!)

Since Fallboard is a pure static site on GitHub Pages with no backend:
- **Email List + Replies:** **Buttondown** (free up to 100 subs, indie-dev favorite, clean plain-text emails that feel human) or **Loops / Resend + a tiny Cloudflare Worker** (free tier handles 100k requests/day, lets you save `{ email, pieceId, featureTag, note }` directly to Cloudflare D1/KV or Google Sheets + send an automatic warm welcome email!).
- **Automatic Welcome Email (Crucial!):** The moment someone requests a score or subscribes, auto-send a 4-line plain-text email from `luca@yourdomain.com`:
  > *Hey — got your request for [Piece]. I'm Luca, building Fallboard on my own.*
  > *Quick question if you have 10 seconds: what piano/device are you practicing on, and what's the #1 thing you wish Fallboard did better? Just hit reply—I read every single one.*
  > *(Also, if you want to hang out with a small group of early pianists helping shape the app, here's our little Discord: [invite])*

That single plain-text reply prompt turns passive signups into **real conversations, product testimonials, MusicXML contributors, and superfans**.
