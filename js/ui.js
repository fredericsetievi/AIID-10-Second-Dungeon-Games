/**
 * ui.js
 * Owns every DOM overlay screen (menu, how to play, pause, game over).
 *
 * The HUD and the level-complete panel are drawn on the canvas instead, so no
 * DOM work happens during actual gameplay - only between states.
 */

const SCREEN_IDS = {
  MENU: 'screen-MENU',
  HOWTO: 'screen-HOWTO',
  PAUSED: 'screen-PAUSED',
  GAME_OVER: 'screen-GAME_OVER',
};

export class UI {
  constructor(doc = document) {
    this.doc = doc;
    this.screens = {};
    for (const [name, id] of Object.entries(SCREEN_IDS)) {
      this.screens[name] = doc.getElementById(id);
    }

    this.actionHandler = () => {};
    this.current = null;

    // One delegated listener per button - cheap and keeps main.js clean.
    const buttons = doc.querySelectorAll('[data-action]');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        this.actionHandler(action);
      });
    });
  }

  /** Register the callback invoked for every button press. */
  onAction(handler) {
    this.actionHandler = handler;
  }

  /** Show one screen by state name, or pass null to hide them all. */
  show(name) {
    // Drop focus from the previous screen so hidden buttons can never be
    // activated by a stray Space / Enter during gameplay.
    const active = this.doc.activeElement;
    if (active && typeof active.blur === 'function') active.blur();

    for (const [key, el] of Object.entries(this.screens)) {
      if (!el) continue;
      el.hidden = key !== name;
    }
    this.current = name;

    // Move focus to the primary button so keyboard users can tab naturally.
    if (name && this.screens[name]) {
      const primary = this.screens[name].querySelector('.btn-primary') ||
                      this.screens[name].querySelector('.btn');
      if (primary) primary.focus({ preventScroll: true });
    }
  }

  hideAll() { this.show(null); }

  /** Refresh the menu's persisted records. */
  updateMenuStats(bestScore, highestLevel) {
    const scoreEl = this.doc.getElementById('menu-best-score');
    const levelEl = this.doc.getElementById('menu-best-level');
    if (scoreEl) scoreEl.textContent = String(bestScore);
    if (levelEl) levelEl.textContent = String(highestLevel);
  }

  /** Update the sound / music toggle button labels and highlight state. */
  updateToggles(soundEnabled, musicEnabled) {
    const soundBtn = this.doc.getElementById('btn-sound');
    const musicBtn = this.doc.getElementById('btn-music');
    if (soundBtn) {
      soundBtn.textContent = `SOUND: ${soundEnabled ? 'ON' : 'OFF'}`;
      soundBtn.classList.toggle('on', soundEnabled);
    }
    if (musicBtn) {
      musicBtn.textContent = `MUSIC: ${musicEnabled ? 'ON' : 'OFF'}`;
      musicBtn.classList.toggle('on', musicEnabled);
    }
  }

  /** Fill in and reveal the game over screen. */
  showGameOver({ reason, level, score, bestScore }) {
    const reasonEl = this.doc.getElementById('gameover-reason');
    const levelEl = this.doc.getElementById('gameover-level');
    const scoreEl = this.doc.getElementById('gameover-score');
    const bestEl = this.doc.getElementById('gameover-best');

    if (reasonEl) reasonEl.textContent = reason;
    if (levelEl) levelEl.textContent = String(level);
    if (scoreEl) scoreEl.textContent = String(score);
    if (bestEl) bestEl.textContent = String(bestScore);

    this.show('GAME_OVER');
  }
}
