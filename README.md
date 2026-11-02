# Iceland News – Stremio addon

Watch Icelandic national TV news in Stremio, using only RÚV's own free, public streams.

- **Live:** RÚV, RÚV 2
- **On demand (series, one video per episode):** Fréttir (evening news, ~19:00), Fréttir with sign-language interpretation, Kastljós, Silfrið

The addon never downloads or re-hosts video. It resolves RÚV's own URLs at request time and hands them to Stremio. There is no proxy, VPN or geo-block workaround. RÚV's player API flags the US as `geoblock: true`, but the streams played from a US IP when tested (2 Nov 2026) and need no headers or tokens. If RÚV starts enforcing the block, `npm run healthcheck` will report FAIL and that source is simply unavailable.

## Run locally

Requires Node.js 18+. On Windows PowerShell, if scripts are blocked, use `npm.cmd` instead of `npm`.

```bash
npm install
npm start
```

Then open http://127.0.0.1:7000/manifest.json to confirm it loads. Set `PORT` to use another port.

## Install in Stremio

1. Start the addon (above).
2. In Stremio open **Addons** (puzzle icon), click **+ Add addon**, type the full address `http://127.0.0.1:7000/manifest.json` (keep `http://` and `:7000`) and click **Add**, then **Install**.
   Do not use a `stremio://` link: it is always converted to `https://` without the port and fails.
3. Live channels are in **Board/Discover → TV → "RÚV – Beint / Live"**. Programmes are in **Discover → Series → "RÚV – Fréttir og þættir"**.

Episodes are numbered oldest = 1, so the newest has the highest number. Use the season/episode sort toggle in the series page to see the newest first.

`127.0.0.1` only works on the computer running the addon. For phone and TV, deploy it (below).

## Known limitation: live channels inside Stremio

On-demand episodes play in Stremio (tested). The live RÚV / RÚV 2 streams are valid and play in a normal browser player, but Stremio's own local streaming server rejects live HLS ("Live media is not supported") and the Stremio player stalls on the loading screen. This is a Stremio limitation, not a geo-block.

Each live channel therefore offers two streams:
1. The direct HLS stream (works if your Stremio build plays it directly, e.g. some phone/TV apps; otherwise it stalls).
2. **Open on ruv.is (official player)**: opens RÚV's own live page in your browser. The URL is the `webUrl` field in `sources.json`.

You can also copy the live `.m3u8` URL printed by `npm run healthcheck` into VLC (Media → Open Network Stream), which plays it fine.

## Configure sources (no code changes)

Everything lives in [sources.json](sources.json). Restart the addon after editing.

- Remove a source: set `"enabled": false` (or delete the entry).
- `live[]`: `id`, `name`, `channel` (RÚV player channel name), `fallbackUrl` (used if the player API fails), `description`, `descriptionIs`, `logo`.
- `programs[]`: `id`, `name`, `programId` (omit it and the addon finds the current one by `searchText` + `slug`, which Kastljós needs because its ID changes each season), `description`, `descriptionIs`, `poster`.
- Optional `"headers": { ... }` on any source makes the addon send those request headers through Stremio (`notWebReady` + `proxyHeaders`). No current source needs this.
- `settings`: cache lifetimes (live 60 s, episodes 300 s, program IDs 1 h), request timeout, episodes per programme.

To find a new RÚV programme: search for it at ruv.is, then run a search against `https://www.ruv.is/gql/` or copy the numeric ID from its page URL (e.g. `/sjonvarp/spila/frettir/30762/...`).

## Health check

```bash
npm run healthcheck
```

For each enabled source it resolves the URL, fetches the master and variant playlists, and downloads the first video segment. It prints PASS/FAIL per source and exits with code 1 if any fail, so it also works in cron or CI. Failures at runtime are logged by the server as `BROKEN [source] reason`, and the addon keeps running.

## Deploy for free (phone and TV)

Stremio on phone/TV needs a public **HTTPS** URL. Install the final `https://…/manifest.json` in Stremio on each device (same account syncs addons).

### Option A: Beamup (Stremio's free addon host)

```bash
npm install -g beamup-cli
beamup
```

Follow the prompts (first run asks for an email and a GitHub-style setup, then deploys the current folder). It prints a URL like `https://<id>-<name>.baby-beamup.club/manifest.json`. Re-run `beamup` to update. See https://github.com/Stremio/stremio-beamup-cli for current instructions.

### Option B: Render (free web service)

1. Put this folder in a GitHub repository (include `package.json`, `package-lock.json`, `index.js`, `sources.json`, `lib/`; exclude `node_modules`).
2. On https://render.com create a **New → Web Service** and connect the repo.
3. Runtime **Node**, Build command `npm install`, Start command `npm start`, Instance type **Free**.
4. After deploy, your addon is at `https://<your-service>.onrender.com/manifest.json`. Render sets `PORT` automatically.
5. Free Render services sleep after ~15 minutes idle, so the first request after a pause can take 30–60 s. Reopen the addon or retry if a stream is empty at first.

### Install on phone/TV

In Stremio on each device: **Addons → search box → paste the HTTPS manifest URL → Install**. On TV apps without a keyboard, install from the phone or desktop while signed in to the same account and it syncs.

Note: the streams themselves go straight from RÚV's CDN to your device, not through the server. The server in the cloud is in a different country than you, but that doesn't matter for playback, since your device (in the US) fetches the video. RÚV's geo check happens on the video requests, so it applies to where you are watching.

## Not included

- **Alþingi:** althingi.is sits behind a bot check, and no official public stream could be verified.
- **Hringbraut, N4:** TV channels closed in 2023.
- **Sýn/Vísir:** Sýn ended its TV news (reported 31 Aug 2026); no free live stream was found.
- **Tíufréttir:** no episodes since July 2025.
