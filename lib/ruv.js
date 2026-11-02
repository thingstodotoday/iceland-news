const fs = require('fs');
const path = require('path');
const { fetchText, cached } = require('./http');
const log = require('./log');

const CONFIG_PATH = path.join(__dirname, '..', 'sources.json');
const loadConfig = () => JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

async function gql(cfg, query, variables) {
  const url = cfg.settings.gqlApi + '?' + new URLSearchParams({ query, variables: JSON.stringify(variables) });
  const body = JSON.parse(await fetchText(url, cfg.settings.requestTimeoutMs));
  if (body.errors) throw new Error('GraphQL error: ' + body.errors[0].message);
  return body.data;
}

// Live: ask RÚV's own player endpoint for the current URL; fall back to the last known URL.
async function resolveLive(cfg, src) {
  return cached(`live:${src.id}`, cfg.settings.cacheTtlSeconds.live, async () => {
    try {
      const j = JSON.parse(await fetchText(cfg.settings.geoApi + src.channel, cfg.settings.requestTimeoutMs));
      if (!j.url || !/^https:\/\/.+\.m3u8/.test(j.url)) throw new Error('no m3u8 url in response');
      return { url: j.url, headers: src.headers };
    } catch (e) {
      if (!src.fallbackUrl) throw e;
      log.broken(src.id, `player API failed (${e.message}); using fallbackUrl from sources.json`);
      return { url: src.fallbackUrl, headers: src.headers };
    }
  }, src.id);
}

const SEARCH_Q = 'query($type:SearchQueryType!,$text:String!){Search(type:$type,text:$text){id slug}}';
const LATEST_Q = 'query($p:Int!){Program(id:$p){episodes(limit:1){firstrun}}}';

// Some shows get a new program ID every season: pick the matching one with the newest episode.
async function resolveProgramId(cfg, prog) {
  if (prog.programId) return prog.programId;
  return cached(`pid:${prog.id}`, cfg.settings.cacheTtlSeconds.programId, async () => {
    const d = await gql(cfg, SEARCH_Q, { type: 'tv', text: prog.searchText });
    const ids = [...new Set(d.Search.filter(s => s.slug === prog.slug).map(s => Number(s.id)))];
    if (!ids.length) throw new Error(`search "${prog.searchText}" found no program with slug "${prog.slug}" (site changed?)`);
    let best = null;
    for (const id of ids) {
      const r = await gql(cfg, LATEST_Q, { p: id });
      const fr = r.Program && r.Program.episodes[0] && r.Program.episodes[0].firstrun;
      if (fr && (!best || fr > best.fr)) best = { id, fr };
    }
    if (!best) throw new Error('no candidate program had episodes');
    return best.id;
  }, prog.id);
}

const EPISODES_Q = 'query($p:Int!,$l:Int){Program(id:$p){title description image image_og episodes(limit:$l){id title description firstrun duration image file file_expires}}}';

async function listEpisodes(cfg, prog, limit = cfg.settings.episodesPerProgram) {
  return cached(`eps:${prog.id}:${limit}`, cfg.settings.cacheTtlSeconds.episodes, async () => {
    const pid = await resolveProgramId(cfg, prog);
    const d = await gql(cfg, EPISODES_Q, { p: pid, l: limit });
    if (!d.Program) throw new Error(`program ${pid} not found`);
    const eps = (d.Program.episodes || []).filter(e => e.file && /^https:\/\/.+\.m3u8/.test(e.file));
    if (!eps.length) throw new Error(`program ${pid} returned no playable episodes (site changed?)`);
    const image = d.Program.image_og || d.Program.image || (eps[0] && eps[0].image) || null;
    return { programId: pid, title: d.Program.title, image, episodes: eps };
  }, prog.id);
}

module.exports = { loadConfig, resolveLive, resolveProgramId, listEpisodes };
