# Smart Play v0.3

One universal Stremio add-on installation. No household profiles, device settings, speed tests, accounts, AI services, debrid subscriptions or paid APIs are required. The Node.js service selects **one** stream when an eligible source exists; otherwise it returns an empty stream list.

## Install

Install the universal manifest:

**https://smartplay-639901963666.africa-south1.run.app/manifest.json**

Paste that link into Stremio's Add-ons search field and select Install. Every family member uses the same link. Alternatively, open the service homepage and select **Open in Stremio** for the installed app or **Open in Stremio Web** for the browser client. Open a film or episode and choose **▶ Play** under Smart Play. Stremio controls the film-page Play button; an add-on cannot automatically start every film.

Live verification on 30 October 2026: the production manifest returns HTTP 200 with version 0.3.0, browser preflight succeeds, and a live film metadata request returns one structurally valid stream. GitHub changes trigger deployment to the existing service. See the [validation results](docs/validation.md). Actual media playback and per-device compatibility remain separate checks.

## Run locally

Use Node.js 22 or 24. There are no runtime dependencies to install.

```sh
npm test
npm start
```

Open `http://localhost:8080`. The local manifest is `http://localhost:8080/manifest.json`. A TV on another network cannot access your computer's localhost URL.

If Windows PowerShell blocks `npm.ps1`, use `npm.cmd test` and `npm.cmd start`.

From another terminal:

```sh
npm run smoke -- http://localhost:8080
# Optional live provider metadata check, without downloading media:
npm run smoke -- http://localhost:8080 tt1254207
```

## How selection works

- Query up to six server-configured HTTPS Stremio providers concurrently. Torrentio's public manifest is the default; viewers do not configure providers.
- Discard invalid URLs, ambiguous playback targets and invalid torrent hashes or file indices. Keep different files in a torrent distinct. Series torrents must specify the episode's file index.
- Deduplicate identical playback targets, combine tracker discovery, and use conservative values when duplicate metadata conflicts.
- Treat format labels and provider hints as **unverified claims**. Filter labels associated with unsupported formats, HDR, camera recordings and 3D. Never claim a filename proves the actual media tracks.
- Without confirmed capabilities, use a compatibility policy of at most 1080p, H.264, SDR, AAC/MP3, up to 8-bit and 30fps when those properties are labeled. HEVC, AV1, HDR and advanced audio labels are excluded. Missing labels incur ranking penalties and remain an uncertain last resort.
- Estimate average bitrate as `bytes × 8 / runtimeSeconds / 1,000,000`. GB and GiB are distinct. Cinemeta runtime is used where available; missing runtime falls back to 90 minutes for films and 30 for episodes. Series runtime may itself be an estimate.
- With unknown bandwidth, use a **5 Mbps average bitrate policy**, with ceilings of 8 GB per film and 2 GB per episode. These are policy limits, not a measurement or promise about the viewer's connection. Unknown sizes receive a substantial penalty.
- Prefer higher resolution within these constraints, adequate reported seeders and smaller files of otherwise similar quality. Zero reported seeders are rejected; very few seeders receive a strong penalty. Neither a seed count nor an HTTP URL proves reachability or sustained speed.
- Preserve playback URLs, torrent file indices, tracker sources, proxy headers, subtitle hints and subtitles. A stable Smart Play binge group supports clients' next-episode selection.

The ranking engine accepts explicit capability/network context for simulations or a future verified integration. **The public stream routes never populate that context from User-Agent, guessed hardware, IP addresses, invented headers or arbitrary URL extras.** A known simulated decoder can select HEVC/AV1/4K; that does not claim stock Stremio sends these capabilities. Supplied throughput uses 60% of its value as an average bitrate budget, reduced to 40% for an explicitly unstable simulated link.

Read the [technical investigation](docs/automatic-selection.md) for client source references and detection limitations.

## Deploy to the existing Cloud Run service

Use Google Cloud Shell, or a terminal with authenticated `gcloud`. Work from this source directory. The service name is **smartplay**, in **africa-south1**. Deploying a differently named service creates a different installation URL.

In Cloud Shell (Bash), find and select the project associated with the existing service:

```bash
PROJECT_ID="$(gcloud projects describe 639901963666 --format='value(projectId)')"
gcloud config set project "$PROJECT_ID"
gcloud run services describe smartplay --region africa-south1 --format='value(status.url)'
```

Confirm the printed service URL is the existing Smart Play service. Then deploy these updated local sources, either by uploading them to Cloud Shell or by pushing this version to GitHub and pulling it there. Run tests before deploying:

```bash
npm test
gcloud run deploy smartplay --source . --region africa-south1 --allow-unauthenticated --min-instances 0 --max-instances 2 --memory 256Mi --port 8080 --timeout 30
npm run smoke -- https://smartplay-639901963666.africa-south1.run.app
```

If updating through an existing GitHub continuous-deployment connection, use the same service, branch and Node.js buildpacks build type. `npm start` listens on `0.0.0.0` and Cloud Run's `PORT`. No Dockerfile or database is needed. Google builds a container internally and may charge for builds, storage, logs and network use. See [Google's source deployment instructions](https://docs.cloud.google.com/run/docs/deploying-source-code).

Test a film and an episode from each actual Stremio client after deployment. A metadata smoke test validates the add-on contract; it does not decode media, test HDMI audio, or establish torrent connectivity from the viewer's network.

## Operator settings (optional)

| Variable | Purpose |
| --- | --- |
| `PORT` | Cloud Run sets this automatically; defaults to 8080 locally. |
| `ALLOWED_ADDON_HOSTS` | Comma-separated exact approved provider hostnames. Default: `torrentio.strem.fun`. Only add trusted public hosts. Redirects are checked too. |
| `SOURCE_MANIFEST_URLS` | JSON array of one to six approved HTTPS manifest URLs, shared by all viewers. Default: `["https://torrentio.strem.fun/manifest.json"]`. |
| `LOG_REQUEST_HEADERS` | Set to `1` temporarily to inspect an allowlist of incoming headers. No capability detection is enabled by this flag. |
| `PUBLIC_BASE_URL` | Optional canonical origin used for manifest artwork and legacy profile URLs. |

Provider URLs can contain commas; use a JSON array, not a comma-separated URL list. For Cloud Run, put settings in an environment YAML file to avoid shell escaping:

```yaml
ALLOWED_ADDON_HOSTS: "torrentio.strem.fun"
SOURCE_MANIFEST_URLS: '["https://torrentio.strem.fun/manifest.json"]'
LOG_REQUEST_HEADERS: "0"
```

Pass that file with `--env-vars-file` if desired, taking care to include any existing variables that must be retained. Do not place provider credentials in a public configuration URL. Providers requiring subscriptions, NZB servers or archive extraction are outside this selector's supported playback targets.

## Inspect actual client requests

Temporarily enable observation on the existing service:

```bash
gcloud run services update smartplay --region africa-south1 --update-env-vars LOG_REQUEST_HEADERS=1
```

Install the universal manifest in Android TV, desktop and web, then open a film and an episode on each device. Read the resulting structured logs:

```bash
gcloud logging read 'resource.type="cloud_run_revision" AND resource.labels.service_name="smartplay" AND jsonPayload.kind="smartplay.request"' --freshness=30m --limit=50 --format=json
gcloud run services update smartplay --region africa-south1 --update-env-vars LOG_REQUEST_HEADERS=0
```

Observation logs include User-Agent, Accept, Origin, selected client hints if present, and the **names** of `X-Stremio-*` headers. They omit IP addresses, authorization, cookies, full request URLs, query strings and profile tokens. User-Agent can itself contain a device model. No per-device record is stored. Cloud Run's own request logging has its own retention and fields; see [Cloud Run logging](https://docs.cloud.google.com/run/docs/logging).

Cloud Run container logs were not accessible from this workstation. A follow-up check loaded the official Stremio Web client in a fresh isolated Edge guest session, observed its request to the live manifest and successfully installed Smart Play in that temporary session. The [request observation](docs/stremio-web-observation.json) records a header subset. Actual Android TV and desktop requests remain unverified. Automated unit tests exercise server-side observation using controlled Node HTTP requests, clearly identified as such.

## API and compatibility

| Endpoint | Result |
| --- | --- |
| `GET /manifest.json` | Universal public Stremio manifest; configuration is not required. |
| `GET /stream/movie/{imdbId}.json` | One selected stream, or `streams: []`. |
| `GET /stream/series/{imdbId}:{season}:{episode}.json` | One selected episode stream, or `streams: []`. URL-encoded colons also work. |
| `GET /`, `/configure` | Installation page. |
| `GET /healthz`, `/api/info` | Local health / version and honest detection status. |
| `POST /api/preview` | Rank supplied JSON: `{ "streams": [...], "runtimeMinutes": 120, "type": "movie" }`. No profile needed. |
| `POST /api/test` | Query configured providers: `{ "id": "tt1254207", "type": "movie" }`. No profile needed. |

The old `/p/{token}/manifest.json`, stream routes, `/api/config` and `/api/profile/{token}` remain for migration, with stricter compatibility ranking. They are optional and are no longer presented in the installation UI. Install the universal URL and remove the old profile installation to avoid duplicate Smart Play results. Directly installed provider add-ons can also contribute their own additional streams.

Caches contain only temporary upstream results per instance, with bounded size and short stream lifetimes. There is no persistent viewer state. Cold starts or scaling to zero lose no required information.

## Limits

A universal installation URL does not mean all devices support all media. Current add-on requests expose no confirmed display, codec, HDR, HDMI audio or viewer bandwidth information. Browser-only Stremio may need a connected Stremio streaming service for torrents and non-web-ready files. Selecting a stream cannot add a decoder, provide a missing local torrent engine, force another audio track, transcode media, or automatically switch a running player after failure.

Exactly one guaranteed playable stream for every title, best possible quality for every unknown device, and automatic viewer-speed adaptation cannot be guaranteed by this backend. Ineligible, unavailable or unsupported-only results correctly produce zero streams. See the [report](docs/automatic-selection.md) for what requires client changes.

## Tests

`npm test` runs deterministic ranking and local HTTP integration tests. General synthetic film and episode fixtures cover simulated codecs/HDR/audio, resolutions, connection speeds and stability, provider outages, weak sources, duplicate metadata, invalid targets, incomplete metadata, universal installation, CORS, encoded series requests, caching and opt-in header observation. No paid service or live provider is used in automated tests.
