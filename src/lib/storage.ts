/** localStorage wrappers that never throw (private mode, quota, disabled storage). */

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

/** Returns false if the value could not be stored (e.g. quota exceeded). */
export function save(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export function remove(key: string) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export const KEYS = {
  session: 'medtests.session.v1',
  uploads: 'medtests.uploads.v1',
  prefs: 'medtests.prefs.v1',
}
