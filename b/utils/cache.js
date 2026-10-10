const cache = new Map();
const inflight = new Map();

function getCache(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() > item.expiresAt) {
    cache.delete(key);
    return null;
  }

  return item.value;
}

function setCache(key, value, ttlMs = 30_000) {
  // Bound memory even when clients search for many distinct phrases.
  if (cache.size >= 1000 && !cache.has(key)) cache.delete(cache.keys().next().value);
  cache.set(key, {
    value,
    expiresAt: Date.now() + ttlMs,
  });
}

function deleteCache(key) {
  cache.delete(key);
  // Detach older reads so a mutation cannot repopulate stale data.
  inflight.delete(key);
}

function remember(key, fn, ttlMs = 2000) {
  const cached = getCache(key);
  if (cached !== null) return Promise.resolve(cached);
  if (inflight.has(key)) return inflight.get(key);
  const promise = Promise.resolve().then(fn).then(value => {
    if (inflight.get(key) === promise) setCache(key, value, ttlMs);
    return value;
  }).finally(() => {
    if (inflight.get(key) === promise) inflight.delete(key);
  });
  inflight.set(key, promise);
  return promise;
}

module.exports = {
  getCache,
  setCache,
  deleteCache,
  remember,
};
