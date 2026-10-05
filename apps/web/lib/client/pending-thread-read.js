// Share only running reads. Settled thread details are never cached here.
export function createPendingThreadReads() {
  const pending = new Map();
  return {
    read(scope, url, loader) {
      if (!scope) return Promise.reject(new Error("Authentication is not ready."));
      const key = JSON.stringify([scope, url]);
      if (pending.has(key)) return pending.get(key);
      const promise = Promise.resolve().then(loader);
      pending.set(key, promise);
      const cleanup = () => { if (pending.get(key) === promise) pending.delete(key); };
      promise.then(cleanup, cleanup);
      return promise;
    },
    clear() { pending.clear(); },
  };
}
export const pendingThreadReads = createPendingThreadReads();
