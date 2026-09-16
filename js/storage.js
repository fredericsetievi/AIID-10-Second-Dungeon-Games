/**
 * storage.js
 * Thin, defensive wrapper around localStorage.
 *
 * The game must never crash because storage is unavailable (private mode,
 * disabled cookies, quota exceeded, file:// restrictions). Every access is
 * wrapped in try/catch; when storage is unusable we silently fall back to an
 * in-memory cache so the session still works, it just will not persist.
 */

const STORAGE_KEY = 'tenSecondDungeon.save.v1';

/** Default values used whenever storage is empty or corrupt. */
const DEFAULTS = Object.freeze({
  bestScore: 0,
  highestLevel: 1,
  soundEnabled: true,
  musicEnabled: false,
});

const NUMERIC_KEYS = ['bestScore', 'highestLevel'];

let cache = { ...DEFAULTS };
let available = true;
let loaded = false;

/** Read the raw JSON string, or null when storage is unreadable. */
function readRaw() {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    available = false;
    return null;
  }
}

/** Write the raw JSON string. Returns true on success. */
function writeRaw(value) {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
    return true;
  } catch (err) {
    available = false;
    return false;
  }
}

/** Coerce anything we read into a valid save object. */
function sanitise(raw) {
  const result = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return result;

  for (const key of NUMERIC_KEYS) {
    const value = Number(raw[key]);
    if (Number.isFinite(value) && value >= 0) result[key] = Math.floor(value);
  }
  if (typeof raw.soundEnabled === 'boolean') result.soundEnabled = raw.soundEnabled;
  if (typeof raw.musicEnabled === 'boolean') result.musicEnabled = raw.musicEnabled;
  return result;
}

/** Load persisted data into the cache. Safe to call more than once. */
export function load() {
  if (loaded) return cache;
  loaded = true;

  const raw = readRaw();
  if (!raw) return cache;

  try {
    cache = sanitise(JSON.parse(raw));
  } catch (err) {
    // Corrupt JSON: keep defaults and overwrite the bad entry on next save.
    cache = { ...DEFAULTS };
  }
  return cache;
}

/** Read a single value (loads lazily on first use). */
export function get(key) {
  if (!loaded) load();
  return cache[key];
}

/** Write a single value and persist immediately. */
export function set(key, value) {
  if (!loaded) load();
  cache[key] = value;
  writeRaw(JSON.stringify(cache));
  return value;
}

export function getAll() {
  if (!loaded) load();
  return { ...cache };
}

/**
 * Merge new run results into the saved records.
 * Returns which records were beaten so the UI can celebrate them.
 */
export function submitRun(score, levelReached) {
  if (!loaded) load();
  const safeScore = Number.isFinite(score) ? Math.max(0, Math.floor(score)) : 0;
  const safeLevel = Number.isFinite(levelReached) ? Math.max(1, Math.floor(levelReached)) : 1;

  const newBestScore = safeScore > cache.bestScore;
  const newHighestLevel = safeLevel > cache.highestLevel;

  if (newBestScore) cache.bestScore = safeScore;
  if (newHighestLevel) cache.highestLevel = safeLevel;
  if (newBestScore || newHighestLevel) writeRaw(JSON.stringify(cache));

  return { newBestScore, newHighestLevel };
}

/** True when localStorage is actually usable in this environment. */
export function isAvailable() {
  if (!loaded) load();
  return available;
}
