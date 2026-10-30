# Automatic selection: technical findings

Investigated on **30 October 2026**. Conclusion: a shared installation URL and conservative automatic ranking are implementable today. Reliable per-device optimization and automatic viewer bandwidth measurement are not available through the inspected standard stream request implementation.

## Evidence inspected

Inspected the actual repositories, not only the issue proposal:

| Component | Revision inspected | Relevant implementation |
| --- | --- | --- |
| Add-on SDK, master | `7c1986052570df688c83017c4a4e1601f4af07f1` | [`getRouter.js`](https://github.com/Stremio/stremio-addon-sdk/blob/7c1986052570df688c83017c4a4e1601f4af07f1/src/getRouter.js), [`builder.js`](https://github.com/Stremio/stremio-addon-sdk/blob/7c1986052570df688c83017c4a4e1601f4af07f1/src/builder.js), [protocol](https://github.com/Stremio/stremio-addon-sdk/blob/7c1986052570df688c83017c4a4e1601f4af07f1/docs/protocol.md) |
| Shared Rust core, development | `3417c2e7ed45cdbfd86b3226f69814c2dc4947ad` | [HTTP add-on transport](https://github.com/Stremio/stremio-core/blob/3417c2e7ed45cdbfd86b3226f69814c2dc4947ad/src/addon_transport/http_transport/http_transport.rs), [request types](https://github.com/Stremio/stremio-core/blob/3417c2e7ed45cdbfd86b3226f69814c2dc4947ad/src/types/addon/request.rs) |
| Web, development | `c34935cc36e28c00ec15f066c38bbc6f6f59f716` | [Player statistics](https://github.com/Stremio/stremio-web/blob/c34935cc36e28c00ec15f066c38bbc6f6f59f716/src/routes/Player/useStatistics.ts); browser requests go through the [core's WebEnv](https://github.com/Stremio/stremio-core/blob/3417c2e7ed45cdbfd86b3226f69814c2dc4947ad/stremio-core-web/src/env.rs) |
| Desktop shell | `c3a8bcbf857d5569b6ae7444ead0dc0a0814888b` | [Shell source](https://github.com/Stremio/stremio-shell/tree/c3a8bcbf857d5569b6ae7444ead0dc0a0814888b); media playback integration is distinct from the add-on transport |
| Video integration | `7a7462bedfa51dc8303fbc4f59f16e03d0badb85` | [Browser codec checks](https://github.com/Stremio/stremio-video/blob/7a7462bedfa51dc8303fbc4f59f16e03d0badb85/src/mediaCapabilities.js), [local streaming-server negotiation](https://github.com/Stremio/stremio-video/blob/7a7462bedfa51dc8303fbc4f59f16e03d0badb85/src/withStreamingServer/withStreamingServer.js) |
| Android/Kotlin public bridge | `2a8083f1026603e7c49f104473340d110902a72c` | [Rust/reqwest fetch implementation](https://github.com/Stremio/stremio-core-kotlin/blob/2a8083f1026603e7c49f104473340d110902a72c/stremio-core-kotlin/src/commonMain/rust/env/fetch.rs) |

The npm registry and published SDK tarball were checked separately: `latest` is **1.6.10**. Its builder dispatches `{type, id, extra, config}` and does not include the development branch's named `definePlayerHandler` / `defineLibraryHandler` methods. Development documentation therefore must not be treated as proof that every released client sends the newer events.

The core builds an ordinary `GET /stream/{type}/{id}.json`, optionally with URL-encoded extras, and sets no capability or throughput headers there. The SDK router passes path data to the handler; it does not pass the Node HTTP request or headers. A custom Node server, such as Smart Play, can inspect raw headers, but cannot derive absent capability data from them.

For web, browser codec checks feed local player/streaming-server probe and transcoding decisions. Player download statistics likewise come from the user's configured streaming server. These are **not forwarded to stream add-ons** in the inspected transport. The desktop shell's media integration does not establish a capability channel to add-ons either.

For Android TV, the public Kotlin/Rust bridge was inspectable and adds no hardware capability report in the examined fetch path. A complete official Android TV app source tree and a running APK were not available here. These findings establish the public protocol/bridge behavior; they are not a claim to have audited every proprietary client binary. Platform-specific outgoing headers still need real-device capture.

## What an ordinary stream add-on can know

| Property | Directly available | Estimate or unavailable |
| --- | --- | --- |
| Requested content | Resource, content type, film ID or series ID/season/episode; optional extras and manually configured URL data | IDs identify content, not the viewer's device. |
| OS and device model | Raw header strings if a client happens to send them | User-Agent may suggest OS, client or a model. It is optional, mutable and may describe a browser or intermediary. No confirmed hardware identity. |
| Display resolution / refresh rates | No standard fields in inspected stream requests | Not reliably inferable from OS/model. No display query can run inside an ordinary add-on response. |
| HEVC / AV1 / H.264 support | No negotiated decoder list | Model guesses cannot establish codec profile, level, bit depth, hardware acceleration or actual selected player's decoder. |
| HDR10 / HDR10+ / Dolby Vision | No display/player HDR report | HDR formats and Dolby Vision profiles are not interchangeable. A DV/HDR filename does not prove a usable fallback layer. |
| Atmos / E-AC-3 / TrueHD / DTS output | No audio-route or passthrough report | Codec decoding, selected track, stereo downmix and HDMI/eARC/receiver support are separate questions. A TV model alone cannot resolve them. |
| Viewer download speed / stability | No supported stream-request throughput measurement | Optional network client hints are estimates, not a reliable source-to-viewer speed test. Request latency measures neither download capacity nor torrent swarm throughput. |
| Source format and availability | Provider claims: size hints, release labels, reported seeders and playback targets | Labels, runtime and seed counts are estimates. Actual codecs/tracks require media probing; seeders do not prove availability or speed. |
| Playback feedback | Development core supports declared `player` events | Only action, current time and duration; no throughput, buffering, error reason, decoder capabilities or stable device ID. Release/platform adoption unverified. |

Native APIs could collect some device information **inside a modified client**: for example Android's [MediaCodecList](https://developer.android.com/reference/android/media/MediaCodecList) and [Display.HdrCapabilities](https://developer.android.com/reference/android/view/Display.HdrCapabilities). Those APIs do not run on Cloud Run and do not make their output available to existing add-ons.

Browser [MediaCapabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaCapabilities/decodingInfo) describes the browser doing the check, not a family member's Android TV or a different native player. A configuration webpage cannot silently and accurately profile all devices sharing its installation URL. Browser [downlink](https://developer.mozilla.org/en-US/docs/Web/API/NetworkInformation/downlink) is an estimate with limited availability; it is not a continuous bandwidth guarantee.

## Feature request #1909 and playback events

[#1909](https://github.com/Stremio/stremio-features/issues/1909) was opened on 5 September 2026 and was still **open** when checked through GitHub's API. It proposes normalized video/audio/HDR capabilities and an anonymous client identifier. Its example payload and `X-Stremio-Device-ID` are proposals, not implemented protocol contracts. The September 25 comment describes the same compatibility problem in a Jellyfin bridge. No inspected stream transport implements the proposed payload.

There is a separate, newer [player event design](https://github.com/Stremio/stremio-addon-sdk/blob/7c1986052570df688c83017c4a4e1601f4af07f1/docs/api/requests/definePlayerHandler.md). The [core constructs events](https://github.com/Stremio/stremio-core/blob/3417c2e7ed45cdbfd86b3226f69814c2dc4947ad/src/models/common/addon_events.rs) using `action`, `currentTime` and `duration`. Add-ons' responses cannot control playback. These events arrive after selection, can concern streams from other add-ons, and provide no reliable identity or network measurement. Pause/stop must not be interpreted as buffering or failure. Smart Play consequently does not subscribe to watch-activity events that cannot improve its stateless selection.

## Bandwidth strategy

There is no confirmed standard path for a stream add-on to run a viewer-side speed test or receive player throughput before returning a stream. A Cloud Run download test measures **Cloud Run's** network. An installation-page speed test measures that browser at that moment, can be on a different device/network, and introduces a separate interaction. Fetching or probing a candidate URL from Cloud Run likewise cannot establish viewer throughput.

The implementation therefore uses a 5 Mbps **average bitrate ceiling**, a 1080p compatibility ceiling and modest file-size limits when nothing is known. These are explicit engineering defaults, not inferred capabilities. Bitrate estimates use runtime and file size and leave uncertainty about VBR peaks, competing traffic, Wi-Fi quality and source supply. Missing metadata is penalized. A lower-bandwidth viewer may still buffer; a capable fast viewer may receive less than their maximum quality. Those are unavoidable tradeoffs without client negotiation.

## HTTP inspection and validation boundary

Direct requests to the existing service returned `/manifest.json` → 404 and `/api/info` → 200 with v0.2 household-profile defaults before this change. After the repository was committed and deployed through the existing GitHub connection, the live manifest returned 200 with v0.3.0, CORS preflight succeeded and a film request returned one structurally valid stream. These checks used a Node HTTP client, not a Stremio player. See [validation results](validation.md).

The new server can observe an allowlist of the **actual incoming** headers with `LOG_REQUEST_HEADERS=1`. Automated HTTP tests verify that observation against controlled Node requests, omit sensitive fields and show detection remains unknown even when a request contains speculative capability headers. They also verify encoded series IDs and the one-stream response contract. General synthetic fixtures are used following the clarification that an Avatar-specific fixture is unnecessary.

A subsequent follow-up used the official Stremio Web client in a fresh isolated Edge guest session. It fetched the live manifest and successfully installed Smart Play. A [client request observation](stremio-web-observation.json) records the request and a header subset; it is explicitly identified as a headless browser session. This confirms that the live manifest is accepted by Stremio Web and that cross-origin fetching works in that clean session. It does not identify why installation fails in the user's browser session. No Android TV or desktop session or Cloud Run container-log access was available. **Native client captures, actual media decoding and viewer throughput remain unverified.** The README contains the deployment/log-reading procedure to complete those captures. Controlled Node observations are labeled separately.

## What requires Stremio client changes

- Send a versioned capability report for the active player: resolution/frame-rate/codec profile and bit-depth limits, HDR profiles, and current audio route/decoding/passthrough support. Re-evaluate it when the display, output route or external player changes.
- Send fresh viewer-side throughput and buffering/error telemetry, with privacy-preserving per-session correlation if feedback should influence later requests. Local streaming-server statistics alone need an explicit supported reporting channel.
- Support requesting an alternative after a failed stream, or negotiating adaptive alternatives. A stateless add-on that returned one target cannot switch a client already playing it.

Until those exist, Smart Play can return one **likely suitable** target or an empty list. It cannot guarantee a playable stream for every title/device/network, infer actual codecs from labels, add missing browser torrent support, or achieve each unknown device's maximum quality.
