# Pipeflow

A daily pipe puzzle. Turn the pipes so water flows from the tank to every house.

It's a static site with no build step and no server: every player's browser generates the same puzzle from the date.

## Run it locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

### Test on your iPhone
1. Make sure your Mac and iPhone are on the same Wi-Fi.
2. Run the server above, then find your Mac's IP: `ipconfig getifaddr en0`
3. On the iPhone, open Safari and go to `http://<that-ip>:8000`

Handy URL flags (for testing only):
- `?date=2026-11-28` plays another day's puzzles (stats aren't recorded)
- `?play=easy` / `?play=medium` / `?play=hard` skips the splash screen

To reset your progress: Safari → Settings → Advanced → Website Data, then delete the site.

## Live site

**https://playpipeflow.com**, hosted on Cloudflare Pages and connected to this repo, so every push to `main` deploys automatically. The old GitHub Pages address (`mfruch-web.github.io/pipeflow`) forwards to the new domain.

## Deploy

Upload the folder to any static host. Netlify, Vercel, Cloudflare Pages and GitHub Pages all work and are free. Then:
1. Set `siteUrl` in `js/config.js` to your domain (it appears in the share text).
2. Set `launchDate` to the day puzzle #1 goes live.
3. In `index.html`, replace `pipeflow.example.com` in the link-preview tags with your domain. They need full URLs or iMessage won't show the image.
4. Fill in the placeholders in `privacy.html`.

## Ads (Google AdSense)

1. Apply at adsense.google.com once the site is live. Approval goes better with real traffic, a privacy policy (included), and an About/contact page.
2. Once approved, put your `ca-pub-…` client ID and slot IDs in `js/config.js`. The two ad slots, one in the results card and one below the game, appear automatically.
3. Add an `ads.txt` file at your site root with the line AdSense gives you.
4. For visitors in the EU and UK you'll need a consent banner. AdSense's built-in "Privacy & messaging" tool handles this.

Ads never appear next to the board, which keeps misclicks (and AdSense policy problems) away.

## How it works

- `js/puzzle.js`: the engine. Builds a random spanning tree over the grid (no 4-way crosses), checks with a solver that it has exactly **one** solution, scrambles it, and computes par (the fewest clockwise taps to solve it).
- `js/game.js`: the UI, input handling, scoring, stats, and sharing.
- Three puzzles a day: Easy 5×5 (about half the tiles start correct), Medium 6×7, Hard 8×8. Change them in `LEVELS` in `puzzle.js`.
- Give up turns every pipe into the solution. It counts as played but not solved. Your streak continues on any day you solve at least one puzzle.
- **Changing the generator changes every puzzle**, including past and future ones. After launch, only make changes that start on a future date.

## iPhone details

- Fits every iPhone from the SE (375×667) to the Pro Max, and stays clear of the notch, Dynamic Island, and home indicator.
- No double-tap zoom, pinch zoom, rubber-band bounce, long-press callout, or text-selection loupe while playing.
- Haptic tap feedback (iOS 18+), timer pauses when the app goes to the background, and an old tab reopened the next day loads the new puzzle.
- Works as a home-screen app with its own icon. After a solve, Safari users get a one-time tip about adding it.

## Tools
- `node tools/make-icons.js` regenerates the PNG icons in `icons/`.
- `node tools/render-og.mjs` re-renders `og-image.png` (the link preview) from `tools/og-card.html`. Needs Google Chrome installed.

## First-time players
New players get a 3×3 interactive tutorial (also available from How to play). Hints put one tile in place and lock it, costing 5 taps each. The hint code in `js/game.js` (`useHint`) marks where a "watch an ad for a hint" option would go.
