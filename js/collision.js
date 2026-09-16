/**
 * collision.js
 * Small, allocation-light geometry helpers shared by the player, enemies and
 * the world. All rectangle helpers take (x, y, w, h) in *top-left* form unless
 * the name says otherwise.
 */

import { TILE_SIZE, TILE_WALL, COLS, ROWS } from './dungeon.js';

/**
 * True when an axis-aligned box centred on (cx, cy) overlaps any wall tile.
 * The box is expanded by `padding` on every side when padding is positive.
 */
export function collidesWithWalls(cx, cy, w, h, grid, padding = 0) {
  const halfW = w / 2 + padding;
  const halfH = h / 2 + padding;

  const minCol = Math.floor((cx - halfW) / TILE_SIZE);
  const maxCol = Math.floor((cx + halfW - 0.0001) / TILE_SIZE);
  const minRow = Math.floor((cy - halfH) / TILE_SIZE);
  const maxRow = Math.floor((cy + halfH - 0.0001) / TILE_SIZE);

  for (let row = minRow; row <= maxRow; row++) {
    if (row < 0 || row >= ROWS) continue;
    for (let col = minCol; col <= maxCol; col++) {
      if (col < 0 || col >= COLS) continue;
      if (grid[row][col] === TILE_WALL) return true;
    }
  }
  return false;
}

/** Euclidean distance between two points. */
export function distance(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Squared distance - avoids a sqrt in hot loops. */
export function distanceSquared(ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy;
}

/** Circle vs circle intersection. */
export function circlesIntersect(ax, ay, ar, bx, by, br) {
  const r = ar + br;
  return distanceSquared(ax, ay, bx, by) <= r * r;
}

/** Clamp a value into [min, max]. */
export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
