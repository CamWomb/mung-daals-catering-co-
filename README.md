# Mung Daal's Catering Co.

A cooking/management fan-game based on the cartoon *Chowder*. Runs offline by
double-clicking `index.html` — no build step, no network resources.

**Graphics:** real-time 3D (low-poly cartoon, thick inverted-hull outlines)
rendered with [Three.js r128](https://threejs.org), bundled locally as
`three.min.js`. All models are procedural primitives, modeled to the show's
canonical designs (Chowder's two-point hat and striped tail, Mung's plaid
kilt and glasses, Truffles' dotted cap, brown-mammoth Gazpacho, green-haired
Ms. Endive...). Clothing patterns (polka dots, plaid — the show's
static-pattern gag) are canvas-generated textures. Characters yaw-rotate to
face their walking direction in the market. UI/HUD is a 2D canvas layered
over the WebGL canvas. If WebGL is unavailable, the game automatically falls
back to its original full-2D renderer — every phase stays playable either way.

## How to run

Double-click `index.html`. That's it. (Any modern browser works.)

## The day loop

Each in-game day has 4 phases:

1. **Morning** — Mung Daal announces 2–4 catering jobs in the 3D kitchen.
   Space/click advances dialogue.
2. **Market** — Walk around a 3D Marzipan City plaza (camera follows you).
   Buy the ingredients your jobs need. Rare ingredients rotate daily;
   Gazpacho sells cheap "totally legit" mystery boxes (gamble: rare find or
   literal junk). Repeat purchases befriend vendors for discounts. Truffles
   yells if you blow the daily budget. Walk to the red **START SERVICE** gate
   when ready.
3. **Service** — Orders arrive with timers (3D customers queue at the
   counter). Click a ticket (or press 1–5), start the dish, then play a
   mini-game per step:
   - **CHOP** — press Space when the marker is inside the green zone (4 rounds).
   - **STIR** — circle the mouse around the pot at a steady speed (or hold ←/→); too slow or too wild and it burns.
   - **OVEN** — press Space while the meter is in the golden window.
   - **PLATE** — drag each item onto its matching colored ghost, then Serve.
   Botched a step? Serve it anyway (lower tip) or bin it and restart the dish.
   Watch out for the **Chowder Factor**: random chaos events (eaten ingredients,
   dish-hostage situations, thrice-cream sneezes, rare bonus dishes), plus
   sabotage from Ms. Endive and Panini — some can be countered for cash.
4. **Evening** — Tally of earnings/tips/expenses, a 1–5 star rating, the
   upgrade shop (sharp knives, turbo oven, bigger counter, Schnitzel's
   auto-station), and the recipe book (14 show-inspired dishes to unlock via
   stars, earnings, and rare ingredients).

Every 5th day is a special event (Thrice Cream Festival, Endive's Cook-Off,
Gangster's Party) with more orders and 1.5x pay. Money, stars, upgrades, and
unlocks persist across days; the loop repeats indefinitely.

## Controls

| Input | Action |
|---|---|
| WASD / arrows | Walk (market), stir fallback (service) |
| Space / E | Interact, advance dialogue, mini-game action |
| Mouse | Click buttons/tickets, stir, drag plating items |
| 1–5 | Select an order ticket (service) |
| Tab | Switch between Chowder and Schnitzel in the market (Schnitzel is faster) |
| B | Bin a botched dish |
| Enter | Confirm / next day |
| Esc | Close panels |
| M | Mute/unmute |

## Tips

- Check job recipes in the morning, then buy exactly what they need — missing
  ingredients mean improvising at a quality penalty.
- Higher quality = bigger tips; 85%+ dishes sometimes earn a "Radda radda!"
- Gazpacho's mystery box is the cheapest way to stock rare ingredients (and to
  unlock the Thrice Cream Supreme).
- Save for Schnitzel's Station — a whole parallel dish cooked for free (and
  Schnitzel appears at his own 3D station in the kitchen).

## Mobile / touch controls

The game auto-detects touch devices and shows touch controls automatically
(desktop players can force them on/off with the **TOUCH UI** button on the
title or help screen). Everything is playable with taps and drags:

- **Move (market):** drag anywhere on the left half of the screen — a floating
  virtual joystick appears under your finger.
- **USE / SWAP (market):** big buttons on the right — shop / start service /
  switch between Chowder and Schnitzel.
- **Context action button:** labeled per situation — NEXT (dialogue/evening),
  COOK (service), CHOP! / PULL! / MASH! (mini-games and Chowder wrestling).
- **Mini-games:** chop = tap at the right moment; stir = drag your finger in
  circles around the pot; oven = tap in the golden window; plating = drag
  items with your finger (extra-generous touch targets).
- **Mute:** the small M button, top-right.
- All menus, shops, prompts, and the recipe book are tap-friendly.
- Landscape is the recommended orientation; in portrait the game letterboxes
  and shows a rotate hint.

## Files

- `index.html` / `style.css` — page shell; stacked WebGL + 2D HUD canvases
- `game.js` — all gameplay logic, state machine, mini-games, 2D HUD, 2D fallback renderer
- `world3d.js` — Three.js renderer: character rigs, market/kitchen scenes, camera
- `three.min.js` — Three.js r128 (UMD), bundled for offline play
