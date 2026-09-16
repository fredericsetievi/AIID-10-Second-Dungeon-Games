/**
 * trap.js
 * Spike traps cycle through three states on a fixed loop:
 *   SAFE (1.0s) -> WARNING (0.5s) -> ACTIVE (0.7s) -> SAFE ...
 * Only ACTIVE traps can kill the player.
 *
 * Each trap gets a random phase offset at spawn time so a room full of traps
 * does not pulse in perfect lockstep - that would be unreadable and unfair.
 */

import { TILE_SIZE, tileCenter } from './dungeon.js';

export const TrapState = {
  SAFE: 'SAFE',
  WARNING: 'WARNING',
  ACTIVE: 'ACTIVE',
};

/** Duration of each phase in seconds. */
export const TRAP_TIMING = {
  SAFE: 1.0,
  WARNING: 0.5,
  ACTIVE: 0.7,
};

const CYCLE = TRAP_TIMING.SAFE + TRAP_TIMING.WARNING + TRAP_TIMING.ACTIVE; // 2.2s

export class Trap {
  constructor(col, row, randomOffset = true) {
    const c = tileCenter(col, row);
    this.col = col;
    this.row = row;
    this.x = c.x;
    this.y = c.y;

    this.elapsed = randomOffset ? Math.random() * CYCLE : 0;
    this.state = TrapState.SAFE;
    this.radius = 14;
    this._syncState();
  }

  /** True only while the spikes are out. */
  get isLethal() { return this.state === TrapState.ACTIVE; }

  /** Progress inside the current phase, 0..1. */
  get phaseProgress() {
    if (this.state === TrapState.SAFE) return this.elapsed / TRAP_TIMING.SAFE;
    if (this.state === TrapState.WARNING) return (this.elapsed - TRAP_TIMING.SAFE) / TRAP_TIMING.WARNING;
    return (this.elapsed - TRAP_TIMING.SAFE - TRAP_TIMING.WARNING) / TRAP_TIMING.ACTIVE;
  }

  /** Map the current elapsed time onto a phase name. */
  _stateAt(time) {
    if (time < TRAP_TIMING.SAFE) return TrapState.SAFE;
    if (time < TRAP_TIMING.SAFE + TRAP_TIMING.WARNING) return TrapState.WARNING;
    return TrapState.ACTIVE;
  }

  _syncState() {
    this.state = this._stateAt(this.elapsed);
  }

  /**
   * Advance the cycle.
   * @returns {string|null} the new state when it changed this frame, else null
   */
  update(dt) {
    this.elapsed = (this.elapsed + dt) % CYCLE;
    const next = this._stateAt(this.elapsed);
    if (next !== this.state) {
      this.state = next;
      return next;
    }
    return null;
  }

  draw(ctx) {
    const cx = this.x;
    const cy = this.y;
    const half = TILE_SIZE / 2;

    // Recessed plate
    ctx.fillStyle = '#1b2136';
    ctx.fillRect(cx - half + 3, cy - half + 3, TILE_SIZE - 6, TILE_SIZE - 6);

    // Four spike sockets
    ctx.fillStyle = '#0d1120';
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const sx = cx - 9 + i * 14;
        const sy = cy - 9 + j * 14;
        ctx.fillRect(sx - 3, sy - 3, 6, 6);
      }
    }

    if (this.state === TrapState.SAFE) {
      // Flush: only the dark sockets are visible.
      ctx.strokeStyle = 'rgba(120, 140, 180, 0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(cx - half + 3.5, cy - half + 3.5, TILE_SIZE - 7, TILE_SIZE - 7);
      return;
    }

    if (this.state === TrapState.WARNING) {
      // Spikes peek out and the plate flashes amber.
      const t = this.phaseProgress;
      const height = 3 + t * 4;
      const blink = 0.35 + 0.4 * Math.abs(Math.sin(t * Math.PI * 4));
      ctx.fillStyle = `rgba(255, 200, 87, ${blink.toFixed(3)})`;
      ctx.fillRect(cx - half + 4, cy - half + 4, TILE_SIZE - 8, TILE_SIZE - 8);
      ctx.fillStyle = '#c9d4ee';
      this._drawSpikes(ctx, cx, cy, height);
      return;
    }

    // ACTIVE - spikes fully extended, red danger flash.
    const t = this.phaseProgress;
    const flash = 0.5 + 0.35 * Math.abs(Math.sin(t * Math.PI * 6));
    ctx.fillStyle = `rgba(255, 95, 109, ${flash.toFixed(3)})`;
    ctx.fillRect(cx - half + 4, cy - half + 4, TILE_SIZE - 8, TILE_SIZE - 8);
    ctx.fillStyle = '#ffffff';
    this._drawSpikes(ctx, cx, cy, 11);
  }

  _drawSpikes(ctx, cx, cy, height) {
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 2; j++) {
        const sx = cx - 9 + i * 14;
        const sy = cy - 9 + j * 14;
        ctx.beginPath();
        ctx.moveTo(sx - 4, sy + 4);
        ctx.lineTo(sx, sy + 4 - height);
        ctx.lineTo(sx + 4, sy + 4);
        ctx.closePath();
        ctx.fill();
      }
    }
  }
}
