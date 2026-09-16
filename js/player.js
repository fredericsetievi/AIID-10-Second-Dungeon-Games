/**
 * player.js
 * The player character: input-driven movement with axis-separated wall
 * collision (so the player slides along walls instead of sticking).
 */

import { TILE_SIZE } from './dungeon.js';
import { collidesWithWalls } from './collision.js';

export const PLAYER_SPEED = 180; // pixels per second
const PLAYER_SIZE = 22;

export class Player {
  constructor(col, row) {
    this.x = col * TILE_SIZE + TILE_SIZE / 2;
    this.y = row * TILE_SIZE + TILE_SIZE / 2;
    this.w = PLAYER_SIZE;
    this.h = PLAYER_SIZE;
    this.speed = PLAYER_SPEED;
    this.radius = PLAYER_SIZE / 2;

    this.facing = 1;      // 1 = right, -1 = left
    this.moving = false;
    this.animTime = 0;
  }

  /**
   * @param {number} dt    delta seconds
   * @param {object} input { up, down, left, right }
   * @param {number[][]} grid
   */
  update(dt, input, grid) {
    let dx = 0;
    let dy = 0;
    if (input.up) dy -= 1;
    if (input.down) dy += 1;
    if (input.left) dx -= 1;
    if (input.right) dx += 1;

    // Normalise diagonals so diagonal speed matches cardinal speed.
    if (dx !== 0 && dy !== 0) {
      const inv = Math.SQRT1_2;
      dx *= inv;
      dy *= inv;
    }

    this.moving = dx !== 0 || dy !== 0;
    if (this.moving) this.animTime += dt;

    // Axis-separated resolution: move on X, test, then move on Y, test.
    if (dx !== 0) {
      const nx = this.x + dx * this.speed * dt;
      if (!collidesWithWalls(nx, this.y, this.w, this.h, grid)) this.x = nx;
      this.facing = dx > 0 ? 1 : -1;
    }
    if (dy !== 0) {
      const ny = this.y + dy * this.speed * dt;
      if (!collidesWithWalls(this.x, ny, this.w, this.h, grid)) this.y = ny;
    }
  }

  draw(ctx) {
    const bob = this.moving ? Math.sin(this.animTime * 14) * 1.6 : 0;
    const cx = this.x;
    const cy = this.y + bob;
    const s = this.w;

    // Shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + s / 2 - 1, s * 0.42, s * 0.20, 0, 0, Math.PI * 2);
    ctx.fill();

    // Cape / backpack (drawn behind the body, opposite the facing direction)
    ctx.fillStyle = '#c9455a';
    ctx.fillRect(cx - s / 2 - this.facing * 5, cy - s / 2 + 2, 5, s - 6);

    // Body
    ctx.fillStyle = '#4fc3f7';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);

    // Body shading
    ctx.fillStyle = '#2b8fb8';
    ctx.fillRect(cx - s / 2, cy + s / 2 - 4, s, 4);

    // Helmet band
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, 5);

    // Eyes - shifted towards the facing direction
    ctx.fillStyle = '#0b1b26';
    const eyeOffset = this.facing * 3;
    ctx.fillRect(cx + eyeOffset - 4, cy - 3, 3, 4);
    ctx.fillRect(cx + eyeOffset + 2, cy - 3, 3, 4);

    // Outline keeps the character readable on busy floors
    ctx.strokeStyle = 'rgba(6, 12, 20, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - s / 2 + 0.5, cy - s / 2 + 0.5, s - 1, s - 1);
  }
}
