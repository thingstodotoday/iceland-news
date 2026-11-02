// Tests every enabled source in sources.json: resolve URL -> master playlist -> variant playlist -> first video segment.
// Exit code 0 = all OK, 1 = at least one source failed.
const { loadConfig, resolveLive, listEpisodes } = require('./lib/ruv');

const cfg = loadConfig();
const T = cfg.settings.requestTimeoutMs;

async function get(url, headers, asBytes) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), T);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0 (stremio-iceland-news healthcheck)', ...headers, ...(asBytes ? { Range: 'bytes=0-1023' } : {}) } });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} for ${url}`);
    return asBytes ? Buffer.from(await res.arrayBuffer()) : await res.text();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timeout for ${url}` : e.message);
  } finally {
    clearTimeout(timer);
  }
}

const firstUri = text => text.split(/\r?\n/).find(l => l.trim() && !l.startsWith('#'));
const abs = (u, base) => new URL(u, base).toString();

// Follows a master playlist down to the first media segment and checks it is MPEG-TS / fMP4 data.
async function checkHls(url, headers) {
  let text = await get(url, headers);
  if (!text.startsWith('#EXTM3U')) throw new Error('not an HLS playlist');
  let base = url;
  if (text.includes('#EXT-X-STREAM-INF')) {
    base = abs(firstUri(text), base);
    text = await get(base, headers);
    if (!text.startsWith('#EXTM3U')) throw new Error('variant is not an HLS playlist');
  }
  const seg = firstUri(text);
  if (!seg) throw new Error('playlist has no segments');
  const bytes = await get(abs(seg, base), headers, true);
  if (!bytes.length) throw new Error('empty segment');
  return bytes[0] === 0x47 ? 'MPEG-TS segment OK' : `segment OK (${bytes.length}B)`;
}

(async () => {
  const results = [];
  const run = async (name, fn) => {
    const t0 = Date.now();
    try {
      const detail = await fn();
      results.push({ name, ok: true, detail, ms: Date.now() - t0 });
    } catch (e) {
      results.push({ name, ok: false, detail: e.message, ms: Date.now() - t0 });
    }
  };

  for (const s of cfg.live.filter(x => x.enabled !== false)) {
    await run(`live/${s.id}`, async () => {
      const r = await resolveLive(cfg, s);
      return `${r.url} -> ${await checkHls(r.url, s.headers)}`;
    });
  }
  for (const p of cfg.programs.filter(x => x.enabled !== false)) {
    await run(`program/${p.id}`, async () => {
      const { programId, episodes } = await listEpisodes(cfg, p);
      const e = episodes[0];
      return `program ${programId}, ${episodes.length} episodes, newest "${e.title}" (${e.firstrun}) -> ${await checkHls(e.file, p.headers)}`;
    });
  }

  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(22)} ${String(r.ms).padStart(5)}ms  ${r.detail}`);
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} sources healthy`);
  process.exit(failed ? 1 : 0);
})();
