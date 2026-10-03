// Random Sokoban level generator. Runs as a Web Worker (postMessage {id, n, minPushes}) or,
// where workers are unavailable (e.g. file:// pages), as the global generateLevel().
//
// A random room gets its boxes placed on the goals, then a breadth-first search of
// reverse moves (pulls) runs from the solved position. A state first reached at
// depth d needs exactly d pushes to solve, so taking a state at depth target(n)
// gives a solvable puzzle whose difficulty grows with n.

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Higher push counts are still targeted but only reached when a lucky room allows it.
const MAX_GUARANTEED_PUSHES = 30;

function difficulty(n) {
  return {
    boxes: n <= 2 ? 2 : n <= 5 ? 3 : 4,
    wMin: 7,
    wMax: 7 + Math.min(Math.floor(n / 3), 3),
    hMin: 7,
    hMax: 7 + Math.min(Math.floor(n / 4), 2),
    targetPushes: Math.min(6 + 2 * n, 40),
    stateLimit: Math.min(80000 + 20000 * n, 300000),
  };
}

function randomRoom(rng, w, h) {
  const floor = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) floor[y * w + x] = 1;
  const shapes = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [0, 1]], [[0, 0], [1, 0], [1, 1]]];
  const lo = Math.floor((w * h) / 14);
  const hi = Math.floor((w * h) / 8);
  const clumps = lo + Math.floor(rng() * (hi - lo + 1));
  for (let i = 0; i < clumps; i++) {
    const x = 1 + Math.floor(rng() * (w - 2));
    const y = 1 + Math.floor(rng() * (h - 2));
    for (const [dx, dy] of shapes[Math.floor(rng() * shapes.length)]) {
      if (x + dx < w && y + dy < h) floor[(y + dy) * w + x + dx] = 0;
    }
  }
  const dirs = [1, -1, w, -w];
  // Fill dead ends.
  let changed = true;
  while (changed) {
    changed = false;
    for (let c = 0; c < w * h; c++) {
      if (!floor[c]) continue;
      let n = 0;
      for (const d of dirs) if (floor[c + d]) n++;
      if (n <= 1) { floor[c] = 0; changed = true; }
    }
  }
  const cells = [];
  for (let c = 0; c < w * h; c++) if (floor[c]) cells.push(c);
  if (!cells.length) return null;
  const seen = new Set([cells[0]]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop();
    for (const d of dirs) {
      const n = c + d;
      if (floor[n] && !seen.has(n)) { seen.add(n); stack.push(n); }
    }
  }
  return seen.size === cells.length ? { floor, cells } : null;
}

function reverseSearch(floor, w, goals, target, limit, deadline) {
  const dirs = [1, -1, w, -w];
  const mark = new Uint32Array(floor.length);
  let stamp = 0;

  function region(p, boxes) {
    stamp++;
    const out = [p];
    mark[p] = stamp;
    for (let i = 0; i < out.length; i++) {
      for (const d of dirs) {
        const n = out[i] + d;
        if (floor[n] && mark[n] !== stamp && !boxes.has(n)) { mark[n] = stamp; out.push(n); }
      }
    }
    return out;
  }
  const keyOf = (reach, boxes) => `${Math.min(...reach)}|${[...boxes].sort((a, b) => a - b).join(",")}`;

  const boxes0 = new Set(goals);
  const seen = new Set();
  let frontier = [];
  for (let p = 0; p < floor.length; p++) {
    if (!floor[p] || boxes0.has(p)) continue;
    const reach = region(p, boxes0);
    const k = keyOf(reach, boxes0);
    if (!seen.has(k)) { seen.add(k); frontier.push({ reach, boxes: boxes0 }); }
  }

  let depth = 0;
  while (depth < target && seen.size < limit && Date.now() <= deadline) {
    const next = [];
    for (const { reach, boxes } of frontier) {
      for (const p of reach) {
        for (const d of dirs) {
          const b = p + d;
          const q = p - d;
          if (!boxes.has(b) || !floor[q] || boxes.has(q)) continue;
          const nb = new Set(boxes);
          nb.delete(b);
          nb.add(p);
          const r = region(q, nb);
          const k = keyOf(r, nb);
          if (!seen.has(k)) { seen.add(k); next.push({ reach: r, boxes: nb }); }
        }
      }
      if (seen.size >= limit || Date.now() > deadline) break;
    }
    if (!next.length) break;
    frontier = next;
    depth++;
  }
  return { depth, states: frontier };
}

function toRows(floor, w, h, goals, boxes, player) {
  const isFloor = (x, y) => x >= 0 && y >= 0 && x < w && y < h && floor[y * w + x];
  const rows = [];
  for (let y = 0; y < h; y++) {
    let row = "";
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (floor[i]) {
        const g = goals.has(i);
        const b = boxes.has(i);
        if (b) row += g ? "*" : "$";
        else if (i === player) row += g ? "+" : "@";
        else row += g ? "." : " ";
      } else {
        let nearFloor = false;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isFloor(x + dx, y + dy)) nearFloor = true;
        row += nearFloor ? "#" : " ";
      }
    }
    rows.push(row.trimEnd());
  }
  while (rows.length && !rows[0].trim()) rows.shift();
  while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
  const pad = Math.min(...rows.filter((r) => r.trim()).map((r) => r.length - r.trimStart().length));
  return rows.map((r) => r.slice(pad));
}

// Generate puzzle number n (1-based). Tries rooms until one reaches the target push
// count; after timeBudgetMs it settles for the deepest so far if that needs at least
// minPushes, and gives up entirely at 4x the budget.
function generateLevel(n, seed = Math.floor(Math.random() * 2 ** 32), minPushes = 0, timeBudgetMs = 3000) {
  const rng = mulberry32(seed);
  const p = difficulty(n);
  const randInt = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  const started = Date.now();
  let best = null;

  minPushes = Math.min(minPushes, p.targetPushes, MAX_GUARANTEED_PUSHES);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const elapsed = Date.now() - started;
    if (best && (elapsed > 4 * timeBudgetMs || (elapsed > timeBudgetMs && best.pushes >= minPushes))) break;
    const w = randInt(p.wMin, p.wMax);
    const h = randInt(p.hMin, p.hMax);
    const room = randomRoom(rng, w, h);
    if (!room || room.cells.length < p.boxes * 4 + 6) continue;

    const pool = room.cells.slice();
    const goals = new Set();
    while (goals.size < p.boxes) goals.add(pool.splice(Math.floor(rng() * pool.length), 1)[0]);

    const deadline = Math.max(started + timeBudgetMs, Date.now() + timeBudgetMs / 2);
    const { depth, states } = reverseSearch(room.floor, w, goals, p.targetPushes, p.stateLimit, deadline);
    if (depth < 2 || (best && depth <= best.pushes)) continue;

    const clean = states.filter((s) => ![...s.boxes].some((b) => goals.has(b)));
    const pick = (clean.length ? clean : states)[Math.floor(rng() * (clean.length || states.length))];
    const player = pick.reach[Math.floor(rng() * pick.reach.length)];
    best = { n, pushes: depth, map: toRows(room.floor, w, h, goals, pick.boxes, player) };
    if (depth >= p.targetPushes) break;
  }
  return best;
}

// Keeps trying new seeds until a puzzle comes out.
function generateLevelRetrying(n, minPushes) {
  for (;;) {
    const level = generateLevel(n, undefined, minPushes);
    if (level) return level;
  }
}

if (typeof window === "undefined" && typeof self !== "undefined") {
  self.onmessage = (e) => self.postMessage({ id: e.data.id, level: generateLevelRetrying(e.data.n, e.data.minPushes) });
}
