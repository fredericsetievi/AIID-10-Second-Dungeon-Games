/**
 * enemy.js
 * A single, deliberately simple enemy:
 *   - WANDER: stroll between nearby floor tiles.
 *   - CHASE:  run straight at the player once inside DETECTION_RADIUS.
 *
 * Movement is axis-separated with wall collision, so enemies slide along
 * walls rather than getting permanently stuck. If an enemy stops making
 * progress for too long it re-picks a wander target, which reliably frees it
 * from awkward corners.
 */

import { TILE_SIZE, TILE_WALL, COLS, ROWS, tileCenter } from './dungeon.js';
import { collidesWithWalls, distance } from './collision.js';

export const DETECTION_RADIUS = 250; // pixels

const ENEMY_SIZE = 22;
const WANDER_RADIUS_TILES = 4;
const STUCK_TIMEOUT = 0.8; // seconds without meaningful movement -> new target

export class Enemy {
  /**
   * @param {number} col   spawn tile column
   * @param {number} row   spawn tile row
   * @param {number} level used to scale speed: 60 + level * 5
   */
  constructor(col, row, level) {
    const c = tileCenter(col, row);
    this.x = c.x;
    this.y = c.y;
    this.w = ENEMY_SIZE;
    this.h = ENEMY_SIZE;
    this.radius = ENEMY_SIZE / 2;
    this.speed = 60 + level * 5;

    this.state = 'WANDER';
    this.target = null;
    this.stuckTime = 0;
    this.lastX = this.x;
    this.lastY = this.y;
    this.animTime = Math.random() * 6;
    this.facing = 1;

    this.pickWanderTarget();
  }

  /** Choose a random walkable tile within WANDER_RADIUS_TILES of the current tile. */
  pickWanderTarget() {
    const col = Math.floor(this.x / TILE_SIZE);
    const row = Math.floor(this.y / TILE_SIZE);
    const options = [];

    for (let dr = -WANDER_RADIUS_TILES; dr <= WANDER_RADIUS_TILES; dr++) {
      for (let dc = -WANDER_RADIUS_TILES; dc <= WANDER_RADIUS_TILES; dc++) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
        options.push({ col: nc, row: nr });
      }
    }
    // Fall back to the current tile if the search somehow produced nothing.
    const pick = options.length ? options[Math.floor(Math.random() * options.length)] : { col, row };
    this.target = tileCenter(pick.col, pick.row);
  }

  /**
   * @param {number} dt
   * @param {Player} player
   * @param {number[][]} grid
   */
  update(dt, player, grid) {
    this.animTime += dt;

    const distToPlayer = distance(this.x, this.y, player.x, player.y);
    this.state = distToPlayer <= DETECTION_RADIUS ? 'CHASE' : 'WANDER';

    let tx;
    let ty;
    if (this.state === 'CHASE') {
      tx = player.x;
      ty = player.y;
    } else {
      if (!this.target) this.pickWanderTarget();
      tx = this.target.x;
      ty = this.target.y;
      // Arrived (or target tile is unreachable) -> pick somewhere new.
      if (distance(this.x, this.y, tx, ty) < 6) this.pickWanderTarget();
    }

    let dx = tx - this.x;
    let dy = ty - this.y;
    const len = Math.hypot(dx, dy);
    if (len > 0.001) {
      dx /= len;
      dy /= len;
    } else {
      dx = 0;
      dy = 0;
    }

    const step = this.speed * dt;
    let movedDistance = 0;

    if (dx !== 0) {
      const nx = this.x + dx * step;
      if (!collidesWithWalls(nx, this.y, this.w, this.h, grid)) {
        movedDistance += Math.abs(nx - this.x);
        this.x = nx;
        this.facing = dx > 0 ? 1 : -1;
      }
    }
    if (dy !== 0) {
      const ny = this.y + dy * step;
      if (!collidesWithWalls(this.x, ny, this.w, this.h, grid)) {
        movedDistance += Math.abs(ny - this.y);
        this.y = ny;
      }
    }

    // Anti-stuck watchdog.
    this.stuckTime = movedDistance < step * 0.25 ? this.stuckTime + dt : 0;
    if (this.stuckTime > STUCK_TIMEOUT) {
      this.stuckTime = 0;
      this.pickWanderTarget();
    }
  }

  draw(ctx) {
    const s = this.w;
    const wobble = Math.sin(this.animTime * 10) * 1.5;
    const cx = this.x;
    const cy = this.y + wobble;
    const chasing = this.state === 'CHASE';

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + s / 2 - 1, s * 0.42, s * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Body - red while chasing, purple while wandering.
    ctx.fillStyle = chasing ? '#e8453c' : '#8e5bd6';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);

    // Spiky "hair" on top
    ctx.fillStyle = chasing ? '#ff6b5e' : '#a97ce8';
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(cx - s / 2 + 2 + i * 6, cy - s / 2 - 3, 4, 4);
    }

    // Shading
    ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
    ctx.fillRect(cx - s / 2, cy + s / 2 - 4, s, 4);

    // Eyes
    ctx.fillStyle = '#fff';
    const eyeOffset = this.facing * 2;
    ctx.fillRect(cx + eyeOffset - 5, cy - 2, 4, 4);
    ctx.fillRect(cx + eyeOffset + 2, cy - 2, 4, 4);
    ctx.fillStyle = '#180a12';
    ctx.fillRect(cx + eyeOffset - 4 + (this.facing > 0 ? 1 : 0), cy - 1, 2, 2);
    ctx.fillRect(cx + eyeOffset + 3 + (this.facing > 0 ? 1 : 0), cy - 1, 2, 2);

    // Alert marker above a chasing enemy
    if (chasing) {
      ctx.fillStyle = '#ff5f6d';
      ctx.font = 'bold 12px "Courier New", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('!', cx, cy - s / 2 - 8);
    }

    // Outline
    ctx.strokeStyle = 'rgba(6, 12, 20, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - s / 2 + 0.5, cy - s / 2 + 0.5, s - 1, s - 1);
  }
}
