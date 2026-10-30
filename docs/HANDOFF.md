# Continue on another computer

Smart Play v0.3.0 is a stateless Node.js Stremio add-on. Start with [README](../README.md), the [technical investigation](automatic-selection.md) and [validation results](validation.md).

## Setup

Install Git and Node.js 22 or 24, then:

```sh
git clone https://github.com/TycoonMudegu/SmartPlay.git
cd SmartPlay
npm test
npm start
```

There are no runtime dependencies to install. Open `http://localhost:8080`; the local manifest is `/manifest.json`.

## Current state

- The universal live manifest is `https://smartplay-639901963666.africa-south1.run.app/manifest.json`.
- The user confirmed GitHub pushes trigger deployment to the existing Cloud Run service, `smartplay`, in `africa-south1`.
- Mandatory device/household configuration has been removed. The public selector makes no device capability or viewer bandwidth detection claims. See the report before changing these assumptions.
- Source code, synthetic fixtures, 44 passing automated tests, smoke-check script and deployment instructions are in this repository.
- Live manifest, browser CORS, film and episode metadata checks passed on 30 October 2026. Media was not downloaded or decoded.
- The user now reports that everything works. An earlier Stremio Web installation failure was not root-caused; a fresh isolated Edge session had successfully installed the same manifest. The installation page now offers separate native-app and Stremio Web buttons.
- The user can play 18 GB files and asked whether Smart Play detects device capabilities. Public routes still receive no confirmed capability or bandwidth context and retain the 1080p / 5 Mbps estimated average bitrate policy. Playback success does not feed back into selection.
- The user reaffirmed that the add-on must work across many TVs and browsers with one universal installation. Device-specific setup or a single-TV client is not the target. The technical report now distinguishes missing capability reporting from player-local HLS adaptation; the latter is a possible experiment requiring adaptive source versions and client validation, not an implemented feature.
- Branding uses `public/logo.svg` as the editable vector source and favicon, with a 256×256 `public/logo.png` export for both universal and legacy manifest artwork. `PUBLIC_BASE_URL` optionally sets the canonical origin for artwork as well as profile links.
- Actual Android TV/desktop playback, native client headers and viewer throughput remain unverified. Cloud Run container logs were not accessible from the development workstation.

Temporary research clones and browser automation tools were kept outside the project and are not needed to run or test it. Cloud credentials and Stremio account credentials are not stored in this repository.
