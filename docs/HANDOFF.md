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
- The user could open the manifest JSON but reported installation failing in their Stremio Web browser session. A fresh isolated Edge session successfully installed the same manifest through the official Stremio Web client. The user's specific browser failure remains undiagnosed; do not claim it is fixed or assume an extension is responsible.
- The direct web installation link uses `https://web.stremio.com/#/addons?addon=` followed by the URL-encoded manifest URL. The user was asked to try it in a private window while signed into their Stremio account; the outcome has not yet been reported.
- Actual Android TV/desktop playback, native client headers and viewer throughput remain unverified. Cloud Run container logs were not accessible from the development workstation.

Temporary research clones and browser automation tools were kept outside the project and are not needed to run or test it. Cloud credentials and Stremio account credentials are not stored in this repository.
