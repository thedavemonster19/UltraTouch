# UltraTouch

Two bar-top style touch games rebuilt for a **phone held sideways** (Android and iOS browsers):

| Game | Inspired by | What you do |
|---|---|---|
| **Swish Shot** | *Hoop Jones* (Megatouch) | Street-court look: brick wall with graffiti result words (SWISH, BRICK, AIRBALL) that light up on each shot, a score / shot clock / hi score strip, and shooters from behind in red team jerseys. Five shooters stand in a row. One hoop slides side to side across their lanes. Tap a shooter just before the hoop passes over his lane, so the ball arrives as it crosses. No power meter: it's all timing. 15 balls and 30 s a round, with a basket quota to qualify. The hoop moves back and speeds up over 5 rounds (4.6 → 8.6 m). Baskets score 10–30 by round (+5 for a swish). Three in a row lights **HEAT** (+30, then double points until you miss). A WINNER screen closes the game. 1–4 players pass the phone. |
| **Pair Off** | *Take 2* (Megatouch) | 28 face-up cards in five overlapping brick rows (6-5-6-5-6). A card is open once the cards overlapping it from the row below are gone. Take two open cards: a **pair** (same rank) scores 1,200, a **run** (one up or down, no wrap) scores 400. Tallies for each sit on the left. The dealt card (bottom, next to NEXT CARD) counts as open. Dealing another costs 200. A dot timer runs across the top, and a bonus meter (5,000, draining with the clock) is banked if you clear the board, plus 100 per card left in the deck. TAKE SCORE ends the game and keeps your points. Each deal gets a shorter clock. |

No build step: plain HTML, CSS and JS. Canvas games are drawn at a 540-unit-tall logical resolution whose width follows the screen (letterboxed between 760 and 1240 wide), so they fill everything from 4:3 tablets to 19.5:9 phones. The layout is safe-area aware (notch / Dynamic Island).

## Run it

- **Local:** `python3 -m http.server` in this folder, then open `http://localhost:8000` (or open `dist/ultratouch.html` directly).
- **Live site (GitHub Pages):** https://thedavemonster19.github.io/UltraTouch/ (Settings → Pages → Deploy from a branch → `main` / root). Send that link to friends.
- **Phone, full screen:** open the site on the phone, then
  - **iOS Safari:** Share → *Add to Home Screen*. It launches without browser chrome. iOS can't lock orientation from the web, so a "turn your phone sideways" card shows in portrait.
  - **Android Chrome:** *Install app* / *Add to Home screen* (fullscreen + landscape from the manifest), or tap **Full screen** on the menu, which also locks landscape.
- Works offline after the first visit (service worker, hosted copy only).
- `python3 tools/build_single.py` makes the one-file `dist/ultratouch.html`. Add `--fragment` for the Artifact version.

## Files

```
index.html            menu + game shell
css/style.css         hub, sheets, portrait notice
js/core.js            storage, high scores, Web Audio synth, canvas Stage, helpers
js/swish.js           Swish Shot
js/pairoff.js         Pair Off
js/app.js             menu, pause/results, fullscreen, service worker
manifest.webmanifest  PWA (fullscreen, landscape)
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
