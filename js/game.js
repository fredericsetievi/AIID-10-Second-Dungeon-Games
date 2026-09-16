/**
 * game.js
 * The heart of 10-Second Dungeon: state machine, fixed 10-second timer,
 * level setup, collision resolution, scoring and all canvas rendering.
 */

import {
  COLS, ROWS, TILE_SIZE, TILE_WALL, TILE_FLOOR,
  generateDungeon, shuffle, tileCenter,
} from './dungeon.js';
import { Player } from './player.js';
import { Enemy } from './enemy.js';
import { Trap, TrapState } from './trap.js';
import { Coin, Treasure, Exit } from './collectible.js';
import { distance, circlesIntersect, clamp } from './collision.js';
import * as Storage from './storage.js';

// ------------------------------------------------------------------ constants

export const State = {
  MENU: 'MENU',
  PLAYING: 'PLAYING',
  LEVEL_COMPLETE: 'LEVEL_COMPLETE',
  GAME_OVER: 'GAME_OVER',
  PAUSED: 'PAUSED',
};

export const WIDTH = COLS * TILE_SIZE;   // 800
export const HEIGHT = ROWS * TILE_SIZE;  // 480

const LEVEL_TIME = 10;          // seconds
const COIN_SCORE = 10;
const TREASURE_SCORE = 50;
const COMPLETION_BONUS = 100;
const TIME_BONUS_RATE = 20;     // points per remaining second
const MAX_DELTA = 0.05;         // clamp huge frame gaps (tab switches)
const LEVEL_COMPLETE_DURATION = 2.4;
const DANGER_TIME = 3;          // timer emphasis threshold
const HUD_HEIGHT = 40;
const MAX_RENDER_SCALE = 3;     // cap output at 3x (2400x1440) to protect FPS

/**
 * Difficulty curve.
 * Levels 1-4 are hand tuned, level 5+ follows the formula. Results are capped
 * so a level can never become impossible inside the 10 second budget.
 */
export function difficultyFor(level) {
  let enemies;
  let traps;
  let coins;

  if (level <= 1)      { enemies = 0; traps = 1; coins = 5; }
  else if (level === 2) { enemies = 1; traps = 2; coins = 6; }
  else if (level === 3) { enemies = 1; traps = 3; coins = 7; }
  else if (level === 4) { enemies = 2; traps = 4; coins = 8; }
  else {
    enemies = Math.floor(level / 2);
    traps = level + 1;
    coins = 5 + level;
  }

  return {
    enemies: Math.min(enemies, 4),
    traps: Math.min(traps, 9),
    coins: Math.min(coins, 14),
  };
}

const tileKey = (col, row) => `${col},${row}`;

// ------------------------------------------------------------------ dungeon art

/**
 * Draw the static dungeon into an offscreen canvas once per level.
 * Blitting a single cached image every frame keeps rendering cheap.
 */
function renderDungeonTo(ctx, grid) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);

  // --- floor + wall base colours
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;
      if (grid[row][col] === TILE_FLOOR) {
        ctx.fillStyle = (col + row) % 2 === 0 ? '#161c2e' : '#1a2034';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      } else {
        ctx.fillStyle = '#323c5b';
        ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  // --- floor speckles (deterministic so they do not flicker between frames)
  ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row][col] !== TILE_FLOOR) continue;
      const n = (col * 73856093) ^ (row * 19349663);
      if (n % 5 === 0) ctx.fillRect(col * TILE_SIZE + 8, row * TILE_SIZE + 12, 2, 2);
      if (n % 7 === 0) ctx.fillRect(col * TILE_SIZE + 26, row * TILE_SIZE + 24, 2, 2);
    }
  }

  // --- wall brickwork and the lit top edge facing the floor
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      if (grid[row][col] !== TILE_WALL) continue;
      const x = col * TILE_SIZE;
      const y = row * TILE_SIZE;

      ctx.fillStyle = '#3b4668';
      ctx.fillRect(x, y, TILE_SIZE, 4);
      ctx.fillRect(x, y, 4, TILE_SIZE);

      ctx.fillStyle = 'rgba(10, 14, 26, 0.35)';
      ctx.fillRect(x, y + TILE_SIZE - 3, TILE_SIZE, 3);
      ctx.fillRect(x + TILE_SIZE - 3, y, 3, TILE_SIZE);

      // Highlight the front face where the wall meets walkable floor below.
      const openBelow = row + 1 < ROWS && grid[row + 1][col] === TILE_FLOOR;
      if (openBelow) {
        ctx.fillStyle = 'rgba(12, 17, 30, 0.45)';
        ctx.fillRect(x, y + TILE_SIZE - 8, TILE_SIZE, 8);
      }
    }
  }
}

// ------------------------------------------------------------------ game

export class Game {
  constructor(canvas, ui, audio) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.ui = ui;
    this.audio = audio;

    this.state = State.MENU;
    this.keys = Object.create(null);

    this.level = 1;
    this.score = 0;
    this.timeLeft = LEVEL_TIME;

    this.dungeon = null;
    this.player = null;
    this.exit = null;
    this.coins = [];
    this.treasure = null;
    this.enemies = [];
    this.traps = [];
    this.floaters = [];
    this.particles = [];
    this.usedTiles = new Set();

    this.levelStats = null;
    this.completeTimer = 0;
    this.deathReason = '';
    this.lastTickSecond = 99;
    this.shake = 0;
    this.elapsed = 0;
    this.renderScale = 1;

    // Cached dungeon artwork
    this.dungeonCanvas = document.createElement('canvas');
    this.dungeonGrid = null;

    // Menu backdrop
    this.menuDungeon = null;
    this.menuCoins = [];
    this.menuTime = 0;

    this.vignetteCanvas = null;

    this.resize();
    this._bindEvents();
    this._enterMenu();
  }

  // ---------------------------------------------------------------- setup

  /**
   * Match the backing store to the canvas' real on-screen size in device
   * pixels. Rendering 1:1 is what keeps the game sharp - letting the browser
   * upscale a fixed 800x480 buffer is what makes it look soft and blurry.
   *
   * The game still thinks entirely in 800x480 logical units (WIDTH x HEIGHT).
   * Only the pixel density of the output changes, so no gameplay code or
   * layout maths is affected.
   */
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    // How many real device pixels we can use for each logical unit.
    // Falls back to WIDTH when the canvas has not been laid out yet.
    const cssWidth = this.canvas.clientWidth || WIDTH;
    const scale = clamp((cssWidth / WIDTH) * dpr, 1, MAX_RENDER_SCALE);

    // Skip the rebuild when nothing actually changed (resize events fire a lot).
    if (this.canvas.width && Math.abs(scale - this.renderScale) < 0.01) return;

    this.renderScale = scale;
    this.canvas.width = Math.round(WIDTH * scale);
    this.canvas.height = Math.round(HEIGHT * scale);

    this.ctx.setTransform(scale, 0, 0, scale, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    this._buildVignetteCache();
    if (this.dungeonGrid) this._buildDungeonCache(this.dungeonGrid);
    if (this.menuDungeon) this._buildMenuCache();
  }

  /**
   * The vignette never changes, so it is baked once per resolution and blitted.
   * At 3x that is a 2400x1440 full-screen gradient we no longer re-evaluate
   * every single frame.
   */
  _buildVignetteCache() {
    this.vignetteCanvas = this.vignetteCanvas || document.createElement('canvas');
    const c = this.vignetteCanvas;
    c.width = Math.round(WIDTH * this.renderScale);
    c.height = Math.round(HEIGHT * this.renderScale);

    const cx = c.getContext('2d');
    cx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    cx.clearRect(0, 0, WIDTH, HEIGHT);

    const gradient = cx.createRadialGradient(
      WIDTH / 2, HEIGHT / 2, HEIGHT * 0.35,
      WIDTH / 2, HEIGHT / 2, HEIGHT * 0.85);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.55)');

    cx.fillStyle = gradient;
    cx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  _buildDungeonCache(grid) {
    this.dungeonGrid = grid;
    const c = this.dungeonCanvas;
    c.width = Math.round(WIDTH * this.renderScale);
    c.height = Math.round(HEIGHT * this.renderScale);
    const cx = c.getContext('2d');
    cx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    renderDungeonTo(cx, grid);
  }

  _buildMenuCache() {
    this.menuCanvas = this.menuCanvas || document.createElement('canvas');
    const c = this.menuCanvas;
    c.width = Math.round(WIDTH * this.renderScale);
    c.height = Math.round(HEIGHT * this.renderScale);
    const cx = c.getContext('2d');
    cx.setTransform(this.renderScale, 0, 0, this.renderScale, 0, 0);
    renderDungeonTo(cx, this.menuDungeon.grid);
  }

  _bindEvents() {
    window.addEventListener('resize', () => this.resize());

    // The canvas is sized by CSS, so it can change size without any window
    // event (panel resizes, zoom, layout shifts). Observe it directly.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.resize()).observe(this.canvas);
    }

    window.addEventListener('keydown', (e) => this._onKeyDown(e));
    window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    // Losing focus mid-run should never cost the player a level.
    window.addEventListener('blur', () => {
      this.keys = Object.create(null);
      if (this.state === State.PLAYING) this.pause();
    });

    // First gesture unlocks Web Audio.
    const unlock = () => this.audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  _onKeyDown(e) {
    const isConfirm = e.code === 'Space' || e.code === 'Enter' || e.code === 'NumpadEnter';
    // When a menu button owns the keyboard, Space/Enter must reach the browser
    // so it can activate that button normally.
    const buttonOwnsConfirm = isConfirm && this._isButtonFocused();

    const isArrow = e.code === 'ArrowUp' || e.code === 'ArrowDown' ||
                    e.code === 'ArrowLeft' || e.code === 'ArrowRight';
    if (isArrow || (e.code === 'Space' && !buttonOwnsConfirm)) {
      e.preventDefault(); // never let the page scroll
    }

    if (e.repeat) return;
    this.keys[e.code] = true;

    if (isConfirm) {
      if (!buttonOwnsConfirm) this._handleConfirm();
      return;
    }
    if (e.code === 'Escape') this._handleEscape();
  }

  _handleEscape() {
    // The how-to screen is a DOM overlay shown on top of the menu state.
    if (this.state === State.MENU) {
      if (this.ui.current === 'HOWTO') this.toMenu();
      return;
    }
    switch (this.state) {
      case State.PLAYING:
        this.pause();
        break;
      case State.PAUSED:
        this.resume();
        break;
      default:
        break;
    }
  }

  /**
   * True while a DOM button holds keyboard focus. Enter / Space then belong to
   * the browser's native button activation, so the global shortcut stands down
   * to avoid firing the same action twice.
   */
  _isButtonFocused() {
    const el = document.activeElement;
    return !!el && el.tagName === 'BUTTON';
  }

  _handleConfirm() {
    if (this.state === State.MENU && this.ui.current === 'HOWTO') {
      this.toMenu();
      return;
    }
    switch (this.state) {
      case State.MENU:
        this.startNewRun();
        break;
      case State.PAUSED:
        this.resume();
        break;
      case State.GAME_OVER:
        this.startNewRun();
        break;
      case State.LEVEL_COMPLETE:
        this._advanceLevel(); // skip the summary early
        break;
      default:
        break;
    }
  }

  _inputState() {
    const k = this.keys;
    return {
      up: !!(k.KeyW || k.ArrowUp),
      down: !!(k.KeyS || k.ArrowDown),
      left: !!(k.KeyA || k.ArrowLeft),
      right: !!(k.KeyD || k.ArrowRight),
    };
  }

  // ---------------------------------------------------------------- states

  setState(next) {
    this.state = next;
    switch (next) {
      case State.MENU:
        this._enterMenu();
        break;
      case State.PLAYING:
        this.ui.hideAll();
        this.audio.startMusic();
        break;
      case State.PAUSED:
        this.ui.show('PAUSED');
        this.audio.stopMusic();
        break;
      case State.GAME_OVER:
        this.audio.stopMusic();
        break;
      case State.LEVEL_COMPLETE:
        this.audio.stopMusic();
        break;
      default:
        break;
    }
  }

  _enterMenu() {
    this.audio.stopMusic();
    this.menuDungeon = generateDungeon(1);
    this._buildMenuCache();
    this.menuCoins = [];
    const tiles = shuffle(this.menuDungeon.reachable.slice());
    for (let i = 0; i < 10 && i < tiles.length; i++) {
      this.menuCoins.push(new Coin(tiles[i].col, tiles[i].row));
    }
    this.ui.updateMenuStats(Storage.get('bestScore'), Storage.get('highestLevel'));
    this.ui.updateToggles(Storage.get('soundEnabled'), Storage.get('musicEnabled'));
    this.ui.show('MENU');
  }

  showHowTo() {
    this.ui.show('HOWTO');
  }

  /** Back to the main menu from any overlay screen. */
  toMenu() {
    this.setState(State.MENU);
  }

  pause() {
    if (this.state !== State.PLAYING) return;
    this.setState(State.PAUSED);
  }

  resume() {
    if (this.state !== State.PAUSED) return;
    this.setState(State.PLAYING);
  }

  /** Reset score and level, then begin level 1. */
  startNewRun() {
    this.score = 0;
    this.level = 1;
    this.startLevel(this.level);
  }

  /** Rebuild every entity for the given level from scratch. */
  startLevel(level) {
    const dungeon = generateDungeon(level);
    this.dungeon = dungeon;
    this._buildDungeonCache(dungeon.grid);

    this.player = new Player(dungeon.spawn.col, dungeon.spawn.row);
    this.exit = new Exit(dungeon.exit.col, dungeon.exit.row);

    this.usedTiles = new Set([tileKey(dungeon.spawn.col, dungeon.spawn.row)]);
    // Keep the exit tile and its neighbours clear of hazards.
    this.usedTiles.add(tileKey(dungeon.exit.col, dungeon.exit.row));

    const pathSet = new Set(dungeon.path.map((t) => tileKey(t.col, t.row)));
    const distAt = (t) => dungeon.dist[t.row][t.col];
    const nearExit = (t) =>
      Math.abs(t.col - dungeon.exit.col) + Math.abs(t.row - dungeon.exit.row) <= 1;

    // Straight-line distance from the spawn point, in pixels. This is what the
    // enemy's 250px detection radius actually uses - BFS tile distance would
    // overestimate it on winding paths and let enemies wake up at t=0.
    const spawnPx = tileCenter(dungeon.spawn.col, dungeon.spawn.row);
    const pixelsFromSpawn = (t) => {
      const c = tileCenter(t.col, t.row);
      return Math.hypot(c.x - spawnPx.x, c.y - spawnPx.y);
    };

    const diff = difficultyFor(level);

    // --- enemies: always start outside detection range so the player gets a
    //     fair first second. Tiers relax the requirement on cramped layouts.
    let enemyTiles = [];
    for (const minPixels of [290, 250, 210]) {
      if (enemyTiles.length >= diff.enemies) break;
      const need = diff.enemies - enemyTiles.length;
      enemyTiles = enemyTiles.concat(
        this._takeTiles(need, (t) => distAt(t) >= 5 && pixelsFromSpawn(t) >= minPixels));
    }
    this.enemies = enemyTiles.map((t) => new Enemy(t.col, t.row, level));

    // --- traps: never next to spawn, never on the exit
    const trapTiles = this._takeTiles(diff.traps, (t) => distAt(t) >= 3 && !nearExit(t));
    this.traps = trapTiles.map((t) => new Trap(t.col, t.row));

    // --- treasure: deliberately off the shortest route (a real risk/reward call)
    this.treasure = null;
    if (level >= 2) {
      let chestTiles = this._takeTiles(1, (t) => distAt(t) >= 4 && !pathSet.has(tileKey(t.col, t.row)));
      if (chestTiles.length === 0) chestTiles = this._takeTiles(1, (t) => distAt(t) >= 4);
      if (chestTiles.length) this.treasure = new Treasure(chestTiles[0].col, chestTiles[0].row);
    }

    // --- coins: half along the main route, half scattered
    this.coins = [];
    const onPathCount = Math.ceil(diff.coins / 2);
    const pathCoins = this._takeTiles(onPathCount, (t) => distAt(t) >= 1 && pathSet.has(tileKey(t.col, t.row)));
    const remaining = diff.coins - pathCoins.length;
    const otherCoins = this._takeTiles(remaining, (t) => distAt(t) >= 2);
    for (const t of [...pathCoins, ...otherCoins]) {
      this.coins.push(new Coin(t.col, t.row));
    }

    this.floaters = [];
    this.particles = [];
    this.timeLeft = LEVEL_TIME;
    this.lastTickSecond = 99;
    this.levelCoinScore = 0;
    this.levelTreasureScore = 0;
    this.coinsCollected = 0;
    this.treasureCollected = false;
    this.levelStats = null;
    this.shake = 0;

    Storage.set('highestLevel', Math.max(Storage.get('highestLevel'), level));
    this.setState(State.PLAYING);
  }

  /**
   * Pick up to `count` distinct, unused tiles matching `predicate`.
   * Chosen tiles are marked used so nothing ever overlaps.
   */
  _takeTiles(count, predicate) {
    if (count <= 0) return [];
    const candidates = this.dungeon.reachable.filter((t) => {
      if (this.usedTiles.has(tileKey(t.col, t.row))) return false;
      return predicate(t);
    });
    shuffle(candidates);
    const picked = candidates.slice(0, count);
    for (const t of picked) this.usedTiles.add(tileKey(t.col, t.row));
    return picked;
  }

  // ---------------------------------------------------------------- loop

  start() {
    this.lastTime = performance.now();
    const frame = (now) => {
      const dt = Math.min((now - this.lastTime) / 1000, MAX_DELTA);
      this.lastTime = now;
      this.update(dt);
      this.render(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  update(dt) {
    this.elapsed += dt;
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 3);

    switch (this.state) {
      case State.PLAYING:
        this._updatePlaying(dt);
        break;
      case State.LEVEL_COMPLETE:
        this._updateLevelComplete(dt);
        break;
      case State.MENU:
        this._updateMenu(dt);
        break;
      default:
        // PAUSED and GAME_OVER freeze all gameplay.
        break;
    }

    this.audio.update(dt);
  }

  _updateMenu(dt) {
    this.menuTime += dt;
    for (const coin of this.menuCoins) coin.update(dt);
  }

  _updatePlaying(dt) {
    // ---- timer
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this._gameOver("Time's up!");
      return;
    }

    // One tick per whole second while inside the danger window.
    const second = Math.ceil(this.timeLeft);
    if (second <= DANGER_TIME && second !== this.lastTickSecond) {
      this.lastTickSecond = second;
      this.audio.timerTick();
    }

    // ---- world
    this.player.update(dt, this._inputState(), this.dungeon.grid);

    for (const coin of this.coins) coin.update(dt);
    if (this.treasure) this.treasure.update(dt);
    this.exit.update(dt);

    for (const enemy of this.enemies) enemy.update(dt, this.player, this.dungeon.grid);

    for (const trap of this.traps) {
      const changed = trap.update(dt);
      if (!changed) continue;
      // Only warn about traps the player can actually hear/see nearby.
      const near = distance(trap.x, trap.y, this.player.x, this.player.y) < 220;
      if (!near) continue;
      if (changed === TrapState.WARNING) this.audio.trapWarning();
      if (changed === TrapState.ACTIVE) this.audio.trapActive();
    }

    this._updateFloaters(dt);
    this._updateParticles(dt);

    this._checkCollectibles();
    if (this.state !== State.PLAYING) return; // collecting the exit can end the level

    this._checkHazards();
  }

  _updateLevelComplete(dt) {
    this.completeTimer -= dt;
    this.exit.update(dt);
    this._updateFloaters(dt);
    this._updateParticles(dt);
    if (this.completeTimer <= 0) this._advanceLevel();
  }

  _updateFloaters(dt) {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y -= dt * 30;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
  }

  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }
  }

  // ---------------------------------------------------------------- rules

  _checkCollectibles() {
    const p = this.player;

    for (let i = this.coins.length - 1; i >= 0; i--) {
      const coin = this.coins[i];
      if (!circlesIntersect(p.x, p.y, p.radius, coin.x, coin.y, coin.radius)) continue;
      this.coins.splice(i, 1);
      this.score += COIN_SCORE;
      this.levelCoinScore += COIN_SCORE;
      this.coinsCollected++;
      this.audio.coin();
      this._addFloater(coin.x, coin.y, `+${COIN_SCORE}`, '#ffc857');
      this._burst(coin.x, coin.y, '#ffc857', 6);
    }

    if (this.treasure && !this.treasure.collected) {
      if (circlesIntersect(p.x, p.y, p.radius, this.treasure.x, this.treasure.y, this.treasure.radius)) {
        this.treasure.collected = true;
        this.score += TREASURE_SCORE;
        this.levelTreasureScore += TREASURE_SCORE;
        this.treasureCollected = true;
        this.audio.treasure();
        this._addFloater(this.treasure.x, this.treasure.y, `+${TREASURE_SCORE}`, '#ffe9a8');
        this._burst(this.treasure.x, this.treasure.y, '#ffe9a8', 14);
      }
    }

    if (circlesIntersect(p.x, p.y, p.radius, this.exit.x, this.exit.y, this.exit.radius)) {
      this._completeLevel();
    }
  }

  _checkHazards() {
    const p = this.player;

    for (const enemy of this.enemies) {
      if (circlesIntersect(p.x, p.y, p.radius - 3, enemy.x, enemy.y, enemy.radius - 3)) {
        this.audio.enemyHit();
        this._gameOver('A monster caught you!');
        return;
      }
    }

    for (const trap of this.traps) {
      if (!trap.isLethal) continue;
      if (circlesIntersect(p.x, p.y, p.radius - 3, trap.x, trap.y, trap.radius)) {
        this.audio.trapActive();
        this._gameOver('You stepped on a trap!');
        return;
      }
    }
  }

  _completeLevel() {
    const remaining = this.timeLeft;
    const timeBonus = Math.round(remaining * TIME_BONUS_RATE);
    const total = this.levelCoinScore + this.levelTreasureScore + COMPLETION_BONUS + timeBonus;

    this.levelStats = {
      coins: this.levelCoinScore,
      treasure: this.levelTreasureScore,
      completion: COMPLETION_BONUS,
      timeBonus,
      remaining,
      total,
      score: this.score + total,
    };

    this.score += total;
    this.timeLeft = remaining; // freeze the clock at the moment of escape
    Storage.submitRun(this.score, this.level + 1);

    this.audio.levelComplete();
    this.completeTimer = LEVEL_COMPLETE_DURATION;
    this.setState(State.LEVEL_COMPLETE);
  }

  _advanceLevel() {
    this.level += 1;
    this.startLevel(this.level);
  }

  _gameOver(reason) {
    this.deathReason = reason;
    this.shake = 1;
    if (reason !== 'A monster caught you!') this.audio.death();
    Storage.submitRun(this.score, this.level);
    this._burst(this.player.x, this.player.y, '#ff5f6d', 16);
    this.ui.showGameOver({
      reason,
      level: this.level,
      score: this.score,
      bestScore: Storage.get('bestScore'),
    });
    this.setState(State.GAME_OVER);
  }

  // ---------------------------------------------------------------- fx

  _addFloater(x, y, text, color) {
    this.floaters.push({ x, y, text, color, life: 0.9, maxLife: 0.9 });
  }

  _burst(x, y, color, count) {
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.4;
      const speed = 60 + Math.random() * 90;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0.4 + Math.random() * 0.3,
        maxLife: 0.7,
        color,
        size: 2 + Math.random() * 2,
      });
    }
  }

  // ---------------------------------------------------------------- render

  render() {
    const ctx = this.ctx;
    ctx.save();

    if (this.shake > 0) {
      const amp = this.shake * 6;
      ctx.translate((Math.random() - 0.5) * amp, (Math.random() - 0.5) * amp);
    }

    ctx.clearRect(-20, -20, WIDTH + 40, HEIGHT + 40);

    if (this.state === State.MENU) {
      this._renderMenuBackdrop(ctx);
    } else {
      this._renderWorld(ctx);
      this._renderHUD(ctx);
      if (this.state === State.LEVEL_COMPLETE) this._renderLevelComplete(ctx);
      if (this.state === State.GAME_OVER) this._renderGameOverTint(ctx);
    }

    ctx.restore();
  }

  _renderMenuBackdrop(ctx) {
    if (this.menuCanvas) ctx.drawImage(this.menuCanvas, 0, 0, WIDTH, HEIGHT);
    for (const coin of this.menuCoins) coin.draw(ctx);
    if (this.vignetteCanvas) {
      ctx.drawImage(this.vignetteCanvas, 0, 0, WIDTH, HEIGHT);
    }
  }

  _renderWorld(ctx) {
    if (this.dungeonGrid) ctx.drawImage(this.dungeonCanvas, 0, 0, WIDTH, HEIGHT);

    this.exit.draw(ctx);
    for (const trap of this.traps) trap.draw(ctx);
    for (const coin of this.coins) coin.draw(ctx);
    if (this.treasure && !this.treasure.collected) this.treasure.draw(ctx);
    for (const enemy of this.enemies) enemy.draw(ctx);
    if (this.player) this.player.draw(ctx);

    // Particles sit above entities, floaters above everything in-world.
    for (const p of this.particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    ctx.textAlign = 'center';
    ctx.font = 'bold 14px "Courier New", monospace';
    for (const f of this.floaters) {
      ctx.globalAlpha = clamp(f.life / f.maxLife, 0, 1);
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(f.text, f.x + 1, f.y + 1);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;

    if (this.vignetteCanvas) {
      ctx.drawImage(this.vignetteCanvas, 0, 0, WIDTH, HEIGHT);
    }
  }

  _renderHUD(ctx) {
    // --- bar
    ctx.fillStyle = 'rgba(7, 10, 20, 0.78)';
    ctx.fillRect(0, 0, WIDTH, HUD_HEIGHT);
    ctx.fillStyle = 'rgba(255, 200, 87, 0.35)';
    ctx.fillRect(0, HUD_HEIGHT - 2, WIDTH, 2);

    // --- level
    ctx.textAlign = 'left';
    ctx.font = 'bold 16px "Courier New", monospace';
    ctx.fillStyle = '#8b97b8';
    ctx.fillText('LEVEL', 14, 17);
    ctx.fillStyle = '#e6ecff';
    ctx.fillText(String(this.level), 14, 34);

    // --- score
    ctx.textAlign = 'right';
    ctx.fillStyle = '#8b97b8';
    ctx.fillText('SCORE', WIDTH - 14, 17);
    ctx.fillStyle = '#ffc857';
    ctx.fillText(String(this.score), WIDTH - 14, 34);

    // --- timer
    const danger = this.timeLeft <= DANGER_TIME;
    const remaining = Math.max(0, this.timeLeft);
    const pulse = danger ? 1 + 0.12 * Math.abs(Math.sin(this.elapsed * 12)) : 1;

    ctx.textAlign = 'center';
    ctx.fillStyle = danger ? '#ff8f98' : '#8b97b8';
    ctx.font = 'bold 10px "Courier New", monospace';
    ctx.fillText('TIME', WIDTH / 2, 13);

    ctx.save();
    ctx.translate(WIDTH / 2, 30);
    ctx.scale(pulse, pulse);
    ctx.font = `bold ${danger ? 22 : 20}px "Courier New", monospace`;
    ctx.fillStyle = danger ? '#ff5f6d' : '#5ce08a';
    ctx.fillText(remaining.toFixed(2), 0, 0);
    ctx.restore();

    // --- timer bar
    const barW = 220;
    const barH = 5;
    const bx = WIDTH / 2 - barW / 2;
    const by = HUD_HEIGHT - 9;
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = danger ? '#ff5f6d' : '#5ce08a';
    ctx.fillRect(bx, by, barW * clamp(remaining / LEVEL_TIME, 0, 1), barH);

    if (danger) {
      ctx.strokeStyle = `rgba(255, 95, 109, ${0.25 + 0.25 * Math.abs(Math.sin(this.elapsed * 10))})`;
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, WIDTH - 4, HEIGHT - 4);
    }
  }

  _renderLevelComplete(ctx) {
    const s = this.levelStats;
    if (!s) return;

    ctx.fillStyle = 'rgba(5, 7, 13, 0.72)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    const panelW = 420;
    const panelH = 268;
    const px = (WIDTH - panelW) / 2;
    const py = (HEIGHT - panelH) / 2;

    ctx.fillStyle = '#151b2b';
    ctx.fillRect(px, py, panelW, panelH);
    ctx.strokeStyle = '#5ce08a';
    ctx.lineWidth = 2;
    ctx.strokeRect(px + 1, py + 1, panelW - 2, panelH - 2);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#5ce08a';
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillText('LEVEL COMPLETE', WIDTH / 2, py + 40);

    const rows = [
      ['Coins earned', `+${s.coins}`],
      ['Treasure earned', `+${s.treasure}`],
      ['Completion bonus', `+${s.completion}`],
      [`Time bonus (${s.remaining.toFixed(2)}s)`, `+${s.timeBonus}`],
    ];

    ctx.font = '15px "Courier New", monospace';
    let y = py + 78;
    for (const [label, value] of rows) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#8b97b8';
      ctx.fillText(label, px + 28, y);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#e6ecff';
      ctx.fillText(value, px + panelW - 28, y);
      y += 24;
    }

    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 28, y - 4);
    ctx.lineTo(px + panelW - 28, y - 4);
    ctx.stroke();

    y += 16;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffc857';
    ctx.font = 'bold 17px "Courier New", monospace';
    ctx.fillText('Total earned', px + 28, y);
    ctx.textAlign = 'right';
    ctx.fillText(`+${s.total}`, px + panelW - 28, y);

    y += 26;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#8b97b8';
    ctx.font = '15px "Courier New", monospace';
    ctx.fillText('Current total score', px + 28, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#e6ecff';
    ctx.fillText(String(s.score), px + panelW - 28, y);

    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(139, 151, 184, 0.9)';
    ctx.font = '12px "Courier New", monospace';
    ctx.fillText('SPACE - continue to next level', WIDTH / 2, py + panelH - 16);
  }

  _renderGameOverTint(ctx) {
    ctx.fillStyle = 'rgba(60, 6, 12, 0.28)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }
}
