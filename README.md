# Fallboard Piano

Practice piano pieces with a falling-note roll, interactive sheet music, and MusicXML import.

[Open Fallboard Piano](https://fallboard-piano.lucaa-bovelli.chatgpt.site/)

## Run locally

From the repository root, run:

```sh
python -m http.server 8000 --directory dist
```

Open <http://localhost:8000>. The site is static and requires no build step. Score, audio, and engine credits are in `dist/credits.html`.
