/**
 * collectible.js
 * Coins, the treasure chest and the exit portal.
 * All three are pure visuals plus a position - the Game owns the logic that
 * reacts to the player touching them.
 */

import { TILE_SIZE, tileCenter } from './dungeon.js';

/** Shared bob animation so every pickup floats in sync-ish harmony. */
function bobOffset(time, speed = 4, amount = 3) {
  return Math.sin(time * speed) * amount;
}

// ------------------------------------------------------------------ coin

export class Coin {
  constructor(col, row, timeOffset = Math.random() * 6) {
    const c = tileCenter(col, row);
    this.col = col;
    this.row = row;
    this.x = c.x;
    this.y = c.y;
    this.radius = 10;
    this.collected = false;
    this.time = timeOffset;
  }

  update(dt) { this.time += dt; }

  draw(ctx) {
    const y = this.y + bobOffset(this.time, 5, 2.5);
    // Squash the coin horizontally to fake a spin.
    const spin = Math.abs(Math.cos(this.time * 3));
    const rx = 3 + spin * 6;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 9, 6, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffc857';
    ctx.beginPath();
    ctx.ellipse(this.x, y, rx, 8, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#e09b1d';
    ctx.beginPath();
    ctx.ellipse(this.x, y, Math.max(1, rx - 2), 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(120, 70, 0, 0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(this.x, y, rx, 8, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
}

// ------------------------------------------------------------------ treasure

export class Treasure {
  constructor(col, row, timeOffset = Math.random() * 6) {
    const c = tileCenter(col, row);
    this.col = col;
    this.row = row;
    this.x = c.x;
    this.y = c.y;
    this.radius = 14;
    this.collected = false;
    this.time = timeOffset;
  }

  update(dt) { this.time += dt; }

  draw(ctx) {
    const y = this.y + bobOffset(this.time, 3, 1.5);
    const w = 26;
    const h = 18;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 11, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    // Chest body
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(this.x - w / 2, y - h / 2 + 4, w, h - 4);
    // Lid
    ctx.fillStyle = '#a9702f';
    ctx.fillRect(this.x - w / 2, y - h / 2 - 2, w, 8);
    // Bands
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(this.x - w / 2 + 4, y - h / 2 + 4, 3, h - 4);
    ctx.fillRect(this.x + w / 2 - 7, y - h / 2 + 4, 3, h - 4);
    // Lock
    ctx.fillStyle = '#ffe9a8';
    ctx.fillRect(this.x - 3, y - 1, 6, 7);

    // Sparkle that pulses to draw the eye
    const glow = 0.35 + 0.3 * Math.sin(this.time * 6);
    ctx.fillStyle = `rgba(255, 233, 168, ${glow.toFixed(3)})`;
    ctx.fillRect(this.x - w / 2 - 3, y - h / 2 - 6, 3, 3);
    ctx.fillRect(this.x + w / 2 + 1, y - h / 2 - 4, 2, 2);

    ctx.strokeStyle = 'rgba(40, 22, 6, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.x - w / 2 + 0.5, y - h / 2 - 2.5, w - 1, h + 1.5);
  }
}

// ------------------------------------------------------------------ exit

export class Exit {
  constructor(col, row) {
    const c = tileCenter(col, row);
    this.col = col;
    this.row = row;
    this.x = c.x;
    this.y = c.y;
    this.radius = 16;
    this.time = 0;
  }

  update(dt) { this.time += dt; }

  draw(ctx) {
    const cx = this.x;
    const cy = this.y;
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 4);

    // Pulsing glow ring on the floor
    ctx.fillStyle = `rgba(92, 224, 138, ${(0.12 + pulse * 0.16).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(cx, cy, 18 + pulse * 3, 0, Math.PI * 2);
    ctx.fill();

    // Portal arch
    ctx.fillStyle = '#2b3a2f';
    ctx.fillRect(cx - 14, cy - 16, 28, 30);

    // Swirling portal interior
    ctx.fillStyle = `rgba(92, 224, 138, ${(0.55 + pulse * 0.35).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, 9, 12, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(10, 40, 22, 0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy - 1, 4.5 + pulse, 7 + pulse, 0, 0, Math.PI * 2);
    ctx.fill();

    // Frame studs
    ctx.fillStyle = '#7ee2a8';
    ctx.fillRect(cx - 14, cy - 16, 28, 3);
    ctx.fillRect(cx - 14, cy + 11, 28, 3);

    // Arrow hint pointing into the portal
    ctx.fillStyle = `rgba(160, 255, 200, ${(0.45 + pulse * 0.4).toFixed(3)})`;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 24 - pulse * 3);
    ctx.lineTo(cx - 5, cy - 31 - pulse * 3);
    ctx.lineTo(cx + 5, cy - 31 - pulse * 3);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(6, 20, 12, 0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - 14.5, cy - 16.5, 29, 31);
  }
}

