const { addonBuilder, serveHTTP } = require('stremio-addon-sdk');
const { loadConfig, resolveLive, listEpisodes } = require('./lib/ruv');
const log = require('./lib/log');

const cfg = loadConfig();
const live = cfg.live.filter(s => s.enabled !== false);
const programs = cfg.programs.filter(s => s.enabled !== false);

const PREFIX = 'ruvtv:';
const LIVE_PREFIX = PREFIX + 'live:';
const SERIES_PREFIX = PREFIX + 'series:';
const EP_PREFIX = PREFIX + 'ep:'; // ruvtv:ep:<programKey>:<episodeId>

const manifest = {
  id: cfg.addon.id,
  version: cfg.addon.version,
  name: cfg.addon.name,
  description: cfg.addon.description,
  logo: cfg.addon.logo,
  background: cfg.addon.background,
  resources: ['catalog', 'meta', 'stream'],
  types: ['tv', 'series'],
  idPrefixes: [PREFIX],
  catalogs: [
    { type: 'tv', id: 'ruv-live', name: 'RÚV – Beint / Live' },
    { type: 'series', id: 'ruv-news', name: 'RÚV – Fréttir og þættir / News & programmes' }
  ],
  behaviorHints: { configurable: false }
};

const both = (en, is) => (is ? `${en}\n\n${is}` : en);

function liveMeta(s) {
  return {
    id: LIVE_PREFIX + s.id,
    type: 'tv',
    name: s.name,
    poster: s.logo,
    logo: s.logo,
    posterShape: 'landscape',
    description: both(s.description, s.descriptionIs)
  };
}

// Prefer RÚV's own 16:9 programme image; fall back to the configured poster.
async function seriesMeta(p) {
  let image = p.poster;
  try {
    image = (await listEpisodes(cfg, p)).image || image;
  } catch (e) {
    log.broken(p.id, `could not load programme image: ${e.message}`);
  }
  return {
    id: SERIES_PREFIX + p.id,
    type: 'series',
    name: p.name,
    poster: image,
    posterShape: 'landscape',
    background: image,
    description: both(p.description, p.descriptionIs)
  };
}

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async ({ type, id }) => {
  log.info(`catalog ${type}/${id}`);
  if (type === 'tv' && id === 'ruv-live') return { metas: live.map(liveMeta), cacheMaxAge: 3600 };
  if (type === 'series' && id === 'ruv-news') return { metas: await Promise.all(programs.map(seriesMeta)), cacheMaxAge: 3600 };
  return { metas: [] };
});

builder.defineMetaHandler(async ({ type, id }) => {
  log.info(`meta ${type}/${id}`);
  try {
    if (type === 'tv' && id.startsWith(LIVE_PREFIX)) {
      const s = live.find(x => LIVE_PREFIX + x.id === id);
      return s ? { meta: liveMeta(s), cacheMaxAge: 3600 } : { meta: null };
    }
    if (type === 'series' && id.startsWith(SERIES_PREFIX)) {
      const p = programs.find(x => SERIES_PREFIX + x.id === id);
      if (!p) return { meta: null };
      const meta = await seriesMeta(p);
      try {
        const { episodes } = await listEpisodes(cfg, p);
        // Stremio lists episodes ascending by season/episode; number oldest=1 so the newest has the highest number.
        const ordered = [...episodes].sort((a, b) => a.firstrun.localeCompare(b.firstrun));
        meta.videos = ordered.map((e, i) => ({
          id: `${EP_PREFIX}${p.id}:${e.id}`,
          title: e.title,
          released: new Date(e.firstrun + (e.firstrun.endsWith('Z') ? '' : 'Z')).toISOString(),
          season: 1,
          episode: i + 1,
          thumbnail: e.image || undefined,
          overview: e.description || undefined
        }));
      } catch (e) {
        log.broken(p.id, `could not load episodes: ${e.message}`);
        meta.videos = [];
      }
      return { meta, cacheMaxAge: 300 };
    }
  } catch (e) {
    log.warn('meta handler error:', e.message);
  }
  return { meta: null };
});

builder.defineStreamHandler(async ({ type, id }) => {
  log.info(`stream ${type}/${id}`);
  try {
    if (type === 'tv' && id.startsWith(LIVE_PREFIX)) {
      const s = live.find(x => LIVE_PREFIX + x.id === id);
      if (!s) return { streams: [] };
      const r = await resolveLive(cfg, s);
      const streams = [makeStream(r.url, s.name + ' – Live', r.headers)];
      // Stremio's local server cannot transcode live HLS, so also offer RÚV's own player page.
      if (s.webUrl) streams.push({ externalUrl: s.webUrl, name: 'RÚV', title: `${s.name} – Open on ruv.is (official player)` });
      return { streams, cacheMaxAge: 30 };
    }
    if (type === 'series' && id.startsWith(EP_PREFIX)) {
      const [, , key, epId] = id.split(':');
      const p = programs.find(x => x.id === key);
      if (!p) return { streams: [] };
      let { episodes } = await listEpisodes(cfg, p);
      let ep = episodes.find(e => e.id === epId);
      if (!ep) ({ episodes } = await listEpisodes(cfg, p, 200)), (ep = episodes.find(e => e.id === epId));
      if (!ep) return { streams: [] };
      return { streams: [makeStream(ep.file, `${p.name} – ${ep.title}`, p.headers)], cacheMaxAge: 300 };
    }
  } catch (e) {
    log.broken(id, `stream resolve failed: ${e.message}`);
  }
  return { streams: [] };
});

function makeStream(url, title, headers) {
  const s = { url, title, name: 'RÚV' };
  if (headers && Object.keys(headers).length) {
    s.behaviorHints = { notWebReady: true, proxyHeaders: { request: headers } };
  }
  return s;
}

process.on('unhandledRejection', e => log.warn('unhandled rejection:', e && e.message));
process.on('uncaughtException', e => log.warn('uncaught exception:', e && e.message));

const port = Number(process.env.PORT) || 7000;
serveHTTP(builder.getInterface(), { port });
log.info(`Live: ${live.map(s => s.id).join(', ')} | Programs: ${programs.map(s => s.id).join(', ')}`);
