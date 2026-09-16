/**
 * main.js
 * Entry point: wires the DOM, storage, audio and the Game together.
 */

import { Game } from './game.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import * as Storage from './storage.js';

function boot() {
  // Signals to the fallback notice in index.html that modules loaded fine.
  window.__TSD_BOOTED__ = true;

  Storage.load();

  const canvas = document.getElementById('gameCanvas');
  if (!canvas) return;

  const ui = new UI(document);
  const audio = new AudioEngine();

  // Restore the player's audio preferences before the first sound plays.
  audio.setSoundEnabled(Storage.get('soundEnabled'));
  audio.setMusicEnabled(Storage.get('musicEnabled'));

  const game = new Game(canvas, ui, audio);

  /** Single funnel for every on-screen button. */
  ui.onAction((action) => {
    audio.unlock();

    switch (action) {
      case 'play':
        audio.click();
        game.startNewRun();
        break;

      case 'howto':
        audio.click();
        game.showHowTo();
        break;

      case 'back':
        audio.click();
        game.toMenu();
        break;

      case 'resume':
        audio.click();
        game.resume();
        break;

      case 'restart':
      case 'again':
        audio.click();
        game.startNewRun();
        break;

      case 'menu':
        audio.click();
        game.toMenu();
        break;

      case 'toggle-sound': {
        const next = !Storage.get('soundEnabled');
        Storage.set('soundEnabled', next);
        audio.setSoundEnabled(next);
        ui.updateToggles(Storage.get('soundEnabled'), Storage.get('musicEnabled'));
        audio.click();
        break;
      }

      case 'toggle-music': {
        const next = !Storage.get('musicEnabled');
        Storage.set('musicEnabled', next);
        audio.setMusicEnabled(next);
        ui.updateToggles(Storage.get('soundEnabled'), Storage.get('musicEnabled'));
        audio.click();
        if (next) audio.startMusic();
        break;
      }

      default:
        break;
    }
  });

  // Pause when the tab is hidden so the timer never drains in the background.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) game.pause();
  });

  game.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
