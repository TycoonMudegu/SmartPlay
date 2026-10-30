# Smart Play v0.2

A lightweight, stateless Stremio stream-selector add-on, with a web configuration page and source deployment support for Google Cloud Run. It ranks streams from approved Stremio source add-ons and returns **one** recommended stream when an eligible stream exists.

This release replaces the file-backed profiles in v0.1 with self-contained, compressed configuration URLs. **No Firestore, database, Dockerfile, AI account or debrid service is required.** Google Cloud nevertheless builds and runs a container internally.

## What's included

- Web page with a 4K home cinema preset and an easy family viewing preset
- Configurable bandwidth, TV resolution, minimum resolution, HDR support, sound system, language preference and optional file-size cap
- Up to six server-approved source manifests
- One automatically ranked stream per film or television episode
- Source deduplication, bandwidth estimates and basic diagnostics
- Browser-based preview from a saved Torrentio JSON export
- Existing profile URL loader for editing configurations
- Direct Google Cloud Run source deployment and optional GitHub repository deployment
- No runtime third-party Node.js dependencies

## Set it up locally

Requires Node.js 20.11 or newer.

```bash
npm test
npm start
```

Open `http://localhost:8080` in a browser. This is for development. A TV on another network cannot connect to your computer's localhost address.

## Deploy on Google Cloud Run without Docker

1. Create or select a Google Cloud project with billing enabled.
2. Open Google Cloud Shell at <https://console.cloud.google.com/>.
3. Upload the `Smart Play Cloud Run.zip` archive to Cloud Shell using its Upload File control.
4. Run the following commands:

```bash
unzip 'Smart Play Cloud Run.zip' -d smart-play
cd smart-play
npm test
gcloud run deploy smart-play --source . --region africa-south1 --allow-unauthenticated --min-instances 0 --max-instances 2 --memory 256Mi
```

Respond to the prompts to enable the necessary Google APIs and set the project. The first deployment uses Google Cloud Build and buildpacks to turn source code into a container, automatically. You do **not** need Docker, a Dockerfile or a separately managed server. You may incur Google Cloud costs even at low volume.

The command prints a service URL such as `https://smart-play-xxxxx.run.app`. **The example is not a deployed endpoint.** Open the actual URL assigned to your service.

### Deploy from a GitHub repository instead

You can put these files at the root of a GitHub repository, then open **Google Cloud Run > Connect repository**. Select your repository and branch. Set the build type to **Node.js via Google Cloud's buildpacks** (not Dockerfile). The service must allow unauthenticated requests because Stremio accesses the manifest URL without Google Cloud authentication. Cloud Run can automatically redeploy on each new commit. The `npm start` script binds to `0.0.0.0` on the `PORT` provided by Cloud Run.

References:
- <https://docs.cloud.google.com/run/docs/deploying-source-code>
- <https://docs.cloud.google.com/run/docs/continuous-deployment>

## Install in Stremio

1. Open the Cloud Run service URL in your browser.
2. Choose a household profile and set its internet speed, display resolution, HDR and audio system.
3. Check the source manifest URL and generate the Smart Play installation link.
4. Copy the complete manifest URL (it ends in `/manifest.json`).
5. Open **Stremio > Add-ons** and paste the URL into the add-on installation field. You can also try the **Open in Stremio** button in the web configurator.
6. Remove directly installed source stream add-ons from the viewer's Stremio account if you want to avoid seeing their additional results. Smart Play's backend uses its own configured source URLs.

A typical link resembles:

```
https://your-actual-cloud-run-host.run.app/p/COMPRESSED-PROFILE/manifest.json
```

The entire profile is inside `COMPRESSED-PROFILE`. Stremio keeps the installed add-on URL in its account configuration. The Cloud Run app reads the URL whenever Stremio requests new streams. It needs to be available when a new title or episode is selected, but a compatible direct torrent or video source can continue playing without routing the film through Cloud Run.

## Edit a TV's settings

Paste the original Smart Play manifest URL into **Edit an existing profile** on the configurator, load the settings, adjust them and generate a **new** installation URL. You must replace the previous installation in Stremio. There is no database record or permanent edit link.

**Configuration URLs are not private or encrypted.** Do not enter debrid keys, source-provider tokens, passwords or confidential data. Restrict the allowed stream-provider hosts and only use media sources you are entitled to access.

## Cloud Run environment settings

- `PORT`: Cloud Run automatically sets the listening port, normally 8080.
- `ALLOWED_ADDON_HOSTS`: Comma-separated approved HTTPS provider hostnames. Defaults to `torrentio.strem.fun`. Add only hosts you trust. Never open this to arbitrary user-provided hosts.
- `PUBLIC_BASE_URL`: Optional fully qualified canonical origin for generated server-side links, if your proxy requires it. The browser configurator uses its actual origin.

This application stores no profile configuration on disk. It has a temporary per-instance in-memory results cache. Cloud Run can therefore scale to zero without losing profile settings.

## Design constraints

- **Not a custom player:** Stremio may still require clicking the one returned stream. The add-on cannot replace Stremio's film-page Play button or switch sources after playback fails.
- **Configured device capabilities:** Ordinary Stremio add-ons do not learn TV resolution, Atmos support or real-time connection speed automatically. Those values are configured manually.
- **Metadata heuristics:** Filename descriptions, peer counts and file sizes are not verified. Dolby Atmos is a preference, not an absolute requirement. The audio path must separately support the stream's audio track.
- **Network uncertainty:** Average bitrate is estimated from file size and film duration. Actual torrent speed varies with peers and bitrate peaks. A fast enough nominal connection does not guarantee uninterrupted playback.
- **No results if nothing qualifies:** A strict 4K profile can return zero streams even when 1080p results exist.
- **Provider dependency:** A source provider can rate-limit, fail, block Cloud Run egress or change its API. Smart Play does not make a provider more reliable.
- **Cloud costs:** Cloud Run scale-to-zero does not guarantee the total Google Cloud bill is zero. Cloud Build, Artifact Registry, network use and other services can incur charges.
- **Compatibility:** Supports Stremio movie and series streams with `tt`-prefixed IMDb IDs. Other metadata identifiers are not supported in this version.

## API endpoints

- `GET /` or `GET /configure` web configurator
- `GET /api/info` default settings and allowed provider hosts
- `POST /api/config` validates and encodes profile data without saving it
- `GET /api/profile/{token}` decodes profile data for editing
- `POST /api/preview` ranks user-supplied stream JSON
- `POST /api/test` tests live provider results for a given IMDb ID
- `GET /p/{token}/manifest.json` Stremio add-on manifest
- `GET /p/{token}/stream/movie/{imdbId}.json` one ranked film stream
- `GET /p/{token}/stream/series/{imdbId}:{season}:{episode}.json` one ranked episode stream
- `GET /healthz` health check

## Tests

```bash
npm test
```

The automated suite tests profiles, validation, manifest and stream URLs, selection ranking, API endpoints and mocked provider responses. External providers are not used during unit tests. Confirm actual connectivity to your chosen providers after deploying to Cloud Run.
