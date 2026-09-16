/**
 * dungeon.js
 * Procedural dungeon generation with guaranteed solvability.
 *
 * Algorithm:
 *   1. Fill the grid with walls.
 *   2. Carve a handful of non-overlapping rectangular rooms.
 *   3. Connect consecutive room centres with L-shaped corridors, plus a couple
 *      of extra links so the layout has loops instead of a single dead-end tree.
 *   4. Pick a random room centre as the player spawn.
 *   5. Run BFS from the spawn. Anything unreachable is simply ignored.
 *   6. Choose an exit tile whose BFS distance is inside a beatable window.
 *   7. If any step fails, throw the layout away and try again.
 *
 * Because the exit is only ever chosen from tiles proven reachable by BFS, a
 * valid path from spawn to exit is guaranteed for every returned dungeon.
 */

export const COLS = 20;
export const ROWS = 12;
export const TILE_SIZE = 40;

export const TILE_WALL = 0;
export const TILE_FLOOR = 1;

/** Minimum / maximum BFS (tile) distance allowed between spawn and exit. */
const MIN_EXIT_DISTANCE = 8;   // spec requires at least 5; 8 keeps level 1 fair
const MAX_EXIT_DISTANCE = 22;  // 22 tiles x 40px / 180px per second = 4.9s of running

const MIN_ROOMS = 3;
const MAX_ROOMS = 6;
const MIN_FLOOR_TILES = 45;
const MAX_GENERATION_ATTEMPTS = 60;

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// ------------------------------------------------------------------ helpers

function createGrid(fill) {
  const grid = new Array(ROWS);
  for (let r = 0; r < ROWS; r++) grid[r] = new Array(COLS).fill(fill);
  return grid;
}

function inBounds(col, row) {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/** Fisher-Yates shuffle, in place. */
export function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** World-space pixel centre of a tile. */
export function tileCenter(col, row) {
  return { x: col * TILE_SIZE + TILE_SIZE / 2, y: row * TILE_SIZE + TILE_SIZE / 2 };
}

// ------------------------------------------------------------------ carving

function carveRect(grid, col, row, w, h) {
  for (let r = row; r < row + h; r++) {
    for (let c = col; c < col + w; c++) {
      if (inBounds(c, r)) grid[r][c] = TILE_FLOOR;
    }
  }
}

function carveHorizontal(grid, fromCol, toCol, row) {
  const start = Math.min(fromCol, toCol);
  const end = Math.max(fromCol, toCol);
  for (let c = start; c <= end; c++) if (inBounds(c, row)) grid[row][c] = TILE_FLOOR;
}

function carveVertical(grid, fromRow, toRow, col) {
  const start = Math.min(fromRow, toRow);
  const end = Math.max(fromRow, toRow);
  for (let r = start; r <= end; r++) if (inBounds(col, r)) grid[r][col] = TILE_FLOOR;
}

/** L-shaped corridor between two points (random elbow order). */
function carveCorridor(grid, ax, ay, bx, by) {
  if (Math.random() < 0.5) {
    carveHorizontal(grid, ax, bx, ay);
    carveVertical(grid, ay, by, bx);
  } else {
    carveVertical(grid, ay, by, ax);
    carveHorizontal(grid, ax, bx, by);
  }
}

/** Place up to MAX_ROOMS non-overlapping rooms; returns the room list. */
function carveRooms(grid) {
  const rooms = [];
  const attempts = 24;

  for (let i = 0; i < attempts && rooms.length < MAX_ROOMS; i++) {
    const w = 3 + Math.floor(Math.random() * 4); // 3..6
    const h = 3 + Math.floor(Math.random() * 3); // 3..5
    const col = 1 + Math.floor(Math.random() * (COLS - w - 1));
    const row = 1 + Math.floor(Math.random() * (ROWS - h - 1));

    // One tile of padding between rooms keeps corridors readable.
    const overlaps = rooms.some((o) =>
      col < o.col + o.w + 1 && col + w + 1 > o.col &&
      row < o.row + o.h + 1 && row + h + 1 > o.row);
    if (overlaps) continue;

    const room = {
      col, row, w, h,
      cx: Math.floor(col + w / 2),
      cy: Math.floor(row + h / 2),
    };
    rooms.push(room);
    carveRect(grid, col, row, w, h);
  }
  return rooms;
}

// ------------------------------------------------------------------ search

/**
 * Breadth-first search over walkable tiles.
 * Returns { dist, prev } where dist is in tiles and -1 means unreachable.
 */
export function bfs(grid, startCol, startRow) {
  const dist = createGrid(-1);
  const prev = createGrid(null);
  if (!inBounds(startCol, startRow) || grid[startRow][startCol] === TILE_WALL) {
    return { dist, prev };
  }

  const queue = [[startCol, startRow]];
  dist[startRow][startCol] = 0;
  let head = 0;

  while (head < queue.length) {
    const [col, row] = queue[head++];
    for (const [dc, dr] of DIRS) {
      const nc = col + dc;
      const nr = row + dr;
      if (!inBounds(nc, nr)) continue;
      if (grid[nr][nc] === TILE_WALL) continue;
      if (dist[nr][nc] !== -1) continue;
      dist[nr][nc] = dist[row][col] + 1;
      prev[nr][nc] = [col, row];
      queue.push([nc, nr]);
    }
  }
  return { dist, prev };
}

/** Walk the BFS parent chain backwards from `target` to the search origin. */
function reconstructPath(prev, targetCol, targetRow) {
  const path = [];
  let cur = [targetCol, targetRow];
  while (cur) {
    path.push({ col: cur[0], row: cur[1] });
    cur = prev[cur[1]][cur[0]];
  }
  return path.reverse();
}

// ------------------------------------------------------------------ generator

function collectFloorTiles(grid) {
  const tiles = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (grid[r][c] === TILE_FLOOR) tiles.push({ col: c, row: r });
    }
  }
  return tiles;
}

/** One full attempt. Returns a dungeon object or null if the layout is unusable. */
function tryGenerate() {
  const grid = createGrid(TILE_WALL);
  const rooms = carveRooms(grid);
  if (rooms.length < MIN_ROOMS) return null;

  // Chain the rooms together: guarantees every room is reachable.
  for (let i = 1; i < rooms.length; i++) {
    carveCorridor(grid, rooms[i - 1].cx, rooms[i - 1].cy, rooms[i].cx, rooms[i].cy);
  }
  // A couple of extra links turn the tree into a graph with loops.
  const extraLinks = Math.min(2, rooms.length - 2);
  for (let i = 0; i < extraLinks; i++) {
    const a = rooms[Math.floor(Math.random() * rooms.length)];
    const b = rooms[Math.floor(Math.random() * rooms.length)];
    if (a !== b) carveCorridor(grid, a.cx, a.cy, b.cx, b.cy);
  }

  const floorTiles = collectFloorTiles(grid);
  if (floorTiles.length < MIN_FLOOR_TILES) return null;

  // Spawn in the middle of a room so the player never starts inside geometry.
  const spawnRoom = rooms[Math.floor(Math.random() * rooms.length)];
  const spawn = { col: spawnRoom.cx, row: spawnRoom.cy };
  if (grid[spawn.row][spawn.col] !== TILE_FLOOR) return null;

  const { dist, prev } = bfs(grid, spawn.col, spawn.row);
  const reachable = floorTiles.filter((t) => dist[t.row][t.col] >= 0);
  if (reachable.length < MIN_FLOOR_TILES) return null;

  // Prefer far-away exits, but keep the run beatable inside 10 seconds.
  let candidates = reachable.filter((t) =>
    dist[t.row][t.col] >= MIN_EXIT_DISTANCE && dist[t.row][t.col] <= MAX_EXIT_DISTANCE);

  // Relax the window slightly before giving up on this layout.
  if (candidates.length === 0) {
    candidates = reachable.filter((t) =>
      dist[t.row][t.col] >= 5 && dist[t.row][t.col] <= MAX_EXIT_DISTANCE + 6);
  }
  if (candidates.length === 0) return null;

  candidates.sort((a, b) => dist[a.row][a.col] - dist[b.row][b.col]);
  const bestWindow = candidates.slice(Math.floor(candidates.length * 0.5)); // upper half
  const exit = bestWindow[Math.floor(Math.random() * bestWindow.length)];

  const path = reconstructPath(prev, exit.col, exit.row);

  return {
    grid,
    spawn,
    exit: { col: exit.col, row: exit.row },
    path,
    dist,
    reachable,
    exitDistance: dist[exit.row][exit.col],
  };
}

/**
 * Last-resort layout used if random generation somehow never validates.
 * An open hall with a few decorative pillars - always solvable.
 */
function fallbackDungeon() {
  const grid = createGrid(TILE_FLOOR);
  for (let c = 0; c < COLS; c++) { grid[0][c] = TILE_WALL; grid[ROWS - 1][c] = TILE_WALL; }
  for (let r = 0; r < ROWS; r++) { grid[r][0] = TILE_WALL; grid[r][COLS - 1] = TILE_WALL; }

  const spawn = { col: 2, row: 2 };
  const exit = { col: COLS - 3, row: ROWS - 3 };

  // Add pillars, but only if the spawn->exit path survives.
  let placed = 0;
  for (let i = 0; i < 40 && placed < 10; i++) {
    const col = 2 + Math.floor(Math.random() * (COLS - 4));
    const row = 2 + Math.floor(Math.random() * (ROWS - 4));
    if (grid[row][col] === TILE_WALL) continue;
    if (Math.abs(col - spawn.col) + Math.abs(row - spawn.row) < 3) continue;
    if (Math.abs(col - exit.col) + Math.abs(row - exit.row) < 3) continue;

    grid[row][col] = TILE_WALL;
    const { dist } = bfs(grid, spawn.col, spawn.row);
    const d = dist[exit.row][exit.col];
    if (d === -1 || d > MAX_EXIT_DISTANCE + 8) {
      grid[row][col] = TILE_FLOOR; // revert - this pillar would break the level
    } else {
      placed++;
    }
  }

  const { dist, prev } = bfs(grid, spawn.col, spawn.row);
  const reachable = collectFloorTiles(grid).filter((t) => dist[t.row][t.col] >= 0);

  return {
    grid,
    spawn,
    exit,
    path: reconstructPath(prev, exit.col, exit.row),
    dist,
    reachable,
    exitDistance: Math.max(1, dist[exit.row][exit.col]),
  };
}

/**
 * Generate a validated dungeon.
 * @param {number} level - used only for telemetry; kept for a stable API.
 * @returns {object} dungeon description (grid, spawn, exit, path, dist, reachable)
 */
export function generateDungeon(level = 1) {
  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const dungeon = tryGenerate();
    if (dungeon) return dungeon;
  }
  return fallbackDungeon();
}
