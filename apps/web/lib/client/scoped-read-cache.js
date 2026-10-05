// Browser memory only. Account, session and organization are part of every key.
export function createScopedReadCache({ maxAgeMs = 15000, maxEntries = 20, maxValueChars = 1000000, now = Date.now } = {}) {
  const entries = new Map();
  const keyFor = (scope, resource) => JSON.stringify([scope, resource]);
  const remove = (key) => {
    const entry = entries.get(key);
    entry?.controller?.abort();
    entries.delete(key);
  };
  const get = (scope, resource) => {
    if (!scope) return undefined;
    const key = keyFor(scope, resource);
    const entry = entries.get(key);
    if (!entry || entry.value === undefined) return undefined;
    if (now() - entry.updatedAt >= maxAgeMs) {
      if (!entry.promise) remove(key);
      return undefined;
    }
    return entry.value;
  };
  const load = (scope, resource, loader, { force = false } = {}) => {
    if (!scope) return Promise.reject(new Error("Authentication is not ready."));
    const key = keyFor(scope, resource);
    if (force) remove(key);
    const cached = get(scope, resource);
    if (cached !== undefined) return Promise.resolve(cached);
    const existing = entries.get(key);
    if (existing?.promise) return existing.promise;
    while (entries.size >= maxEntries) remove(entries.keys().next().value);
    const entry = { controller: new AbortController() };
    entries.set(key, entry);
    entry.promise = Promise.resolve().then(() => loader(entry.controller.signal)).then((value) => {
      if (entry.controller.signal.aborted || entries.get(key) !== entry) {
        const error = new Error("Read invalidated.");
        error.name = "AbortError";
        throw error;
      }
      if (JSON.stringify(value)?.length > maxValueChars) {
        entries.delete(key);
        return value;
      }
      entry.value = value;
      entry.updatedAt = now();
      entry.promise = null;
      return value;
    }).catch((error) => {
      if (entries.get(key) === entry) remove(key);
      throw error;
    });
    return entry.promise;
  };
  return {
    get, load,
    invalidate(scope, resource) { remove(keyFor(scope, resource)); },
    clear() { for (const key of entries.keys()) remove(key); },
  };
}
export const scopedReadCache = createScopedReadCache();
