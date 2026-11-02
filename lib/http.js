const log = require('./log');

const cache = new Map(); // key -> { value, expires }

async function fetchText(url, timeoutMs, headers = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (stremio-iceland-news)', ...headers }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timeout after ${timeoutMs}ms for ${url}` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Cached lookup. If a refresh fails, a stale value is served when one exists.
async function cached(key, ttlSeconds, loader, sourceName) {
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  try {
    const value = await loader();
    cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
    return value;
  } catch (e) {
    if (hit) {
      log.warn(`[${sourceName}] refresh failed (${e.message}); serving stale cache`);
      return hit.value;
    }
    throw e;
  }
}

module.exports = { fetchText, cached };
