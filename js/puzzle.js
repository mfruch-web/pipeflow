/*
 * Pipeflow puzzle engine: seeded generation, solving, and par calculation.
 * Pure logic with no DOM access, so it runs in the browser and in Node (for tests).
 *
 * Tiles are 4-bit masks of open sides: N=1, E=2, S=4, W=8.
 * Rotating a tile a quarter turn clockwise maps N->E->S->W->N.
 */
(function (root) {
  'use strict';

  const N = 1, E = 2, S = 4, W = 8;
  const DIRS = [N, E, S, W];
  const DX = { [N]: 0, [E]: 1, [S]: 0, [W]: -1 };
  const DY = { [N]: -1, [E]: 0, [S]: 1, [W]: 0 };
  const OPP = { [N]: S, [E]: W, [S]: N, [W]: E };

  const rot = (m) => ((m << 1) | (m >> 3)) & 15;
  const rotN = (m, k) => { for (let i = 0; i < ((k % 4) + 4) % 4; i++) m = rot(m); return m; };
  const popcount = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);

  /** Distinct orientations of a mask (a straight pipe only has 2, for example). */
  function orientations(m) {
    const out = [];
    for (let k = 0; k < 4; k++) {
      const r = rotN(m, k);
      if (!out.includes(r)) out.push(r);
    }
    return out;
  }

  /** Fewest clockwise taps to turn `from` into `to` (Infinity if impossible). */
  function tapsBetween(from, to) {
    let m = from;
    for (let k = 0; k < 4; k++) {
      if (m === to) return k;
      m = rot(m);
    }
    return Infinity;
  }

  function kindOf(m) {
    const c = popcount(m);
    if (c === 1) return 'end';
    if (c === 3) return 'tee';
    if (c === 2) return (m === (N | S) || m === (E | W)) ? 'straight' : 'corner';
    return c === 4 ? 'cross' : 'empty';
  }

  // ---------- Seeded RNG ----------
  function hashString(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- Generation ----------
  /**
   * Random spanning tree over the whole grid with every node's degree <= 3
   * (no 4-way crosses). Leaves become houses; one node is the tank.
   */
  function generateTree(w, h, rng, opts) {
    const n = w * h;
    const masks = new Array(n).fill(0);
    const inTree = new Array(n).fill(false);
    const deg = new Array(n).fill(0);

    // Tank somewhere near the middle so the network branches in every direction.
    const tx = Math.floor(w / 2) + (rng() < 0.5 ? 0 : -(w % 2 === 0 ? 1 : 0));
    const ty = Math.floor(h / 2) + (rng() < 0.5 ? 0 : -(h % 2 === 0 ? 1 : 0));
    const tank = ty * w + tx;

    inTree[tank] = true;
    let frontier = [];
    const addEdges = (c) => {
      const x = c % w, y = (c / w) | 0;
      for (const d of DIRS) {
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nc = ny * w + nx;
        if (!inTree[nc]) frontier.push([c, d, nc]);
      }
    };
    addEdges(tank);

    let count = 1;
    while (count < n) {
      frontier = frontier.filter(([c, , nc]) => !inTree[nc] && deg[c] < (c === tank ? opts.tankMaxDeg : 3));
      if (frontier.length === 0) return null; // degree cap boxed us in; caller retries
      // Bias: prefer extending from low-degree nodes for longer, windier runs,
      // or from any node for bushier trees. `branchiness` blends between them.
      let pick;
      if (rng() < opts.branchiness) {
        pick = frontier[(rng() * frontier.length) | 0];
      } else {
        const minDeg = Math.min(...frontier.map(([c]) => deg[c]));
        const low = frontier.filter(([c]) => deg[c] === minDeg);
        pick = low[(rng() * low.length) | 0];
      }
      const [c, d, nc] = pick;
      masks[c] |= d;
      masks[nc] |= OPP[d];
      deg[c]++; deg[nc]++;
      inTree[nc] = true;
      count++;
      addEdges(nc);
    }
    return { masks, tank };
  }

  // ---------- Solver ----------
  /**
   * Enumerates valid solutions (every tile connected, no open ends, no loops).
   * `fixed` is a set of cell indices whose orientation must not change (the tank).
   * Returns up to `limit` solutions as arrays of masks.
   */
  function solve(w, h, masks, fixed, limit) {
    const n = w * h;
    const solutions = [];
    const neighbor = (c, d) => {
      const x = c % w + DX[d], y = ((c / w) | 0) + DY[d];
      return (x < 0 || y < 0 || x >= w || y >= h) ? -1 : y * w + x;
    };
    const nb = [];
    for (let c = 0; c < n; c++) nb.push(DIRS.map((d) => neighbor(c, d)));
    const isEnd = masks.map((m) => popcount(m) === 1);

    const initial = masks.map((m, c) => (fixed.has(c) ? [m] : orientations(m)));

    // Domain filtering against borders and neighbors until nothing changes.
    function propagate(dom) {
      let changed = true;
      while (changed) {
        changed = false;
        for (let c = 0; c < n; c++) {
          const before = dom[c].length;
          dom[c] = dom[c].filter((m) => {
            for (let i = 0; i < 4; i++) {
              const d = DIRS[i];
              const o = nb[c][i];
              const open = (m & d) !== 0;
              if (o < 0) { if (open) return false; continue; }
              // Two dead ends joined together would form an isolated pair.
              if (open && isEnd[c] && isEnd[o] && n > 2) return false;
              const od = OPP[d];
              if (!dom[o].some((om) => ((om & od) !== 0) === open)) return false;
            }
            return true;
          });
          if (dom[c].length === 0) return false;
          if (dom[c].length !== before) changed = true;
        }
      }
      return true;
    }

    // Prune if definite edges already form a loop, or possible edges can't connect everything.
    function feasible(dom) {
      const parent = Array.from({ length: n }, (_, i) => i);
      const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
      for (let c = 0; c < n; c++) {
        for (const i of [1, 2]) { // E and S, so each edge is checked once
          const o = nb[c][i];
          if (o < 0) continue;
          const d = DIRS[i];
          if (dom[c].every((m) => m & d)) {
            const a = find(c), b = find(o);
            if (a === b) return false; // cycle
            parent[a] = b;
          }
        }
      }
      // Connectivity through edges that could still be open.
      const seen = new Uint8Array(n);
      const stack = [0];
      seen[0] = 1;
      let reached = 1;
      while (stack.length) {
        const c = stack.pop();
        for (let i = 0; i < 4; i++) {
          const o = nb[c][i];
          if (o < 0 || seen[o]) continue;
          if (dom[c].some((m) => m & DIRS[i])) { seen[o] = 1; reached++; stack.push(o); }
        }
      }
      return reached === n;
    }

    function search(dom) {
      if (solutions.length >= limit) return;
      if (!propagate(dom) || !feasible(dom)) return;
      let best = -1, bestLen = 99;
      for (let c = 0; c < n; c++) {
        const L = dom[c].length;
        if (L > 1 && L < bestLen) { best = c; bestLen = L; if (L === 2) break; }
      }
      if (best < 0) { solutions.push(dom.map((d) => d[0])); return; }
      for (const m of dom[best]) {
        const next = dom.slice();
        next[best] = [m];
        search(next);
        if (solutions.length >= limit) return;
      }
    }

    search(initial);
    return solutions;
  }

  // ---------- Daily config ----------
  // Three puzzles a day. `scramble` is the chance each tile starts turned the wrong way,
  // so Easy leaves about half the board already correct.
  const LEVELS = {
    easy:   { id: 'easy',   label: 'Easy',   w: 5, h: 5, branchiness: 0.8,  scramble: 0.5 },
    medium: { id: 'medium', label: 'Medium', w: 6, h: 7, branchiness: 0.6,  scramble: 0.75 },
    hard:   { id: 'hard',   label: 'Hard',   w: 8, h: 8, branchiness: 0.45, scramble: 0.95 },
  };
  const LEVEL_ORDER = ['easy', 'medium', 'hard'];

  /**
   * Builds the puzzle for a seed string. Deterministic: the same seed always yields
   * the same board, so every player gets an identical daily puzzle with no server.
   */
  function buildPuzzle(seedStr, cfg) {
    const rng = mulberry32(hashString('pipeflow:' + seedStr));
    const { w, h } = cfg;
    const opts = { branchiness: cfg.branchiness, tankMaxDeg: 3 };

    let best = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const tree = generateTree(w, h, rng, opts);
      if (!tree) continue;
      const sols = solve(w, h, tree.masks, new Set([tree.tank]), 2);
      if (sols.length === 1) { best = tree; break; }
      if (!best) best = tree;
    }
    const { masks: solution, tank } = best;

    // Turn each tile (except the tank) to a wrong orientation with probability `scramble`.
    const scrambleOnce = () => solution.map((m, c) => {
      if (c === tank || rng() >= cfg.scramble) return m;
      const wrong = orientations(m).filter((o) => o !== m);
      return wrong.length ? wrong[(rng() * wrong.length) | 0] : m;
    });
    let start = scrambleOnce();
    for (let i = 0; i < 20 && start.every((m, c) => m === solution[c]); i++) start = scrambleOnce();

    // Par is the fewest taps to reach ANY valid solution (normally there is just one).
    const sols = solve(w, h, solution, new Set([tank]), 50);
    let par = Infinity;
    for (const sol of sols) {
      let t = 0;
      for (let c = 0; c < start.length; c++) t += tapsBetween(start[c], sol[c]);
      par = Math.min(par, t);
    }

    return { w, h, tank, start, solution: sols.length === 1 ? sols[0] : solution, par, unique: sols.length === 1 };
  }

  /** Local-date key like "2026-11-21". */
  function dateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function puzzleNumber(date, launchKey) {
    const [ly, lm, ld] = launchKey.split('-').map(Number);
    const launch = new Date(ly, lm - 1, ld);
    const today = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((today - launch) / 86400000) + 1;
  }

  function dailyPuzzle(date, launchKey, level) {
    const key = dateKey(date);
    const cfg = LEVELS[level];
    return { key, level, label: cfg.label, number: puzzleNumber(date, launchKey), ...buildPuzzle(`${key}:${level}`, cfg) };
  }

  /**
   * Water flow from the tank through matching connections.
   * Returns { depth: Int16Array (-1 = dry), leaks: array of per-cell leak masks, solved }.
   */
  function flow(w, h, masks, tank) {
    const n = w * h;
    const depth = new Int16Array(n).fill(-1);
    const leaks = new Array(n).fill(0);
    depth[tank] = 0;
    const queue = [tank];
    let reached = 1, anyLeak = false;
    while (queue.length) {
      const c = queue.shift();
      const x = c % w, y = (c / w) | 0;
      for (const d of DIRS) {
        if (!(masks[c] & d)) continue;
        const nx = x + DX[d], ny = y + DY[d];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) { leaks[c] |= d; anyLeak = true; continue; }
        const o = ny * w + nx;
        if (!(masks[o] & OPP[d])) { leaks[c] |= d; anyLeak = true; continue; }
        if (depth[o] < 0) { depth[o] = depth[c] + 1; reached++; queue.push(o); }
      }
    }
    return { depth, leaks, solved: reached === n && !anyLeak };
  }

  const api = {
    N, E, S, W, DIRS, OPP, rot, rotN, popcount, orientations, tapsBetween, kindOf,
    hashString, mulberry32, generateTree, solve, buildPuzzle, dailyPuzzle, puzzleNumber, dateKey, flow, LEVELS, LEVEL_ORDER,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Puzzle = api;
})(typeof window !== 'undefined' ? window : globalThis);
