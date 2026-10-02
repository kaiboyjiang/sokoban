(() => {
  const STORAGE_KEY = "sokoban-progress-v1";
  const DIRS = {
    up: { dx: 0, dy: -1 },
    down: { dx: 0, dy: 1 },
    left: { dx: -1, dy: 0 },
    right: { dx: 1, dy: 0 },
  };
  const KEYS = {
    ArrowUp: "up", KeyW: "up",
    ArrowDown: "down", KeyS: "down",
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
  };

  const canvas = document.getElementById("board");
  const ctx = canvas.getContext("2d");
  const boardWrap = document.getElementById("board-wrap");
  const levelSelect = document.getElementById("level-select");
  const prevBtn = document.getElementById("prev");
  const nextBtn = document.getElementById("next");
  const undoBtn = document.getElementById("undo");
  const restartBtn = document.getElementById("restart");
  const themeToggle = document.getElementById("theme-toggle");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayText = document.getElementById("overlay-text");
  const overlayNext = document.getElementById("overlay-next");
  const el = {
    moves: document.getElementById("moves"),
    pushes: document.getElementById("pushes"),
    boxes: document.getElementById("boxes"),
    best: document.getElementById("best"),
    par: document.getElementById("par"),
  };

  let colors = {};
  let progress = loadProgress();
  let levelIndex = Math.min(progress.current || 0, LEVELS.length - 1);
  let state = null;
  let tile = 32;
  let facing = "down";

  function loadProgress() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { current: 0, best: {} };
    } catch {
      return { current: 0, best: {} };
    }
  }

  function saveProgress() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Storage unavailable (e.g. private mode); progress just won't persist.
    }
  }

  function loadTheme() {
    const css = getComputedStyle(document.documentElement);
    const names = [
      "floor", "floor-alt", "wall", "wall-edge", "goal", "box", "box-edge",
      "box-done", "box-done-edge", "player", "player-edge", "bg",
    ];
    colors = Object.fromEntries(names.map((n) => [n, css.getPropertyValue(`--${n}`).trim()]));
    const isDark = document.documentElement.dataset.theme !== "light";
    themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      // Storage unavailable; theme just won't persist.
    }
    loadTheme();
    draw();
  }

  const key = (x, y) => `${x},${y}`;

  function parseLevel(level) {
    const rows = level.map;
    const height = rows.length;
    const width = Math.max(...rows.map((r) => r.length));
    const walls = new Set();
    const goals = new Set();
    const boxes = new Set();
    let player = null;

    rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch === "#") walls.add(key(x, y));
        if (ch === "." || ch === "*" || ch === "+") goals.add(key(x, y));
        if (ch === "$" || ch === "*") boxes.add(key(x, y));
        if (ch === "@" || ch === "+") player = { x, y };
      });
    });

    // Interior floor = everything reachable from the player without crossing walls.
    const floor = new Set();
    const stack = [[player.x, player.y]];
    while (stack.length) {
      const [x, y] = stack.pop();
      const k = key(x, y);
      if (floor.has(k) || walls.has(k) || x < 0 || y < 0 || x >= width || y >= height) continue;
      floor.add(k);
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    return { width, height, walls, goals, floor, boxes, player, moves: 0, pushes: 0, history: [], won: false };
  }

  function startLevel(index) {
    levelIndex = (index + LEVELS.length) % LEVELS.length;
    state = parseLevel(LEVELS[levelIndex]);
    facing = "down";
    progress.current = levelIndex;
    saveProgress();
    levelSelect.value = String(levelIndex);
    hideOverlay();
    resize();
    update();
  }

  function move(dir) {
    if (!state || state.won) return;
    const { dx, dy } = DIRS[dir];
    const { x, y } = state.player;
    const nx = x + dx;
    const ny = y + dy;
    const nk = key(nx, ny);
    facing = dir;

    if (state.walls.has(nk)) { draw(); return; }

    let pushed = false;
    if (state.boxes.has(nk)) {
      const bk = key(nx + dx, ny + dy);
      if (state.walls.has(bk) || state.boxes.has(bk)) { draw(); return; }
      state.boxes.delete(nk);
      state.boxes.add(bk);
      pushed = true;
    }

    state.history.push({ player: { x, y }, dir, pushed });
    state.player = { x: nx, y: ny };
    state.moves++;
    if (pushed) state.pushes++;

    if (pushed && isSolved()) win();
    update();
  }

  function undo() {
    if (!state || state.won || !state.history.length) return;
    const last = state.history.pop();
    const { dx, dy } = DIRS[last.dir];
    if (last.pushed) {
      const boxNow = key(state.player.x + dx, state.player.y + dy);
      state.boxes.delete(boxNow);
      state.boxes.add(key(state.player.x, state.player.y));
      state.pushes--;
    }
    state.player = last.player;
    state.moves--;
    facing = last.dir;
    update();
  }

  function isSolved() {
    for (const b of state.boxes) if (!state.goals.has(b)) return false;
    return true;
  }

  function boxesOnGoals() {
    let n = 0;
    for (const b of state.boxes) if (state.goals.has(b)) n++;
    return n;
  }

  function win() {
    state.won = true;
    const prev = progress.best[levelIndex];
    const isBest = prev === undefined || state.moves < prev;
    if (isBest) progress.best[levelIndex] = state.moves;
    saveProgress();
    populateSelect();

    const par = LEVELS[levelIndex].par;
    const last = levelIndex === LEVELS.length - 1;
    overlayTitle.textContent = last ? "All levels complete!" : "Level complete!";
    let text = `${state.moves} moves, ${state.pushes} pushes.`;
    if (par && state.moves <= par) text += " Perfect — you matched par!";
    else if (isBest && prev !== undefined) text += " New best!";
    overlayText.textContent = text;
    overlayNext.textContent = last ? "Back to level 1" : "Next level";
    overlay.classList.remove("hidden");
    overlayNext.focus();
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function update() {
    el.moves.textContent = state.moves;
    el.pushes.textContent = state.pushes;
    el.boxes.textContent = `${boxesOnGoals()}/${state.goals.size}`;
    const best = progress.best[levelIndex];
    el.best.textContent = best === undefined ? "–" : best;
    el.par.textContent = LEVELS[levelIndex].par ?? "–";
    undoBtn.disabled = state.won || state.history.length === 0;
    draw();
  }

  function populateSelect() {
    levelSelect.innerHTML = "";
    LEVELS.forEach((level, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      const done = progress.best[i] !== undefined ? " ✓" : "";
      opt.textContent = `${i + 1}. ${level.name}${done}`;
      levelSelect.appendChild(opt);
    });
    levelSelect.value = String(levelIndex);
  }

  function resize() {
    if (!state) return;
    const rect = boardWrap.getBoundingClientRect();
    const maxTile = 56;
    tile = Math.max(12, Math.floor(Math.min(rect.width / state.width, rect.height / state.height, maxTile)));
    const dpr = window.devicePixelRatio || 1;
    const w = tile * state.width;
    const h = tile * state.height;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawWall(px, py) {
    ctx.fillStyle = colors["wall-edge"];
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = colors.wall;
    const inset = Math.max(1, tile * 0.06);
    roundRect(px + inset, py + inset, tile - inset * 2, tile - inset * 2, tile * 0.12);
    ctx.fill();
  }

  function drawGoal(px, py) {
    const c = tile / 2;
    ctx.strokeStyle = colors.goal;
    ctx.lineWidth = Math.max(1.5, tile * 0.07);
    ctx.beginPath();
    ctx.arc(px + c, py + c, tile * 0.18, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawBox(px, py, done) {
    const inset = tile * 0.12;
    const s = tile - inset * 2;
    ctx.fillStyle = done ? colors["box-done-edge"] : colors["box-edge"];
    roundRect(px + inset, py + inset, s, s, tile * 0.1);
    ctx.fill();
    const inner = tile * 0.08;
    ctx.fillStyle = done ? colors["box-done"] : colors.box;
    roundRect(px + inset + inner, py + inset + inner, s - inner * 2, s - inner * 2, tile * 0.06);
    ctx.fill();
    ctx.strokeStyle = done ? colors["box-done-edge"] : colors["box-edge"];
    ctx.lineWidth = Math.max(1, tile * 0.05);
    ctx.beginPath();
    ctx.moveTo(px + inset + inner, py + inset + inner);
    ctx.lineTo(px + tile - inset - inner, py + tile - inset - inner);
    ctx.moveTo(px + tile - inset - inner, py + inset + inner);
    ctx.lineTo(px + inset + inner, py + tile - inset - inner);
    ctx.stroke();
  }

  function drawPlayer(px, py) {
    const c = tile / 2;
    const r = tile * 0.32;
    ctx.fillStyle = colors["player-edge"];
    ctx.beginPath();
    ctx.arc(px + c, py + c, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.player;
    ctx.beginPath();
    ctx.arc(px + c, py + c, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
    // Eyes look in the direction of the last move.
    const { dx, dy } = DIRS[facing];
    const eyeOffset = r * 0.35;
    const look = r * 0.25;
    ctx.fillStyle = colors.bg;
    for (const side of [-1, 1]) {
      const ex = px + c + dx * look + (dy !== 0 ? side * eyeOffset : 0);
      const ey = py + c + dy * look + (dx !== 0 ? side * eyeOffset : -eyeOffset * 0.3);
      ctx.beginPath();
      ctx.arc(ex, ey, Math.max(1.5, r * 0.12), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function draw() {
    if (!state) return;
    ctx.clearRect(0, 0, tile * state.width, tile * state.height);
    for (let y = 0; y < state.height; y++) {
      for (let x = 0; x < state.width; x++) {
        const k = key(x, y);
        const px = x * tile;
        const py = y * tile;
        if (state.walls.has(k)) {
          drawWall(px, py);
        } else if (state.floor.has(k)) {
          ctx.fillStyle = (x + y) % 2 ? colors["floor-alt"] : colors.floor;
          ctx.fillRect(px, py, tile, tile);
          if (state.goals.has(k)) drawGoal(px, py);
        }
      }
    }
    for (const b of state.boxes) {
      const [x, y] = b.split(",").map(Number);
      drawBox(x * tile, y * tile, state.goals.has(b));
    }
    drawPlayer(state.player.x * tile, state.player.y * tile);
  }

  function nextLevel() { startLevel(levelIndex + 1); }

  document.addEventListener("keydown", (e) => {
    if (e.target === levelSelect) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (KEYS[e.code]) {
      e.preventDefault();
      move(KEYS[e.code]);
    } else if (e.code === "KeyZ" || e.code === "Backspace" || e.code === "KeyU") {
      e.preventDefault();
      undo();
    } else if (e.code === "KeyT") {
      toggleTheme();
    } else if (e.code === "KeyR") {
      startLevel(levelIndex);
    } else if (e.code === "BracketRight" || e.code === "KeyN") {
      nextLevel();
    } else if (e.code === "BracketLeft" || e.code === "KeyP") {
      startLevel(levelIndex - 1);
    } else if ((e.code === "Enter" || e.code === "Space") && state.won) {
      e.preventDefault();
      nextLevel();
    }
  });

  let touchStart = null;
  canvas.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    touchStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  canvas.addEventListener("touchend", (e) => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = t.clientY - touchStart.y;
    touchStart = null;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  }, { passive: true });

  document.querySelectorAll(".dpad button").forEach((btn) => {
    btn.addEventListener("click", () => move(btn.dataset.dir));
  });

  levelSelect.addEventListener("change", () => {
    startLevel(Number(levelSelect.value));
    levelSelect.blur();
  });
  prevBtn.addEventListener("click", () => startLevel(levelIndex - 1));
  nextBtn.addEventListener("click", nextLevel);
  undoBtn.addEventListener("click", undo);
  themeToggle.addEventListener("click", toggleTheme);
  restartBtn.addEventListener("click", () => startLevel(levelIndex));
  overlayNext.addEventListener("click", nextLevel);
  window.addEventListener("resize", resize);

  // Buttons keep focus after clicks; blur them so Space/Enter don't re-trigger.
  document.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("mouseup", () => btn.blur());
  });

  loadTheme();
  populateSelect();
  startLevel(levelIndex);
})();
