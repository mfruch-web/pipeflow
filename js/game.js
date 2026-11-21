/* Pipeflow game UI. Depends on window.Puzzle (puzzle.js) and window.PIPEFLOW_CONFIG (config.js). */
(function () {
  'use strict';

  const P = window.Puzzle;
  const CFG = window.PIPEFLOW_CONFIG;
  const { N, E, S, W, LEVELS, LEVEL_ORDER } = P;

  const LONG_PRESS_MS = 380;
  const MOVE_CANCEL_PX = 14;
  const RUSH_STEP_MS = 55;
  const HINT_PENALTY = 5; // each hint adds this many taps to your score
  const STORE_PROGRESS = 'pipeflow:v2:progress';
  const STORE_STATS = 'pipeflow:v2:stats';
  const STORE_FLAGS = 'pipeflow:v1:flags';

  const $ = (id) => document.getElementById(id);
  const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.navigator.standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches;
  if (isStandalone) document.documentElement.classList.add('standalone');

  // ---------- Storage (iOS private mode or blocked storage can throw) ----------
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const flags = () => store.get(STORE_FLAGS, {});
  const setFlag = (k, v) => store.set(STORE_FLAGS, { ...flags(), [k]: v });

  // ---------- Which day? ----------
  const params = new URLSearchParams(location.search);
  const override = params.get('date'); // ?date=2026-11-28 previews another day (testing only)
  let today = new Date();
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) {
    const [y, m, d] = override.split('-').map(Number);
    today = new Date(y, m - 1, d);
  }
  const dayKey = P.dateKey(today);
  const number = P.puzzleNumber(today, CFG.launchDate);
  const isRealToday = !override || override === P.dateKey(new Date());

  const puzzles = {};
  const getPuzzle = (level) => (puzzles[level] ||= P.dailyPuzzle(today, CFG.launchDate, level));

  // ---------- Progress for today's three puzzles ----------
  let progress = store.get(STORE_PROGRESS, null);
  if (!progress || progress.date !== dayKey) progress = { date: dayKey, levels: {} };
  function levelState(level) {
    if (!progress.levels[level]) {
      const n = getPuzzle(level).start.length;
      progress.levels[level] = {
        turns: new Array(n).fill(0), // cumulative quarter turns, drives the CSS rotation
        locked: new Array(n).fill(false),
        taps: 0, hints: 0, elapsed: 0, solved: false, gaveUp: false,
      };
    }
    return progress.levels[level];
  }
  const isDone = (st) => st && (st.solved || st.gaveUp);

  // The level on screen.
  let game = null; // { level, puzzle, st, tiles, houseCount }

  function save() {
    // Bank the running clock into the saved state without stopping it.
    if (game && runStart !== null) { game.st.elapsed = liveElapsed(); runStart = performance.now(); }
    store.set(STORE_PROGRESS, progress);
  }

  // ---------- Clock (one running clock: the visible level's) ----------
  let runStart = null;
  function liveElapsed() { return game.st.elapsed + (runStart !== null ? performance.now() - runStart : 0); }
  function elapsedMs() { return game ? liveElapsed() : 0; }
  function startClock() { if (game && runStart === null && !isDone(game.st)) runStart = performance.now(); }
  function pauseClock() { if (game && runStart !== null) { game.st.elapsed = liveElapsed(); runStart = null; } }
  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
  };
  setInterval(() => { if (runStart !== null) $('time').textContent = fmtTime(elapsedMs()); }, 250);

  const canRun = () => game && game.st.taps > 0 && !isDone(game.st) && !$('app').hidden && !anyModalOpen();

  // iOS freezes background tabs and may keep one open for days. Pause when hidden,
  // and if the date rolled over while we were away, load the new puzzles.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { pauseClock(); save(); return; }
    if (!override && P.dateKey(new Date()) !== dayKey) { location.reload(); return; }
    if (canRun()) startClock();
  });
  window.addEventListener('pagehide', () => { pauseClock(); save(); });

  // ---------- Haptics ----------
  // Android: Vibration API. iOS Safari 18+: toggling a hidden <input switch> fires the system haptic.
  let hapticLabel = null;
  if (isIOS) {
    hapticLabel = document.createElement('label');
    hapticLabel.setAttribute('aria-hidden', 'true');
    hapticLabel.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    hapticLabel.appendChild(input);
    document.body.appendChild(hapticLabel);
  }
  function haptic(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch { /* ignore */ } }
    else if (hapticLabel) hapticLabel.click();
  }

  // ---------- Tile rendering ----------
  const SVGNS = 'http://www.w3.org/2000/svg';
  const ARM = { [N]: [50, -4], [E]: [104, 50], [S]: [50, 104], [W]: [-4, 50] };
  const LEAK_POS = { [N]: [50, 9], [E]: [91, 50], [S]: [50, 91], [W]: [9, 50] };

  function pipeSVG(mask) {
    let outer = '', water = '';
    for (const d of P.DIRS) {
      if (!(mask & d)) continue;
      const [x, y] = ARM[d];
      outer += `<line class="pipe-outer" x1="50" y1="50" x2="${x}" y2="${y}"/>`;
      water += `<line class="water" x1="50" y1="50" x2="${x}" y2="${y}"/>`;
    }
    return `${outer}<circle class="pipe-hub" cx="50" cy="50" r="13"/>${water}<circle class="water-hub" cx="50" cy="50" r="6"/>`;
  }

  const HOUSE = `
    <circle class="house-glow" cx="50" cy="52" r="26"/>
    <path class="house-roof" d="M50 25 L76 47 H24 Z"/>
    <rect class="house-body" x="31" y="45" width="38" height="29" rx="2"/>
    <rect class="house-window" x="38" y="51" width="9" height="9" rx="1.5"/>
    <rect class="house-window" x="53" y="51" width="9" height="9" rx="1.5"/>
    <rect class="house-window" x="45.5" y="63" width="9" height="11" rx="1"/>`;
  const TANK = `
    <circle class="tank-ring" cx="50" cy="50" r="33"/>
    <circle class="tank-body" cx="50" cy="50" r="26"/>
    <path class="tank-drop" d="M50 34c6 7.5 10 12 10 16.5a10 10 0 0 1-20 0C40 46 44 41.5 50 34z"/>`;
  const LOCK = `
    <g class="lock-badge" transform="translate(80 6)">
      <rect x="0" y="6" width="14" height="11" rx="2"/>
      <path d="M3 7V4.5a4 4 0 0 1 8 0V7h-2V4.5a2 2 0 0 0-4 0V7z"/>
    </g>`;

  const kindName = { end: 'House', straight: 'Straight pipe', corner: 'Corner pipe', tee: 'T pipe' };

  function makeTile(mask, opts = {}) {
    const el = document.createElement('button');
    el.className = 'tile';
    el.type = 'button';
    const kind = P.kindOf(mask);
    if (opts.tank) el.classList.add('tank');
    if (kind === 'end' && !opts.tank) el.classList.add('house');

    const pipe = document.createElementNS(SVGNS, 'svg');
    pipe.setAttribute('viewBox', '0 0 100 100');
    pipe.setAttribute('class', 'pipe-layer');
    pipe.innerHTML = pipeSVG(mask);

    const over = document.createElementNS(SVGNS, 'svg');
    over.setAttribute('viewBox', '0 0 100 100');
    over.setAttribute('class', 'over-layer');
    let leaks = '';
    for (const d of P.DIRS) {
      const [x, y] = LEAK_POS[d];
      leaks += `<circle class="leak" data-dir="${d}" cx="${x}" cy="${y}" r="5"/>`;
    }
    over.innerHTML = (opts.tank ? TANK : kind === 'end' ? HOUSE : '') + leaks + (opts.tank ? '' : LOCK);

    el.append(pipe, over);
    el._pipe = pipe;
    el._leaks = [...over.querySelectorAll('.leak')];
    return el;
  }

  // ---------- Board ----------
  const board = $('board');

  function mountLevel(level) {
    pauseClock();
    if (game) save();
    cancelPress();
    const puzzle = getPuzzle(level);
    const st = levelState(level);
    const { w, h, tank } = puzzle;
    const n = w * h;

    board.innerHTML = '';
    board.className = 'board';
    board.style.setProperty('--cols', w);
    board.style.setProperty('--rows', h);
    const tiles = [];
    for (let c = 0; c < n; c++) {
      const t = makeTile(puzzle.start[c], { tank: c === tank });
      t.dataset.c = c;
      t.tabIndex = c === 0 ? 0 : -1;
      t.setAttribute('role', 'gridcell');
      tiles.push(t);
      board.appendChild(t);
    }
    const houseCount = puzzle.solution.filter((m, c) => c !== tank && P.popcount(m) === 1).length;
    game = { level, puzzle, st, tiles, houseCount };
    for (let c = 0; c < n; c++) setRotation(c, false);

    $('puzzle-label').textContent = `#${number} · ${LEVELS[level].label}`;
    $('hint').textContent = 'Tap to turn · Hold to lock';
    setFlag('lastLevel', level);
    renderTabs();

    const f = refresh();
    if (isDone(st)) playFinish(f, false);
    updateActions();
    if (canRun()) startClock();
  }

  const masks = () => game.puzzle.start.map((m, c) => P.rotN(m, game.st.turns[c]));

  function setRotation(c, animate) {
    const p = game.tiles[c]._pipe;
    if (!animate) p.style.transition = 'none';
    p.style.transform = `rotate(${game.st.turns[c] * 90}deg)`;
    if (!animate) { p.getBoundingClientRect(); p.style.transition = ''; }
  }

  function labelTile(c) {
    const { puzzle, tiles, st } = game;
    const x = c % puzzle.w + 1, y = Math.floor(c / puzzle.w) + 1;
    const kind = c === puzzle.tank ? 'Water tank' : kindName[P.kindOf(puzzle.start[c])];
    const bits = [kind, `row ${y}, column ${x}`];
    if (tiles[c].classList.contains('wet')) bits.push('has water');
    if (st.locked[c]) bits.push('locked');
    tiles[c].setAttribute('aria-label', bits.join(', '));
  }

  function refresh() {
    const { puzzle, tiles, st } = game;
    const ms = masks();
    const f = P.flow(puzzle.w, puzzle.h, ms, puzzle.tank);
    let wetHouses = 0;
    for (let c = 0; c < tiles.length; c++) {
      const t = tiles[c];
      const wet = f.depth[c] >= 0;
      t.classList.toggle('wet', wet);
      t.classList.toggle('locked', !!st.locked[c]);
      if (wet && c !== puzzle.tank && P.popcount(ms[c]) === 1) wetHouses++;
      for (const dot of t._leaks) dot.classList.toggle('on', wet && !f.solved && (f.leaks[c] & Number(dot.dataset.dir)) !== 0);
      labelTile(c);
    }
    const pen = (st.hints || 0) * HINT_PENALTY;
    $('taps').innerHTML = pen ? `${st.taps}<small class="hud-pen">+${pen}</small>` : String(st.taps);
    $('par').textContent = puzzle.par;
    $('houses').textContent = `${wetHouses}/${game.houseCount}`;
    $('time').textContent = fmtTime(elapsedMs());
    return f;
  }

  function rotate(c) {
    const { puzzle, st } = game;
    if (isDone(st)) return;
    if (c === puzzle.tank || st.locked[c]) { nudge(c); return; }
    startClock();
    st.turns[c]++;
    st.taps++;
    setRotation(c, true);
    haptic(8);
    const f = refresh();
    if (st.taps === 1) renderTabs();
    save();
    if (f.solved) win(f);
  }

  function toggleLock(c) {
    const { puzzle, st } = game;
    if (isDone(st) || c === puzzle.tank) return;
    st.locked[c] = !st.locked[c];
    haptic([12, 40, 12]);
    refresh();
    save();
  }

  function nudge(c) {
    const t = game.tiles[c];
    t.classList.remove('nudge');
    void t.offsetWidth;
    t.classList.add('nudge');
  }

  // ---------- Hints ----------
  // Puts one wrong tile into place and locks it. Preference: a tile you locked wrong,
  // then one next to the water (so the hint moves you forward), nearest the tank first.
  // To offer "watch an ad for a hint" later, show the ad first and call this when it's done.
  function useHint() {
    const { puzzle, st, tiles } = game;
    if (isDone(st)) return;
    const { w, h, tank, solution } = puzzle;
    const ms = masks();
    const f = P.flow(w, h, ms, tank);
    const solDepth = (game.solDepth ||= P.flow(w, h, solution, tank).depth);
    const wrong = [];
    for (let c = 0; c < ms.length; c++) if (ms[c] !== solution[c]) wrong.push(c);
    if (!wrong.length) return;
    const nearWater = (c) => {
      if (f.depth[c] >= 0) return true;
      const x = c % w, y = (c / w) | 0;
      return [[x, y - 1], [x + 1, y], [x, y + 1], [x - 1, y]]
        .some(([nx, ny]) => nx >= 0 && ny >= 0 && nx < w && ny < h && f.depth[ny * w + nx] >= 0);
    };
    const lockedWrong = wrong.filter((c) => st.locked[c]);
    const frontier = wrong.filter(nearWater);
    const pool = lockedWrong.length ? lockedWrong : frontier.length ? frontier : wrong;
    const c = pool.reduce((best, x) => (solDepth[x] < solDepth[best] ? x : best), pool[0]);

    startClock();
    const k = P.tapsBetween(ms[c], solution[c]);
    st.turns[c] += k === 3 ? -1 : k;
    st.locked[c] = true;
    st.hints = (st.hints || 0) + 1;
    setRotation(c, true);
    const t = tiles[c];
    t.classList.remove('hinted'); void t.offsetWidth; t.classList.add('hinted');
    setTimeout(() => t.classList.remove('hinted'), 1600);
    haptic([10, 30, 10]);
    const after = refresh();
    if (st.taps === 0) renderTabs();
    save();
    toast(`Hint used · +${HINT_PENALTY} taps`);
    if (after.solved) win(after);
  }

  // ---------- Input: tap to rotate, hold to lock ----------
  // touch-action:none on the board (in CSS) stops iOS from treating touches as scrolls
  // or double-tap zooms, so pointer events arrive right away with no delay.
  let press = null;
  board.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    const t = e.target.closest('.tile');
    if (!t || !game || isDone(game.st)) return;
    const c = Number(t.dataset.c);
    if (press) clearTimeout(press.timer);
    t.classList.add('pressing');
    press = {
      c, el: t, id: e.pointerId, x: e.clientX, y: e.clientY,
      timer: setTimeout(() => {
        t.classList.remove('pressing');
        press = null;
        toggleLock(c);
      }, LONG_PRESS_MS),
    };
  });
  board.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_CANCEL_PX) cancelPress();
  });
  board.addEventListener('pointerup', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const c = press.c;
    cancelPress();
    rotate(c);
  });
  board.addEventListener('pointercancel', cancelPress);
  board.addEventListener('pointerleave', cancelPress);
  function cancelPress() {
    if (!press) return;
    clearTimeout(press.timer);
    press.el.classList.remove('pressing');
    press = null;
  }
  // Desktop: right-click locks. iOS: block the long-press callout menu.
  board.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (e.pointerType === 'mouse' || e.button === 2) {
      const t = e.target.closest('.tile');
      if (t && !press) toggleLock(Number(t.dataset.c));
    }
  });
  // Block Safari pinch-zoom on the board.
  ['gesturestart', 'gesturechange'].forEach((ev) => board.addEventListener(ev, (e) => e.preventDefault()));

  // Keyboard: arrows move, Enter/Space turn, L locks.
  board.addEventListener('keydown', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !game) return;
    const { w } = game.puzzle;
    const n = game.tiles.length;
    const c = Number(t.dataset.c);
    let next = null;
    if (e.key === 'ArrowRight' && c % w < w - 1) next = c + 1;
    else if (e.key === 'ArrowLeft' && c % w > 0) next = c - 1;
    else if (e.key === 'ArrowDown' && c + w < n) next = c + w;
    else if (e.key === 'ArrowUp' && c - w >= 0) next = c - w;
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); rotate(c); return; }
    else if (e.key === 'l' || e.key === 'L') { toggleLock(c); return; }
    if (next !== null) {
      e.preventDefault();
      t.tabIndex = -1;
      game.tiles[next].tabIndex = 0;
      game.tiles[next].focus();
    }
  });

  // ---------- Finishing: win or give up ----------
  function win(f) {
    pauseClock();
    game.st.solved = true;
    save();
    recordResult(game.level, game.st);
    renderTabs();
    updateActions();
    playFinish(f, true);
  }

  function giveUp() {
    const { puzzle, st, tiles } = game;
    pauseClock();
    // Turn every tile to its solved position, the short way round where we can.
    const ms = masks();
    for (let c = 0; c < tiles.length; c++) {
      const k = P.tapsBetween(ms[c], puzzle.solution[c]);
      st.turns[c] += k === 3 ? -1 : k;
      st.locked[c] = false;
      setRotation(c, true);
    }
    st.gaveUp = true;
    save();
    recordResult(game.level, st);
    renderTabs();
    updateActions();
    setTimeout(() => playFinish(refresh(), true), 260);
  }

  function playFinish(f, animate) {
    const { tiles, st } = game;
    board.classList.add('won');
    board.classList.toggle('gaveup', !!st.gaveUp);
    $('hint').textContent = st.gaveUp ? 'Here’s the solution' : 'Every house has water!';
    let maxDepth = 0;
    for (let c = 0; c < tiles.length; c++) {
      const d = Math.max(0, f.depth[c]);
      maxDepth = Math.max(maxDepth, d);
      const t = tiles[c];
      t.style.setProperty('--delay', animate ? `${d * RUSH_STEP_MS}ms` : '0ms');
      if (animate) t.classList.add('rush');
      if (t.classList.contains('house')) {
        if (animate) setTimeout(() => t.classList.add('lit'), d * RUSH_STEP_MS + 250);
        else t.classList.add('lit');
      }
    }
    if (animate) {
      if (!st.gaveUp) haptic([20, 60, 20, 60, 40]);
      const level = game.level;
      setTimeout(() => { if (game.level === level) openResults(); }, maxDepth * RUSH_STEP_MS + (st.gaveUp ? 1400 : 1100));
    }
  }

  function updateActions() {
    const done = isDone(game.st);
    $('play-actions').hidden = done;
    $('show-results').hidden = !done;
    const next = nextLevel();
    $('next-level').hidden = !done || !next;
    if (next) $('next-level').textContent = `Play ${LEVELS[next].label}`;
  }

  // The next unfinished level after the current one (wrapping), if any.
  function nextLevel() {
    const i = LEVEL_ORDER.indexOf(game.level);
    for (let k = 1; k < LEVEL_ORDER.length; k++) {
      const lv = LEVEL_ORDER[(i + k) % LEVEL_ORDER.length];
      if (!isDone(progress.levels[lv])) return lv;
    }
    return null;
  }

  // ---------- Scoring ----------
  // Grades are by percent over par, so +10 on a 107-par Hard board scores
  // the same as +2 on a 21-par Easy board.
  //   Par: 🟩🟩🟩🟩   up to 10%: 🟩🟩🟩🟨   up to 25%: 🟩🟩🟨🟨
  //   up to 50%: 🟩🟨🟨🟨   up to 100%: 🟨🟨🟨🟨   more: 🟨🟨🟨🟧
  const TIER_LIMITS = [0, 0.10, 0.25, 0.50, 1.00];
  function tier(delta, par) {
    if (delta <= 0) return 0;
    const pct = delta / Math.max(1, par);
    const i = TIER_LIMITS.findIndex((lim) => pct <= lim);
    return i === -1 ? 5 : i;
  }
  const SQUARES = ['🟩🟩🟩🟩', '🟩🟩🟩🟨', '🟩🟩🟨🟨', '🟩🟨🟨🟨', '🟨🟨🟨🟨', '🟨🟨🟨🟧'];
  const VERDICTS = ['Perfect flow', 'Smooth sailing', 'Nicely done', 'A few drips', 'Leaky but done', 'You got there'];
  const squares = (delta, par) => SQUARES[tier(delta, par)];
  const verdict = (delta, par) => VERDICTS[tier(delta, par)];
  const parText = (delta) => (delta <= 0 ? 'Par' : `Par +${delta}`);
  // Score vs par: taps plus the hint penalty. Works on live state and saved results.
  const deltaOf = (r, par) => r.taps + (r.hints || 0) * HINT_PENALTY - (par !== undefined ? par : r.par);
  const hintText = (n) => (n ? ` · ${n} hint${n > 1 ? 's' : ''}` : '');

  function shareText() {
    const lines = [`${CFG.name} #${number} 💧`];
    for (const lv of LEVEL_ORDER) {
      const st = progress.levels[lv];
      if (!isDone(st)) continue;
      const label = LEVELS[lv].label.padEnd(6, ' ');
      if (st.gaveUp) lines.push(`${label} · gave up 🏳️`);
      else {
        const delta = deltaOf(st, getPuzzle(lv).par);
        lines.push(`${label} · ${fmtTime(st.elapsed)} · ${parText(delta)} ${squares(delta, getPuzzle(lv).par)}${st.hints ? ` 💡${st.hints}` : ''}`);
      }
    }
    lines.push(CFG.siteUrl);
    return lines.join('\n');
  }

  // ---------- Stats ----------
  // history: { 'YYYY-MM-DD': { easy: { taps, par, timeMs } | { gaveUp: true, timeMs }, ... } }
  function recordResult(level, st) {
    if (!isRealToday) return;
    const stats = store.get(STORE_STATS, { history: {} });
    const day = (stats.history[dayKey] ||= {});
    if (day[level]) return;
    day[level] = st.gaveUp
      ? { gaveUp: true, timeMs: Math.round(st.elapsed) }
      : { taps: st.taps, hints: st.hints || 0, par: getPuzzle(level).par, timeMs: Math.round(st.elapsed) };
    store.set(STORE_STATS, stats);
  }

  function computeStats() {
    const { history } = store.get(STORE_STATS, { history: {} });
    const entries = [];
    for (const [date, levels] of Object.entries(history)) {
      for (const [level, r] of Object.entries(levels)) entries.push({ date, level, ...r });
    }
    const solved = entries.filter((e) => !e.gaveUp);
    // A streak day is any day you solved at least one of the three puzzles.
    const solvedDay = (d) => { const lv = history[P.dateKey(d)]; return !!lv && Object.values(lv).some((r) => !r.gaveUp); };
    const day = new Date(); day.setHours(12, 0, 0, 0);
    if (!solvedDay(day)) day.setDate(day.getDate() - 1);
    let streak = 0;
    while (solvedDay(day)) { streak++; day.setDate(day.getDate() - 1); }

    let max = 0, run = 0, prev = null;
    for (const k of Object.keys(history).sort()) {
      const [y, m, d] = k.split('-').map(Number);
      const t = new Date(y, m - 1, d, 12);
      if (!solvedDay(t)) { run = 0; prev = null; continue; }
      run = prev && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
      max = Math.max(max, run);
      prev = t;
    }
    // Chart rows follow the share-square grades; the last row also holds the 100%+ grade.
    const rowOf = (e) => Math.min(4, tier(deltaOf(e), e.par));
    const rows = solved.map(rowOf);
    const buckets = ['Par', '≤10%', '≤25%', '≤50%', '>50%']
      .map((label, i) => ({ label, row: i, count: rows.filter((r) => r === i).length }));
    buckets.push({ label: 'Gave up', gaveUp: true, count: entries.length - solved.length });
    return {
      played: entries.length,
      solvePct: entries.length ? Math.round((100 * solved.length) / entries.length) : 0,
      streak, max, buckets, history, rowOf,
    };
  }

  function renderStats() {
    const s = computeStats();
    $('s-played').textContent = s.played;
    $('s-pct').textContent = s.solvePct;
    $('s-streak').textContent = s.streak;
    $('s-max').textContent = s.max;
    const most = Math.max(1, ...s.buckets.map((b) => b.count));
    const mine = s.history[dayKey] && game ? s.history[dayKey][game.level] : null;
    $('s-dist').innerHTML = s.buckets.map((b) => {
      let isToday = false;
      if (mine) {
        isToday = b.gaveUp ? !!mine.gaveUp : !mine.gaveUp && s.rowOf(mine) === b.row;
      }
      return `<div class="dist-row"><span>${b.label}</span><span class="dist-bar${isToday ? ' today' : ''}" style="width:${Math.max(8, (b.count / most) * 100)}%">${b.count}</span></div>`;
    }).join('');
  }

  // ---------- Level tabs and splash buttons ----------
  function statusOf(level) {
    const st = progress.levels[level];
    if (!st) return '';
    if (st.solved) return 'solved';
    if (st.gaveUp) return 'gaveup';
    return st.taps > 0 ? 'started' : '';
  }
  const STATUS_TEXT = { solved: 'Solved', gaveup: 'Gave up', started: 'In progress', '': '' };

  function renderTabs() {
    document.querySelectorAll('.level-tab').forEach((b) => {
      const lv = b.dataset.level;
      b.setAttribute('aria-selected', String(!!game && game.level === lv));
      b.dataset.status = statusOf(lv);
      b.title = STATUS_TEXT[statusOf(lv)] || LEVELS[lv].label;
    });
    document.querySelectorAll('.level-btn').forEach((b) => {
      const lv = b.dataset.level;
      const status = statusOf(lv);
      b.dataset.status = status;
      const p = getPuzzle(lv);
      b.querySelector('.level-meta').textContent = STATUS_TEXT[status] || `${p.w}×${p.h}`;
    });
  }

  document.querySelectorAll('.level-tab').forEach((b) => b.addEventListener('click', () => {
    if (game && game.level === b.dataset.level) return;
    mountLevel(b.dataset.level);
  }));

  // ---------- Modals ----------
  const anyModalOpen = () => [...document.querySelectorAll('.modal')].some((m) => !m.hidden);
  let lastFocus = null;
  function openModal(id) {
    lastFocus = document.activeElement;
    pauseClock();
    $(id).hidden = false;
    const focusTarget = $(id).querySelector('[data-autofocus]') || $(id).querySelector('.modal-close');
    if (focusTarget) focusTarget.focus({ preventScroll: true });
  }
  function closeModal(m) {
    m.hidden = true;
    if (!anyModalOpen()) {
      if (canRun()) startClock();
      if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    }
  }
  document.querySelectorAll('.modal').forEach((m) => {
    m.addEventListener('click', (e) => {
      if (e.target === m || e.target.closest('.modal-close') || e.target.closest('[data-close]')) closeModal(m);
    });
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.querySelectorAll('.modal:not([hidden])').forEach(closeModal);
  });

  function openResults() {
    const { st, puzzle, level } = game;
    $('result-block').hidden = false;
    $('result-kicker').textContent = `${CFG.name} #${number} · ${LEVELS[level].label}`;
    $('r-time').textContent = fmtTime(st.elapsed);
    if (st.gaveUp) {
      $('result-title').textContent = 'Here’s the solution';
      $('r-par').textContent = 'Gave up';
      $('r-taps').textContent = `${st.taps} taps${hintText(st.hints)} · par ${puzzle.par}`;
      $('r-squares').textContent = '';
    } else {
      const delta = deltaOf(st, puzzle.par);
      $('result-title').textContent = verdict(delta, puzzle.par);
      $('r-par').textContent = parText(delta);
      $('r-taps').textContent = `${st.taps} taps${hintText(st.hints)} · par ${puzzle.par}`;
      $('r-squares').textContent = squares(delta, puzzle.par);
    }
    const next = nextLevel();
    $('r-next').hidden = !next;
    if (next) {
      $('r-next').textContent = `Play ${LEVELS[next].label} →`;
      $('r-next').dataset.level = next;
    }
    // On iPhone in Safari, suggest Add to Home Screen once they've finished a puzzle.
    $('a2hs').hidden = !(isIOS && !isStandalone && !flags().a2hsDismissed);
    renderStats();
    openModal('stats-modal');
    loadAd('ad-results', CFG.adsense.slots.results);
  }
  $('r-next').addEventListener('click', () => {
    closeModal($('stats-modal'));
    mountLevel($('r-next').dataset.level);
  });
  $('a2hs-close').addEventListener('click', () => { setFlag('a2hsDismissed', true); $('a2hs').hidden = true; });

  $('help-btn').addEventListener('click', () => openModal('help-modal'));
  $('splash-help').addEventListener('click', () => openModal('help-modal'));
  $('stats-btn').addEventListener('click', () => {
    if (game && isDone(game.st)) { openResults(); return; }
    $('result-block').hidden = true;
    renderStats();
    openModal('stats-modal');
  });
  $('show-results').addEventListener('click', openResults);
  $('next-level').addEventListener('click', () => { const nx = nextLevel(); if (nx) mountLevel(nx); });

  $('hint-btn').addEventListener('click', useHint);

  // Give up asks first, so a stray tap can't throw the puzzle away.
  $('giveup-btn').addEventListener('click', () => openModal('giveup-modal'));
  $('giveup-confirm').addEventListener('click', () => {
    closeModal($('giveup-modal'));
    giveUp();
  });

  // ---------- Share ----------
  $('share-btn').addEventListener('click', async () => {
    const text = shareText();
    // The iOS share sheet goes straight to Messages, which is where daily-game results get shared.
    if (navigator.share && (isIOS || navigator.maxTouchPoints > 0)) {
      try { await navigator.share({ text }); return; } catch (err) { if (err && err.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied results to clipboard');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      toast('Copied results to clipboard');
    }
  });

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
  }

  // ---------- Countdown to the next puzzles ----------
  setInterval(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = next - now;
    $('countdown').textContent = fmtTime(ms).padStart(8, '0');
    if (ms < 1000 && !override) setTimeout(() => location.reload(), 1500);
  }, 1000);

  // ---------- Ads ----------
  let adsLoaded = false;
  function loadAd(containerId, slot) {
    const client = CFG.adsense && CFG.adsense.client;
    if (!client || !slot) return;
    const box = $(containerId);
    if (box.dataset.filled) return;
    if (!adsLoaded) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
      adsLoaded = true;
    }
    box.innerHTML = `<ins class="adsbygoogle" style="display:block;width:100%" data-ad-client="${client}" data-ad-slot="${slot}" data-ad-format="auto" data-full-width-responsive="true"></ins>`;
    box.hidden = false;
    box.dataset.filled = '1';
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  }

  // ---------- Help pieces ----------
  const examples = [['Tank', E, true], ['Straight', N | S], ['Corner', N | E], ['T', N | E | S], ['House', N]];
  for (const [label, m, isTank] of examples) {
    const wrap = document.createElement('div');
    wrap.className = 'help-piece';
    const t = makeTile(m, { tank: isTank });
    t.tabIndex = -1;
    t.setAttribute('aria-hidden', 'true');
    if (label !== 'House' && label !== 'Corner') t.classList.add('wet');
    wrap.append(t, Object.assign(document.createElement('span'), { textContent: label }));
    $('help-pieces').appendChild(wrap);
  }

  // ---------- Tutorial: a 3x3 puzzle solved in 4 taps ----------
  // Tank in the middle, four houses. Three tiles start wrong; the glowing tile is always the next one to fix.
  const TUT = {
    w: 3, h: 3, tank: 4,
    solution: [6, 8, 4, 3, 14, 9, 2, 11, 8],
    start: [6, 8, 1, 9, 14, 9, 2, 13, 8],
    order: [3, 0, 1, 5, 2, 7, 6, 8], // outward from the tank
  };
  let tut = null;

  function openTutorial() {
    const box = $('tut-board');
    box.innerHTML = '';
    box.className = 'board tut-board';
    tut = { turns: new Array(9).fill(0), tiles: [], done: false, taps: 0 };
    for (let c = 0; c < 9; c++) {
      const t = makeTile(TUT.start[c], { tank: c === TUT.tank });
      t.dataset.c = c;
      t.setAttribute('aria-label', c === TUT.tank ? 'Water tank' : kindName[P.kindOf(TUT.start[c])]);
      tut.tiles.push(t);
      box.appendChild(t);
    }
    $('tut-done').hidden = true;
    $('tut-tip').hidden = true;
    tutRefresh();
    openModal('tutorial-modal');
  }

  function tutRefresh() {
    const ms = TUT.start.map((m, c) => P.rotN(m, tut.turns[c]));
    const f = P.flow(3, 3, ms, TUT.tank);
    let wetHouses = 0;
    tut.tiles.forEach((t, c) => {
      t.classList.toggle('wet', f.depth[c] >= 0);
      if (f.depth[c] >= 0 && t.classList.contains('house')) wetHouses++;
      for (const dot of t._leaks) dot.classList.toggle('on', f.depth[c] >= 0 && !f.solved && (f.leaks[c] & Number(dot.dataset.dir)) !== 0);
    });
    const target = TUT.order.find((c) => ms[c] !== TUT.solution[c]);
    tut.tiles.forEach((t, c) => t.classList.toggle('target', !f.solved && c === target));
    if (f.solved) {
      tut.done = true;
      const box = $('tut-board');
      box.classList.add('won');
      tut.tiles.forEach((t, c) => {
        t.style.setProperty('--delay', `${f.depth[c] * RUSH_STEP_MS}ms`);
        t.classList.add('rush');
        if (t.classList.contains('house')) setTimeout(() => t.classList.add('lit'), f.depth[c] * RUSH_STEP_MS + 250);
      });
      haptic([20, 60, 20]);
      $('tut-text').innerHTML = '<strong>Every house has water!</strong> That\u2019s the whole game. Bigger boards just take more thinking.';
      $('tut-tip').hidden = false;
      $('tut-done').hidden = false;
      $('tut-done').focus({ preventScroll: true });
    } else if (tut.taps === 0) {
      $('tut-text').innerHTML = 'Water flows from the <strong>tank</strong> into any pipe that connects to it. <strong>Tap the glowing tile</strong> to turn it.';
    } else {
      $('tut-text').innerHTML = `<strong>${wetHouses} of 4</strong> houses have water. Keep tapping the glowing tiles.`;
    }
  }

  $('tut-board').addEventListener('click', (e) => {
    const t = e.target.closest('.tile');
    if (!t || !tut || tut.done) return;
    const c = Number(t.dataset.c);
    if (c === TUT.tank) return;
    tut.turns[c]++;
    tut.taps++;
    t._pipe.style.transform = `rotate(${tut.turns[c] * 90}deg)`;
    haptic(8);
    tutRefresh();
  });
  $('tut-open').addEventListener('click', () => { closeModal($('help-modal')); openTutorial(); });

  // ---------- Splash / start ----------
  $('splash-date').textContent = today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  $('splash-number').textContent = `No. ${number}`;

  function startLevel(level) {
    $('splash').hidden = true;
    $('app').hidden = false;
    loadAd('ad-footer', CFG.adsense.slots.footer);
    mountLevel(level);
    if (isDone(game.st)) { openResults(); return; }
    if (!flags().seenHelp) { setFlag('seenHelp', true); openTutorial(); }
  }
  document.querySelectorAll('.level-btn').forEach((b) => b.addEventListener('click', () => startLevel(b.dataset.level)));

  renderTabs();
  // ?play=hard skips the splash (handy for testing)
  if (params.has('play')) startLevel(LEVELS[params.get('play')] ? params.get('play') : 'easy');
})();
