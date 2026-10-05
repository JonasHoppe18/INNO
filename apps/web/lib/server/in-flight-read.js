const STATE_KEY = Symbol.for("sona.in-flight-scoped-reads");
const clients = globalThis[STATE_KEY] || (globalThis[STATE_KEY] = new WeakMap());

// Share only work that is still running on the same transport and identity.
// Successful results and failures are removed before the next caller reads.
export function shareInFlightRead(client, key, loader) {
  let pending = clients.get(client);
  if (!pending) { pending = new Map(); clients.set(client, pending); }
  if (pending.has(key)) return pending.get(key);
  const promise = Promise.resolve().then(loader);
  pending.set(key, promise);
  const cleanup = () => { if (pending.get(key) === promise) pending.delete(key); };
  promise.then(cleanup, cleanup);
  return promise;
}
