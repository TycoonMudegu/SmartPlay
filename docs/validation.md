# Validation results

Date: **30 October 2026**. Runtime: **Node.js v22.11.0**.

## Automated tests

`npm test`: **44 passed, 0 failed, 0 skipped**.

Coverage includes universal manifest installation; movie and episode requests; encoded series IDs; exact torrent file selection; simulated 720p/1080p/4K, H.264/HEVC/AV1, HDR and audio compatibility; slow/unstable/unknown networks; missing metadata; deduplication; low/zero seeders; invalid targets; provider outages, invalid JSON, excessive responses and disallowed redirects; retries; CORS; instance caches; optional legacy profiles; and safe request observation.

Fixtures are synthetic provider metadata. Simulated capability/network inputs exercise the engine directly and are never represented as detections by stock clients. Automated tests make no external provider requests.

## Local and live HTTP checks

```sh
npm run smoke -- http://localhost:8091 tt1254207
npm run smoke -- https://smartplay-639901963666.africa-south1.run.app tt1254207
npm run smoke -- https://smartplay-639901963666.africa-south1.run.app tt0898266:1:1
```

All passed. The film metadata check uses Big Buck Bunny; no video files were downloaded in any check.

| Check | Observed result |
| --- | --- |
| Local universal manifest and API version | HTTP 200, v0.3.0, no configuration required |
| Live `/manifest.json` | HTTP 200, `com.smartplay.universal`, v0.3.0 |
| Live `/api/info` | HTTP 200, capability and bandwidth detection both false |
| Live manifest with `Origin: https://web.stremio.com` | HTTP 200, `Access-Control-Allow-Origin: *` |
| Live browser `OPTIONS` preflight | HTTP 204, CORS enabled for GET/POST/OPTIONS |
| Local and live `/stream/movie/tt1254207.json` | HTTP 200, exactly one structurally valid playback target |
| Live `/stream/series/tt0898266:1:1.json` | HTTP 200, exactly one structurally valid episode target |
| Local live-provider diagnostics | 11 deduplicated candidates, 4 eligible, metadata runtime 10 minutes, no provider errors |

The same URL initially returned 404 before deployment. A subsequent check found the new manifest live. The repository's deployed source was committed as `16babf6` (`fixed automatic loading of movies`); the user confirmed GitHub triggers deployment. No separate Cloud Run deployment was performed from this workstation.

## Observed incoming request headers

With `LOG_REQUEST_HEADERS=1`, the local server logged the following actual incoming request from the Node smoke script. **This is a controlled Node request, not an Android TV, desktop or Stremio Web capture.**

```json
{
  "kind": "smartplay.request",
  "method": "GET",
  "resource": "stream",
  "headers": {"user-agent": "node", "accept": "*/*"},
  "stremioHeaderNames": [],
  "capabilitiesDetected": false,
  "viewerBandwidthMeasured": false
}
```

The observation test separately confirms that arbitrary `X-Stremio-*` headers do not become trusted capabilities and that cookies, authorization and URL secrets are omitted.

## Remaining validation

Actual playback and outgoing headers on Android TV and desktop have not been captured. No connected Cloud Run log access was available here. A valid torrent target does not prove the viewer can reach its peers or decode its media. Use the README's log observation procedure and test playback on each actual client. There is no claim that viewer throughput, HDR or audio output was measured.

## Follow-up: actual Stremio Web installation

After a user reported that direct browser navigation worked while installation failed, the official `https://web.stremio.com/` client was opened in a fresh isolated Microsoft Edge guest context (headless, version 156.0.4314.50). The direct add-on link loaded Smart Play v0.3.0 and displayed the Install button. Clicking Install completed and showed Smart Play under Installed add-ons with Uninstall and Share addon actions. No existing user account or browser profile was used or modified.

The browser also successfully performed a cross-origin fetch from the official web app to the live manifest. The [request observation](stremio-web-observation.json) records the actual client request and the header subset exposed during inspection. This validates the web installation flow in the clean test context. The cause of the user's failing session is still unconfirmed; browser extensions, stale session data and client-specific network restrictions are possibilities, not diagnosed causes.
