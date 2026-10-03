#!/usr/bin/env python3
"""Sokoban level generator and solver.

  python3 tools/levelgen.py check            # verify every level in levels.js and print its par
  python3 tools/levelgen.py generate -n 400  # generate candidate levels as JSON lines

Generation builds a random room, puts the boxes on the goals, then runs a
breadth-first search of reverse moves (pulls) from the solved position. The
state that needs the most pushes becomes the puzzle, so every generated level
is solvable by construction. `solve()` then finds the minimum move count (par).
"""
import argparse
import heapq
import json
import random
import re
import sys
from collections import deque
from multiprocessing import Pool
from pathlib import Path

LEVELS_JS = Path(__file__).resolve().parent.parent / "levels.js"


class Board:
    def __init__(self, rows):
        self.h = len(rows)
        self.w = max(len(r) for r in rows)
        self.walls, self.goals, boxes, self.player = set(), set(), set(), None
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                i = y * self.w + x
                if ch == "#":
                    self.walls.add(i)
                if ch in ".*+":
                    self.goals.add(i)
                if ch in "$*":
                    boxes.add(i)
                if ch in "@+":
                    self.player = i
        self.boxes = frozenset(boxes)
        self.dirs = (1, -1, self.w, -self.w)
        self.floor = self._flood(self.player, frozenset())
        self.live = self._live_cells()

    def _flood(self, start, blocked):
        seen, stack = {start}, [start]
        while stack:
            c = stack.pop()
            for d in self.dirs:
                n = c + d
                if n not in seen and n not in self.walls and n not in blocked and 0 <= n < self.w * self.h:
                    seen.add(n)
                    stack.append(n)
        return seen

    def _live_cells(self):
        # Cells from which a lone box can still reach some goal.
        live, stack = set(self.goals), list(self.goals)
        while stack:
            c = stack.pop()
            for d in self.dirs:
                b, p = c + d, c + 2 * d
                if b in self.floor and p in self.floor and b not in live:
                    live.add(b)
                    stack.append(b)
        return live


def solve(board, limit=2_000_000):
    """Return (min moves, pushes in that solution, states explored) or None."""
    goals = frozenset(board.goals)
    start = (board.player, board.boxes)
    best = {start: 0}
    pushes = {start: 0}
    heap = [(0, 0, board.player, board.boxes)]
    tie = 0
    while heap:
        cost, _, pos, boxes = heapq.heappop(heap)
        if best.get((pos, boxes), cost) < cost:
            continue
        if boxes == goals:
            return cost, pushes[(pos, boxes)], len(best)
        dist = {pos: 0}
        q = deque([pos])
        while q:
            c = q.popleft()
            for d in board.dirs:
                n = c + d
                if n in board.floor and n not in boxes and n not in dist:
                    dist[n] = dist[c] + 1
                    q.append(n)
        for b in boxes:
            for d in board.dirs:
                s, t = b - d, b + d
                if s not in dist or t not in board.live or t in boxes:
                    continue
                nb = (boxes - {b}) | {t}
                ns = (b, nb)
                nc = cost + dist[s] + 1
                if nc < best.get(ns, 1 << 30):
                    best[ns] = nc
                    pushes[ns] = pushes[(pos, boxes)] + 1
                    tie += 1
                    heapq.heappush(heap, (nc, tie, b, nb))
        if len(best) > limit:
            return None
    return None


def random_room(rng, w, h):
    """Rectangle of floor with random wall clumps; returns set of floor cells or None."""
    floor = {(x, y) for x in range(1, w - 1) for y in range(1, h - 1)}
    clumps = rng.randint((w * h) // 14, (w * h) // 8)
    shapes = [[(0, 0)], [(0, 0), (1, 0)], [(0, 0), (0, 1)], [(0, 0), (1, 0), (0, 1)], [(0, 0), (1, 0), (1, 1)]]
    for _ in range(clumps):
        x, y = rng.randint(1, w - 2), rng.randint(1, h - 2)
        for dx, dy in rng.choice(shapes):
            floor.discard((x + dx, y + dy))
    # Fill dead ends and unreachable pockets.
    changed = True
    while changed:
        changed = False
        for c in list(floor):
            n = sum((c[0] + dx, c[1] + dy) in floor for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if n <= 1:
                floor.discard(c)
                changed = True
    if not floor:
        return None
    start = next(iter(floor))
    seen, stack = {start}, [start]
    while stack:
        cx, cy = stack.pop()
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (cx + dx, cy + dy)
            if n in floor and n not in seen:
                seen.add(n)
                stack.append(n)
    if len(seen) < len(floor):
        return None
    return floor


def reverse_search(floor, w, goals, limit):
    """BFS over pulls from the solved position. Returns (pushes, player, boxes) of the deepest state."""
    dirs = (1, -1, w, -w)

    def region(p, boxes):
        seen, stack = {p}, [p]
        while stack:
            c = stack.pop()
            for d in dirs:
                n = c + d
                if n in floor and n not in boxes and n not in seen:
                    seen.add(n)
                    stack.append(n)
        return seen

    boxes0 = frozenset(goals)
    frontier, seen = [], set()
    for p in floor - boxes0:
        r = region(p, boxes0)
        key = (min(r), boxes0)
        if key not in seen:
            seen.add(key)
            frontier.append((r, boxes0))
    depth, deepest = 0, None
    while frontier:
        deepest = (depth, frontier)
        nxt = []
        for reach, boxes in frontier:
            for p in reach:
                for d in dirs:
                    b, q = p + d, p - d
                    if b in boxes and q in floor and q not in boxes:
                        nb = (boxes - {b}) | {p}
                        r = region(q, nb)
                        key = (min(r), nb)
                        if key not in seen:
                            seen.add(key)
                            nxt.append((r, nb))
            if len(seen) > limit:
                break
        if len(seen) > limit:
            break
        frontier = nxt
        depth += 1
    return deepest


def to_rows(floor, w, h, goals, boxes, player):
    rows = []
    for y in range(h):
        row = ""
        for x in range(w):
            i = y * w + x
            if i in floor:
                g, b = i in goals, i in boxes
                row += "*" if g and b else "$" if b else ("+" if g else "@") if i == player else "." if g else " "
            elif any((x + dx, y + dy) in {(c % w, c // w) for c in floor}
                     for dx in (-1, 0, 1) for dy in (-1, 0, 1)):
                row += "#"
            else:
                row += " "
        rows.append(row.rstrip())
    while rows and not rows[0].strip():
        rows.pop(0)
    while rows and not rows[-1].strip():
        rows.pop()
    pad = min(len(r) - len(r.lstrip()) for r in rows if r.strip())
    return [r[pad:] for r in rows]


def generate_one(seed):
    rng = random.Random(seed)
    w, h = rng.randint(7, 11), rng.randint(7, 10)
    cells = random_room(rng, w, h)
    if not cells or len(cells) < 18:
        return None
    floor = {y * w + x for x, y in cells}
    nboxes = rng.choice([3, 3, 4, 4, 4, 5, 5, 6])
    if len(floor) < nboxes * 4 + 6:
        return None
    goals = set(rng.sample(sorted(floor), nboxes))
    deepest = reverse_search(floor, w, goals, limit=400_000)
    if not deepest or deepest[0] < 8:
        return None
    _, states = deepest
    reach, boxes = rng.choice(states)
    if any(b in goals for b in boxes):
        # Prefer a deepest state where no box starts on its goal.
        clean = [s for s in states if not (s[1] & goals)]
        if clean:
            reach, boxes = rng.choice(clean)
    player = rng.choice(sorted(reach))
    rows = to_rows(floor, w, h, goals, boxes, player)
    result = solve(Board(rows))
    if not result:
        return None
    moves, pushes, explored = result
    return {"seed": seed, "boxes": nboxes, "moves": moves, "pushes": pushes, "explored": explored, "map": rows}


def load_levels():
    src = LEVELS_JS.read_text()
    return json.loads(re.search(r"const LEVELS = (\[.*?\]);", src, re.S).group(1))


def check():
    ok = True
    for i, level in enumerate(load_levels(), 1):
        board = Board(level["map"])
        if len(board.goals) != len(board.boxes) or board.player is None:
            print(f"{i:3} {level['name']}: bad box/goal/player counts")
            ok = False
            continue
        result = solve(board)
        if result is None:
            print(f"{i:3} {level['name']}: UNSOLVED")
            ok = False
            continue
        moves = result[0]
        flag = "" if moves == level.get("par") else f"  <-- par in levels.js is {level.get('par')}"
        print(f"{i:3} {level['name']:<16} boxes={len(board.boxes)} moves={moves} pushes={result[1]}{flag}")
        ok = ok and not flag
    return ok


def main():
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("check")
    g = sub.add_parser("generate")
    g.add_argument("-n", type=int, default=200, help="number of seeds to try")
    g.add_argument("--seed", type=int, default=1)
    args = ap.parse_args()
    if args.cmd == "check":
        sys.exit(0 if check() else 1)
    with Pool() as pool:
        for result in pool.imap_unordered(generate_one, range(args.seed, args.seed + args.n)):
            if result:
                print(json.dumps(result), flush=True)


if __name__ == "__main__":
    main()
