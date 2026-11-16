# UltraTouch

Two bar-top style touch games rebuilt for phone browsers (Android and iOS), playable held either way. Landscape gives the biggest picture:

| Game | Inspired by | What you do |
|---|---|---|
| **Swish Shot** | *Hoop Jones* (Megatouch) | Street-court look: brick wall with graffiti result words (SWISH, BRICK, AIRBALL) that light up on each shot, a score / shot clock / hi score strip, and shooters from behind in red team jerseys. Five shooters stand in a row. The ball flies straight up its shooter's lane. One hoop glides slowly at a steady speed nearly edge to edge (about 4.3 s per crossing in round 1, 2.85 s by round 5, measured from arcade footage), the ball reaches the rim in about 0.6 s and then sinks slowly through the net,, bouncing off each side, and slides side to side across their lanes. Tap a shooter just before the hoop passes over his lane, so the ball arrives as it crosses. No power meter: it's all timing. 15 balls and 30 s a round, with a basket quota to qualify. The hoop moves back and speeds up over 5 rounds (4.6 → 8.6 m). Baskets score 2 (3 for a clean swish), and the white backboard flashes on each score. Three in a row brings **LIGHTNING**: bolts strike the rim, the backboard glows electric cyan, and every basket is worth 5 until you miss. A WINNER screen closes the game. 1–4 players pass the phone. |
| **Pair Off** | *Take 2* (Megatouch) | 28 face-up cards in five overlapping brick rows (6-5-6-5-6). A card is open once the cards overlapping it from the row below are gone. Take two open cards: a **pair** (same rank) scores 1,200, a **run** (one up or down, with K–A wrapping round) scores 400. Tallies for each sit on the left. The dealt card (bottom, next to NEXT CARD) counts as open. Tapping NEXT CARD costs 200 and sends the unused dealt card up into the board, filling the first gap from the top row down (if nothing has been cleared yet it waits beside the dealt card and drops in at the first gap). A dot timer runs across the top, and a bonus meter (5,000, draining with the clock) is banked if you clear the board, plus 100 per card left in the deck. TAKE SCORE ends the game and keeps your points. Each deal gets a shorter clock. |

No build step: plain HTML, CSS and JS. Canvas games are drawn at a 540-unit-tall logical resolution whose width follows the screen (letterboxed between 760 and 1240 wide), so they fill everything from 4:3 tablets to 19.5:9 phones. The layout is safe-area aware (notch / Dynamic Island).

## Run it

- **Local:** `python3 -m http.server` in this folder, then open `http://localhost:8000` (or open `dist/ultratouch.html` directly).
- **Live site (GitHub Pages):** https://thedavemonster19.github.io/UltraTouch/ (Settings → Pages → Deploy from a branch → `main` / root). Send that link to friends.
- **Phone, full screen:** open the site on the phone, then
  - **iOS Safari:** Share → *Add to Home Screen*. It launches without browser chrome.
  - **Android Chrome:** *Install app* / *Add to Home screen* (fullscreen from the manifest), or tap **Full screen** on the menu.
- Works offline after the first visit (service worker, hosted copy only).
- **Release step:** run `python3 tools/build_single.py` (and again with `--fragment` for the Artifact). It stamps every CSS/JS link in `index.html` and the service-worker cache name with a content hash, so phones always load a matching fresh set instead of GitHub Pages' 10-minute cached copy. It also writes the one-file `dist/ultratouch.html`.

## Sound

All sound is synthesized live with Web Audio (no files). Swish Shot: shot whoosh, a net swish + score chime + short cheer on every bucket (extra sparkle for a clean swish), rim clang, backboard thud, ball bounce, and on a 3-in-a-row streak a thunder crack, electric zap, power-up run and crowd roar, then a zap on every bucket while the streak lasts. Everything runs through a limiter so big moments are loud without crackling. On iPhone the page asks for media playback (Audio Session API plus a silent looping clip), so sound plays even with the ring/silent switch on silent; phone volume still applies. Sound on/off is on the menu and in the pause sheet.

## Files

```
index.html            menu + game shell
css/style.css         hub, sheets
js/core.js            storage, high scores, Web Audio synth, canvas Stage, helpers
js/swish.js           Swish Shot
js/pairoff.js         Pair Off
js/app.js             menu, pause/results, fullscreen, service worker
manifest.webmanifest  PWA (fullscreen, any orientation)
sw.js                 offline cache (bump VERSION on release)
icons/                generated PNG icons
tools/build_single.py one-file bundle
```

## Research notes (2026-11-16)

Merit's official Megatouch game-description sheet (`meritgames.com/service center/GameDescriptions.pdf`):

- **Hoop Jones:** "challenges the player to time each shot to score a basket. Three consecutive baskets earn lightning bonus points. … the basket moves further away on each round, and shifts side to side throughout all play." The 2009 iPhone version (Megatouch LLC) shows a row of shooters at the bottom and one hoop sliding across the back court. You tap the shooter it's passing, with a time limit and levels that push the hoop back. The bar-top version has five shooters.
- **Take 2:** "Quickly clear all cards from the playfield. Select 2 open cards of same value or 2 open cards in consecutive order. Use the dealt card from the deck when there are no matches available in the playfield. Touching the card deck adds a card to the playfield and subtracts points."

Exact layouts, timings and point values of the originals aren't published. Everything numeric here is our own tuning.

## Naming and legal

*Megatouch*, *Hoop Jones* and the cabinet branding belong to the Megatouch owners (Merit → AMI Entertainment). *Take 2* also collides with the *Take-Two Interactive* trademark. Game **mechanics** aren't protected by copyright, but names, logos, art, sound and screen layouts can be. So this project:

- uses new names (**UltraTouch**, **Swish Shot**, **Pair Off**) and never uses "Megatouch", "Hoop Jones" or "Take 2" in the product,
- draws all art in code (canvas + inline SVG), synthesizes all sound, and copies no assets or screen layouts,
- describes the inspiration only in this README (factual, nominative use).

This is a sensible precaution, not legal advice. Before selling it or publishing it on an app store, get a quick trademark search done for the new names.

## Tuning knobs

- `ROUNDS` in `js/swish.js`: hoop depth, slide speed, make window (`lat`), quota, points. `BALLS`, `ROUND_TIME`, `GAP` and `RELOAD` sit beside it.
- Constants at the top of `js/pairoff.js`: row sizes, run/pair points, deal cost, bonus size, timer dots. The clock is set in `newDeal()`.
