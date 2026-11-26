// Safe localStorage. Every access is in try/catch: private mode, disabled storage,
// full quota or corrupt JSON must never break the page. Values are JSON.

const PREFIX = "conga-hw:";

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function get(key, fallback = null) {
  try {
    const raw = storage()?.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function set(key, value) {
  try {
    storage()?.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(key) {
  try {
    storage()?.removeItem(PREFIX + key);
    return true;
  } catch {
    return false;
  }
}
