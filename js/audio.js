/**
 * audio.js
 * All sound is synthesised at runtime with the Web Audio API - no external
 * asset files are needed, so the game works fully offline.
 *
 * The AudioContext is created lazily on the first user gesture because
 * browsers refuse to start audio without one.
 */

/** Note frequencies (Hz) used by the music arpeggio and jingles. */
const NOTE = {
  C4: 261.63, D4: 293.66, E4: 329.63, G4: 392.00, A4: 440.00,
  C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, A5: 880.00,
  C6: 1046.50, E6: 1318.51,
};

/** Slow pentatonic arpeggio used as ambient "music". */
const MUSIC_PATTERN = [
  NOTE.C4, NOTE.G4, NOTE.D5, NOTE.G4,
  NOTE.A4, NOTE.E5, NOTE.A5, NOTE.E5,
  NOTE.D4, NOTE.A4, NOTE.D5, NOTE.A4,
  NOTE.C4, NOTE.E4, NOTE.G4, NOTE.E4,
];

const MUSIC_STEP_SECONDS = 0.26;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.noiseBuffer = null;

    this.soundEnabled = true;
    this.musicEnabled = false;

    this.failed = false;      // AudioContext unavailable - stay silent, never crash
    this.musicTimer = 0;
    this.musicIndex = 0;
    this.musicPlaying = false;
  }

  /**
   * Create / resume the AudioContext. Must be triggered by a user gesture
   * (click or key press) the first time. Safe to call repeatedly.
   */
  unlock() {
    if (this.failed) return;

    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) { this.failed = true; return; }
      try {
        this.ctx = new Ctor();
      } catch (err) {
        this.failed = true;
        return;
      }
      this._buildGraph();
    }

    if (this.ctx.state === 'suspended') {
      // resume() returns a promise in some browsers; ignore rejections.
      const p = this.ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }

  _buildGraph() {
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);

    // Honour the persisted preferences immediately - setSoundEnabled may have
    // been called before the context existed.
    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.soundEnabled ? 0.55 : 0;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.musicEnabled ? 0.16 : 0;
    this.musicBus.connect(this.master);
  }

  setSoundEnabled(enabled) {
    this.soundEnabled = !!enabled;
    if (this.sfxBus) this.sfxBus.gain.value = this.soundEnabled ? 0.55 : 0;
  }

  setMusicEnabled(enabled) {
    this.musicEnabled = !!enabled;
    if (this.musicBus) this.musicBus.gain.value = this.musicEnabled ? 0.16 : 0;
    if (!this.musicEnabled) this.stopMusic();
  }

  // ------------------------------------------------------------------ core

  /**
   * Play one synthesised tone.
   * @param {object} opts
   * @param {number} opts.freq      start frequency in Hz
   * @param {number} [opts.endFreq] glide target frequency
   * @param {string} [opts.type]    oscillator waveform
   * @param {number} [opts.duration] seconds
   * @param {number} [opts.volume]  0..1 peak gain
   * @param {number} [opts.delay]   seconds before the note starts
   */
  tone({ freq, endFreq = null, type = 'square', duration = 0.12, volume = 0.5, delay = 0 }) {
    if (!this.soundEnabled || this.failed || !this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (endFreq !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, endFreq), now + duration);

    // Short attack + exponential decay keeps the blips crisp and click-free.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain);
    gain.connect(this.sfxBus);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  /** Filtered white-noise burst, used for impacts and the death sound. */
  noise({ duration = 0.3, volume = 0.4, filterFreq = 900, delay = 0 } = {}) {
    if (!this.soundEnabled || this.failed || !this.ctx) return;

    const now = this.ctx.currentTime + delay;
    const source = this.ctx.createBufferSource();
    source.buffer = this._getNoiseBuffer();

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(120, now + duration);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxBus);
    source.start(now);
    source.stop(now + duration);
  }

  _getNoiseBuffer() {
    if (this.noiseBuffer) return this.noiseBuffer;
    const length = Math.floor(this.ctx.sampleRate * 0.5);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buffer;
    return buffer;
  }

  // ------------------------------------------------------------------ sfx

  click()   { this.tone({ freq: 660, endFreq: 880, type: 'square', duration: 0.06, volume: 0.35 }); }

  coin() {
    this.tone({ freq: NOTE.E6, type: 'square', duration: 0.06, volume: 0.35 });
    this.tone({ freq: 1567.98, type: 'square', duration: 0.10, volume: 0.28, delay: 0.055 });
  }

  treasure() {
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6, NOTE.E6];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', duration: 0.16, volume: 0.42, delay: i * 0.065 });
    });
  }

  trapWarning() {
    this.tone({ freq: 190, endFreq: 130, type: 'sawtooth', duration: 0.14, volume: 0.22 });
  }

  trapActive() {
    this.noise({ duration: 0.12, volume: 0.25, filterFreq: 2600 });
  }

  /** Monster touches the player. */
  enemyHit() {
    this.tone({ freq: 220, endFreq: 70, type: 'sawtooth', duration: 0.28, volume: 0.45 });
    this.noise({ duration: 0.22, volume: 0.3, filterFreq: 1400 });
  }

  /** Generic death / game over sting. */
  death() {
    this.tone({ freq: 300, endFreq: 55, type: 'sawtooth', duration: 0.55, volume: 0.45 });
    this.noise({ duration: 0.45, volume: 0.32, filterFreq: 900 });
  }

  levelComplete() {
    const notes = [NOTE.C5, NOTE.E5, NOTE.G5, NOTE.C6];
    notes.forEach((f, i) => {
      this.tone({ freq: f, type: 'triangle', duration: 0.22, volume: 0.4, delay: i * 0.09 });
    });
    this.tone({ freq: NOTE.E6, type: 'square', duration: 0.3, volume: 0.22, delay: 0.36 });
  }

  timerTick() {
    this.tone({ freq: 1400, type: 'square', duration: 0.045, volume: 0.3 });
  }

  // ---------------------------------------------------------------- music

  startMusic() {
    this.musicPlaying = true;
    this.musicTimer = 0;
  }

  stopMusic() {
    this.musicPlaying = false;
  }

  /**
   * Advance the ambient music scheduler. Called from the game loop so music
   * pauses automatically whenever the game does.
   */
  update(dt) {
    if (!this.musicEnabled || !this.musicPlaying || this.failed || !this.ctx) return;

    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer += MUSIC_STEP_SECONDS;

    const freq = MUSIC_PATTERN[this.musicIndex % MUSIC_PATTERN.length];
    this.musicIndex++;

    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.5, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + MUSIC_STEP_SECONDS * 1.6);
    osc.connect(gain);
    gain.connect(this.musicBus);
    osc.start(now);
    osc.stop(now + MUSIC_STEP_SECONDS * 1.7);
  }
}
