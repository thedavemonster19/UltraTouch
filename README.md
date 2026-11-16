# UltraTouch

Two bar-top style touch games rebuilt for a **phone held sideways** (Android and iOS browsers):

| Game | Inspired by | What you do |
|---|---|---|
| **Swish Shot** | *Hoop Jones* (Megatouch) | A power needle sweeps up and down. Tap the hoop when the needle is in the gold band. The basket slides side to side and moves back each round (4.2 → 7.8 m). Three in a row lights **HEAT** (+300, then double points until you miss). Make the quota in 24 s to qualify for the next round. 1–4 players pass the phone. |
| **Pair Off** | *Take 2* (Megatouch) | Clear 32 cards (8 cascading columns) before the clock runs out. Tap two open cards of the **same rank or one apart** (K–A wraps). The dealt card counts as open. Dealing a new card costs 25 points and breaks your combo. Clearing the board earns 1,000 points, +10 a second left and +100 for each card still in the deck. Each deal gets a shorter clock. |

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

- **Hoop Jones:** "challenges the player to time each shot to score a basket. Three consecutive baskets earn lightning bonus points. … the basket moves further away on each round, and shifts side to side throughout all play." The 2009 iPhone version (Megatouch LLC) added a time limit and up to four players taking turns.
- **Take 2:** "Quickly clear all cards from the playfield. Select 2 open cards of same value or 2 open cards in consecutive order. Use the dealt card from the deck when there are no matches available in the playfield. Touching the card deck adds a card to the playfield and subtracts points."

Exact layouts, timings and point values of the originals aren't published. Everything numeric here is our own tuning.

## Naming and legal

*Megatouch*, *Hoop Jones* and the cabinet branding belong to the Megatouch owners (Merit → AMI Entertainment). *Take 2* also collides with the *Take-Two Interactive* trademark. Game **mechanics** aren't protected by copyright, but names, logos, art, sound and screen layouts can be. So this project:

- uses new names (**UltraTouch**, **Swish Shot**, **Pair Off**) and never uses "Megatouch", "Hoop Jones" or "Take 2" in the product,
- draws all art in code (canvas + inline SVG), synthesizes all sound, and copies no assets or screen layouts,
- describes the inspiration only in this README (factual, nominative use).

This is a sensible precaution, not legal advice. Before selling it or publishing it on an app store, get a quick trademark search done for the new names.

## Tuning knobs

- `ROUNDS` in `js/swish.js`: hoop depth, slide amplitude/speed, make window (`tol` depth, `lat` side to side), needle speed, quota, points.
- Constants at the top of `js/pairoff.js`: columns/depth, deal cost, hint cost, pair base, clear bonus. The clock is set in `newDeal()`.
