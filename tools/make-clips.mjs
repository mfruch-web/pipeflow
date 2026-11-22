// Renders vertical TikTok/Reels/Shorts clips (1080x1920, 30fps MP4) of the real game.
// Needs Google Chrome and ffmpeg (brew install ffmpeg).
//
//   node tools/make-clips.mjs              # all clips
//   node tools/make-clips.mjs lasttap      # just one
//
// Clips use puzzles from before launch day, so they never spoil a real day's solution.
// The game runs on a virtual clock and every frame is captured, so the footage is perfectly smooth.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tiktok');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 30;

const CLIPS = {
  lasttap:  { level: 'hard', date: '2026-11-15', file: '1-last-tap.mp4' },
  speedrun: { level: 'hard', date: '2026-11-14', file: '2-speed-solve.mp4' },
  easyhard: { level: 'easy', date: '2026-11-13', file: '3-easy-vs-hard.mp4' },
};

// ---------- Runs in the page before any game code: a virtual clock ----------
function virtualClock() {
  let now = 0, nextId = 1;
  const timers = new Map();
  const frames = [];
  const epoch = Date.now();
  window.setTimeout = (fn, ms = 0, ...a) => { const id = nextId++; timers.set(id, { at: now + Math.max(0, +ms || 0), fn: () => fn(...a) }); return id; };
  window.setInterval = (fn, ms = 0, ...a) => { const id = nextId++; timers.set(id, { at: now + Math.max(1, +ms || 1), every: Math.max(1, +ms || 1), fn: () => fn(...a) }); return id; };
  window.clearTimeout = window.clearInterval = (id) => timers.delete(id);
  window.requestAnimationFrame = (cb) => { frames.push(cb); return frames.length; };
  performance.now = () => now;
  Date.now = () => epoch + now;
  window.__vt = {
    advance(dt) {
      const end = now + dt;
      for (;;) {
        let id = null, t = null;
        for (const [k, v] of timers) if (v.at <= end && (!t || v.at < t.at)) { id = k; t = v; }
        if (!t) break;
        now = t.at;
        if (t.every) t.at += t.every; else timers.delete(id);
        try { t.fn(); } catch (e) { console.error(e); }
      }
      now = end;
      frames.splice(0).forEach((cb) => cb(now));
    },
  };
  try { localStorage.setItem('pipeflow:v1:flags', JSON.stringify({ seenHelp: true, a2hsDismissed: true })); } catch {}
}

// ---------- Runs in the page after load: video layout, overlays, and the scripted solves ----------
function clipKit() {
  const css = `
    html, body { overflow: hidden !important; }
    #splash, .topbar, .level-tabs, .hud, .hint, .below, .modal, .toast { display: none !important; }
    #app { display: block !important; }
    .app { min-height: 0 !important; padding: 0 !important; max-width: none !important; }
    .board-wrap { position: fixed !important; left: 0; right: 0; top: 150px; padding: 0 !important; display: flex !important; justify-content: center; }
    .board { width: 300px !important; }
    #clip-top { position: fixed; top: 52px; left: 22px; right: 22px; text-align: center; color: #fff;
      font: 800 26px/1.2 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif;
      text-shadow: 0 2px 0 rgba(0,0,0,.9), 0 0 14px rgba(0,0,0,.5); letter-spacing: -0.2px; }
    #clip-bottom { position: fixed; top: 466px; left: 0; right: 0; display: flex; align-items: center; justify-content: center; gap: 8px;
      font: 700 17px -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; color: #eef0f3; }
    #clip-bottom svg { width: 26px; height: 26px; }
    .clip-in { animation: clipIn .35s cubic-bezier(.2,1.4,.5,1) both; }
    @keyframes clipIn { from { transform: translateY(10px) scale(.92); opacity: 0; } }
    .clip-tap { position: fixed; width: 40px; height: 40px; margin: -20px 0 0 -20px; border-radius: 50%; z-index: 99; pointer-events: none;
      background: rgba(255,255,255,.28); border: 2px solid rgba(255,255,255,.85); animation: clipTap .42s ease-out forwards; }
    @keyframes clipTap { from { transform: scale(.45); opacity: 1; } to { transform: scale(1.35); opacity: 0; } }`;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);
  document.body.insertAdjacentHTML('beforeend',
    `<div id="clip-top"></div><div id="clip-bottom"><svg viewBox="0 0 100 100"><use href="#logo"/></svg>playpipeflow.com</div>`);

  const P = window.Puzzle;
  const LAUNCH = window.PIPEFLOW_CONFIG.launchDate;
  const params = new URLSearchParams(location.search);
  const [y, m, d] = params.get('date').split('-').map(Number);
  const day = new Date(y, m - 1, d);

  let pz, cur, tiles;
  function load(level) {
    pz = P.dailyPuzzle(day, LAUNCH, level);
    cur = pz.start.slice();
    tiles = [...document.querySelectorAll('.board .tile')];
  }
  function setTop(html) {
    const el = document.getElementById('clip-top');
    el.innerHTML = html;
    el.classList.remove('clip-in'); void el.offsetWidth; el.classList.add('clip-in');
  }
  function tap(c, ripple = true) {
    const t = tiles[c];
    t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    t.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
    cur[c] = P.rot(cur[c]);
    if (ripple) {
      const r = t.getBoundingClientRect();
      const dot = document.createElement('div');
      dot.className = 'clip-tap';
      dot.style.left = `${r.left + r.width / 2}px`;
      dot.style.top = `${r.top + r.height / 2}px`;
      document.body.appendChild(dot);
      setTimeout(() => dot.remove(), 450);
    }
  }
  const need = (c) => P.tapsBetween(cur[c], pz.solution[c]);
  // Tiles in the order water would reach them in the solution, tank outward.
  function flowOrder() {
    const { w, h, tank, solution } = pz;
    const seen = new Set([tank]), order = [], q = [tank];
    const step = { 1: -w, 2: 1, 4: w, 8: -1 };
    while (q.length) {
      const c = q.shift();
      order.push(c);
      for (const dir of [1, 2, 4, 8]) {
        if (!(solution[c] & dir)) continue;
        const o = c + step[dir];
        if (o >= 0 && o < w * h && !seen.has(o)) { seen.add(o); q.push(o); }
      }
    }
    return order;
  }
  // The tank's connected neighbors, with the side of each that faces the tank.
  function tankNeighbors() {
    const step = { 1: -pz.w, 2: 1, 4: pz.w, 8: -1 };
    const facing = { 1: 4, 2: 8, 4: 1, 8: 2 };
    return [1, 2, 4, 8].filter((dir) => pz.solution[pz.tank] & dir)
      .map((dir) => ({ c: pz.tank + step[dir], side: facing[dir] }));
  }
  // Schedules taps to solve the given tiles. Returns the time after the last tap.
  function solve(t, order, perTap, perTile) {
    for (const c of order) {
      const k = need(c);
      for (let i = 0; i < k; i++) { const at = t; setTimeout(() => tap(c), at); t += perTap; }
      if (k) t += perTile;
    }
    return t;
  }
  const settle = (ms) => { for (let t = 0; t < ms; t += 33) frame(33); };
  function frame(dt) {
    window.__vt.advance(dt);
    for (const a of document.getAnimations()) {
      if (a.__vt === undefined) { a.pause(); a.__vt = 0; } else a.__vt += dt;
      a.currentTime = a.__vt;
    }
  }

  const scripts = {
    // Everything solved except the tank's own pipes: each tap floods a whole branch.
    lasttap() {
      load('hard');
      const around = tankNeighbors();
      const nbrs = new Set(around.map((n) => n.c));
      for (const c of flowOrder()) if (c !== pz.tank && !nbrs.has(c)) while (need(c) > 0) tap(c, false);
      // Turn each of the tank's pipes away from it, so the whole board starts dry.
      for (const { c, side } of around) while (cur[c] & side) tap(c, false);
      settle(1200);
      setTop('wait for the last tap 💧');
      let t = 1400;
      for (const c of nbrs) {
        const k = need(c);
        for (let i = 0; i < k; i++) { setTimeout(() => tap(c), t); t += 230; }
        t += 750;
      }
      const win = t - 750;
      setTimeout(() => setTop('can you solve one? 👇'), win + 1900);
      return win + 4200;
    },
    // Full scrambled Hard board solved fast, water spreading from the tank.
    speedrun() {
      load('hard');
      settle(300);
      setTop('only puzzle people can<br>solve this one 🧠');
      const end = solve(900, flowOrder(), 68, 38);
      setTimeout(() => setTop('drop your time 👇'), end + 1700);
      return end + 4000;
    },
    // Easy solved, then Hard solved, back to back.
    easyhard() {
      load('easy');
      settle(300);
      setTop('EASY 🟢');
      let t = solve(700, flowOrder(), 115, 70);
      t += 1500;
      setTimeout(() => {
        document.querySelector('.level-tab[data-level="hard"]').click();
        load('hard');
        setTop('HARD 🔴');
      }, t);
      t += 700;
      // Schedule the Hard solve once its board exists.
      const startHard = t;
      setTimeout(() => {
        const end = solve(0, flowOrder(), 52, 28);
        setTimeout(() => setTop('which could you do? 👇'), end + 1600);
      }, startHard);
      // Hard needs about par x 52ms + tiles x 28ms; estimate generously for the clip length.
      const hard = P.dailyPuzzle(day, LAUNCH, 'hard');
      const est = hard.par * 52 + hard.start.filter((mk, c) => mk !== hard.solution[c]).length * 28;
      return startHard + est + 4200;
    },
  };

  window.__clip = { frame, run: (name) => scripts[name]() };
}

// ---------- Chrome DevTools Protocol plumbing ----------
async function withChrome(fn) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'clip-'))}`,
    '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    let tabs;
    for (let i = 0; i < 60 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); } catch { await sleep(200); } }
    const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
    await new Promise((r) => (ws.onopen = r));
    let id = 0; const pending = {};
    ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending[d.id]) { pending[d.id](d); delete pending[d.id]; } };
    const send = (method, params = {}) => new Promise((r) => { pending[++id] = r; ws.send(JSON.stringify({ id, method, params })); });
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true });
      if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text);
      return r.result?.result?.value;
    };
    await fn({ send, evaluate, sleep });
    ws.close();
  } finally {
    chrome.kill();
  }
}

async function render(name) {
  const clip = CLIPS[name];
  const frameDir = mkdtempSync(join(tmpdir(), `frames-${name}-`));
  await withChrome(async ({ send, evaluate, sleep }) => {
    await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 640, deviceScaleFactor: 3, mobile: true });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await send('Page.enable'); // required, or the next line is silently ignored
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${virtualClock})();` });
    const url = pathToFileURL(join(ROOT, 'index.html')).href + `?play=${clip.level}&date=${clip.date}`;
    await send('Page.navigate', { url });
    await sleep(1500);
    await evaluate(`(${clipKit})();`);
    const durationMs = await evaluate(`__clip.run(${JSON.stringify(name)})`);
    const frames = Math.ceil((durationMs / 1000) * FPS);
    process.stdout.write(`${name}: ${frames} frames (${(durationMs / 1000).toFixed(1)}s) `);
    for (let f = 0; f < frames; f++) {
      if (f > 0) await evaluate(`__clip.frame(${1000 / FPS})`);
      const shot = await send('Page.captureScreenshot', { format: 'jpeg', quality: 92 });
      writeFileSync(join(frameDir, `${String(f).padStart(5, '0')}.jpg`), Buffer.from(shot.result.data, 'base64'));
      if (f % 60 === 0) process.stdout.write('.');
    }
  });
  if (process.env.KEEP_FRAMES) { console.log(` frames kept in ${frameDir}`); return; } // debugging: skip the video
  mkdirSync(OUT, { recursive: true });
  const out = join(OUT, clip.file);
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(frameDir, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], { stdio: 'inherit' });
  rmSync(frameDir, { recursive: true, force: true });
  if (r.status !== 0) throw new Error('ffmpeg failed');
  console.log(` -> tiktok/${clip.file}`);
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
for (const name of wanted) {
  if (!CLIPS[name]) { console.error(`unknown clip "${name}". Options: ${Object.keys(CLIPS).join(', ')}`); process.exit(1); }
  await render(name);
}
