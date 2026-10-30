/** Provider metadata and release labels are claims, never a verified media probe. */
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));
const reportsKey = Symbol('duplicate reports');
const baselineVideo = ['h264'];
const baselineAudio = ['aac', 'mp3'];

export function defaultConfig() {
  return {
    name: 'Smart Play', internetMbps: null, tvResolution: 1080, minimumResolution: 0,
    hdr: 'none', audio: 'stereo', preferredLanguage: 'en', conservative: true,
    maxFileGB: 0, sources: ['https://torrentio.strem.fun/manifest.json']
  };
}

// Retained for optional v0.2 profile URLs. Universal playback uses defaultConfig().
export function normaliseConfig(value = {}) {
  const c = {...defaultConfig(), ...value};
  const speed = Number(c.internetMbps);
  c.internetMbps = Number.isFinite(speed) && speed > 0 ? clamp(speed, 0.1, 1000) : null;
  c.name = String(c.name || 'Smart Play').trim().slice(0, 60);
  c.tvResolution = [720, 1080, 2160].includes(Number(c.tvResolution)) ? Number(c.tvResolution) : 1080;
  c.minimumResolution = [0, 720, 1080, 2160].includes(Number(c.minimumResolution)) ? Number(c.minimumResolution) : 0;
  c.hdr = ['none', 'hdr10', 'hdr10plus', 'dolbyvision'].includes(c.hdr) ? c.hdr : 'none';
  c.audio = ['stereo', 'surround', 'atmos'].includes(c.audio) ? c.audio : 'stereo';
  c.preferredLanguage = c.preferredLanguage === 'any' ? 'any' : 'en';
  c.maxFileGB = clamp(Number(c.maxFileGB) || 0, 0, 200);
  c.sources = Array.isArray(c.sources) ? [...new Set(c.sources.map(String).map(s => s.trim()).filter(Boolean))].slice(0, 6) : [];
  return c;
}

function labels(stream) {
  return [stream.name, stream.title, stream.description, stream.behaviorHints?.filename]
    .filter(v => typeof v === 'string').map(v => v.slice(0, 5000)).join(' ');
}

function sizes(text) {
  return [...text.matchAll(/(?:💾|\bsize\s*[:=])\s*([\d,.]+)\s*(TiB|TB|GiB|GB|MiB|MB)\b/gi)]
    .map(m => Number(m[1].replaceAll(',', '')) * ({TB: 1e12, TIB: 2 ** 40, GB: 1e9, GIB: 2 ** 30, MB: 1e6, MIB: 2 ** 20})[m[2].toUpperCase()])
    .filter(n => Number.isFinite(n) && n > 0);
}

function peers(stream) {
  if (typeof stream.seeders === 'number' && Number.isFinite(stream.seeders) && stream.seeders >= 0) return Math.floor(stream.seeders);
  const match = labels(stream).match(/(?:👤|\b(?:seeders|seeds)\s*[:=])\s*(\d[\d,]*(?:\.\d+)?)\s*(k\b)?/i);
  return match ? Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1) : null;
}

function resolution(text) {
  return /(?:^|\W)(?:2160p|4k|uhd)(?:$|\W)/i.test(text) ? 2160 :
    /\b(?:1080p|fhd)\b/i.test(text) ? 1080 : /\b720p\b/i.test(text) ? 720 : /\b480p\b/i.test(text) ? 480 : 0;
}

export function playbackIdentity(stream) {
  if (!stream || typeof stream !== 'object' || Array.isArray(stream)) return null;
  if (stream.url !== undefined && stream.infoHash !== undefined) return null;
  if (stream.infoHash !== undefined) {
    if (typeof stream.infoHash !== 'string' || !/^[a-f\d]{40}$/i.test(stream.infoHash)) return null;
    if (stream.fileIdx !== undefined && (!Number.isSafeInteger(stream.fileIdx) || stream.fileIdx < 0)) return null;
    return `torrent:${stream.infoHash.toLowerCase()}:${stream.fileIdx ?? 'largest'}`;
  }
  if (typeof stream.url !== 'string' || stream.url.length > 16000 || /[\s\u0000-\u001f]/.test(stream.url)) return null;
  try {
    const url = new URL(stream.url);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? `url:${url.href}` : null;
  } catch { return null; }
}

export function inspectStream(stream) {
  const reports = stream?.[reportsKey] || [stream || {}];
  const text = reports.map(labels).join(' ');
  const resolutions = reports.map(s => resolution(String(s.name || '')) || resolution(labels(s))).filter(Boolean);
  const videoCodecs = [
    ['h264', /\b(?:h[. -]?264|x264|avc)\b/i],
    ['hevc', /\b(?:hevc|x265|h[. -]?265)\b/i], ['av1', /\bav1\b/i],
    ['vp9', /\bvp9\b/i], ['mpeg2', /\bmpeg[. -]?2\b/i], ['mpeg4', /\b(?:xvid|divx)\b/i]
  ].filter(([, re]) => re.test(text)).map(([codec]) => codec);
  const hdrFormats = [
    ['dolbyvision', /\bdolby[ ._-]?vision\b|\bdovi\b|\bdv\b/i],
    ['hdr10plus', /\bhdr10\+/i], ['hdr10', /\bhdr(?:10)?\b(?!\+)/i], ['hlg', /\bhlg\b/i]
  ].filter(([, re]) => re.test(text)).map(([format]) => format);
  const audioCodecs = [
    ['truehd', /\btrue[ ._-]?hd\b/i], ['dtshd', /\bdts[ ._-]?(?:hd|ma|x)\b/i],
    ['dts', /\bdts\b(?![ ._-]?(?:hd|ma|x))/i], ['eac3', /\b(?:ddp|e[ ._-]?ac[ ._-]?3|dolby digital plus)(?:\b|\d)/i],
    ['ac3', /(?<!e[ ._-]?)\bac[ ._-]?3\b|\bdd(?:5[ .]1|\b(?!p))/i],
    ['aac', /\baac(?:\b|\d)/i], ['mp3', /\bmp3\b/i], ['flac', /\bflac\b/i], ['opus', /\bopus\b/i]
  ].filter(([, re]) => re.test(text)).map(([codec]) => codec);
  const sizeReports = reports.flatMap(s => {
    const bytes = s.behaviorHints?.videoSize;
    return [...sizes(labels(s)), ...(typeof bytes === 'number' && Number.isFinite(bytes) && bytes > 0 ? [bytes] : [])];
  });
  const seedReports = reports.map(peers).filter(n => n !== null);
  const fpsMatch = text.match(/\b(\d{2,3}(?:\.\d+)?)\s*fps\b/i);
  return {
    valid: playbackIdentity(stream) !== null,
    isTorrent: typeof stream?.infoHash === 'string', direct: typeof stream?.url === 'string',
    resolution: resolutions.length ? Math.max(...resolutions) : 0,
    videoCodecs, audioCodecs, hdrFormats,
    bitDepth: /\b12[ ._-]?bit\b/i.test(text) ? 12 : /\b(?:10[ ._-]?bit|hi10p|main[ ._-]?10)\b/i.test(text) ? 10 : null,
    frameRate: fpsMatch ? Number(fpsMatch[1]) : null,
    atmos: /\batmos\b/i.test(text),
    seeders: seedReports.length ? Math.min(...seedReports) : null,
    sizeGB: sizeReports.length ? Math.max(...sizeReports) / 1e9 : null,
    suspect: /\b(?:cam|hdcam|hdts|telesync|screener|scr|telecine|tc|ts)\b/i.test(text),
    threeD: /\b(?:3d|hsbs|hou)\b/i.test(text),
    english: /🇬🇧|🇺🇸|\b(?:english|eng)\b/i.test(text),
    explicitForeign: /🇨🇿|🇮🇹|🇫🇷|🇷🇺|🇪🇸|\b(?:ita|rus|french|spanish)\b/i.test(text),
    evidence: 'unverified-provider-metadata'
  };
}

/** Internal simulation/integration inputs, NOT fields reported by stock Stremio clients. */
function selectionPolicy(rawConfig, {capabilities, network} = {}) {
  const c = normaliseConfig(rawConfig);
  const knownSpeed = Number(network?.downloadMbps) > 0 && Number.isFinite(Number(network.downloadMbps))
    ? Number(network.downloadMbps) : c.internetMbps;
  const hdrFormats = capabilities?.hdrFormats ?? (c.hdr === 'none' ? [] : [c.hdr]);
  const audioCodecs = capabilities?.audioCodecs ?? (c.audio === 'stereo' ? baselineAudio : [...baselineAudio, 'ac3', 'eac3']);
  return {
    config: c, maxResolution: capabilities?.maxResolution ?? c.tvResolution,
    videoCodecs: capabilities?.videoCodecs ?? baselineVideo, hdrFormats, audioCodecs,
    maxVideoBitDepth: capabilities?.maxVideoBitDepth ?? 8,
    maxFrameRate: capabilities?.maxFrameRate ?? 30,
    atmos: capabilities?.atmos === true,
    budgetMbps: knownSpeed ? knownSpeed * (network?.stable === false ? 0.4 : 0.6) : 5,
    bandwidthBasis: knownSpeed ? (network ? 'supplied-context' : 'manual-legacy-profile') : 'policy-default-unmeasured',
    unknownBandwidth: !knownSpeed
  };
}

export function scoreStream(stream, rawConfig = defaultConfig(), options = {}) {
  const p = selectionPolicy(rawConfig, options);
  const m = inspectStream(stream);
  const reasons = [];
  const reject = reason => ({eligible: false, score: -Infinity, reasons: [reason], metadata: m});
  if (!m.valid) return reject('Invalid or ambiguous playback target');
  if (options.type === 'series' && m.isTorrent && !Number.isInteger(stream.fileIdx)) return reject('Episode torrent requires an explicit file index');
  if (m.suspect || m.threeD) return reject('Camera, screener or 3D release label');
  if (m.isTorrent && m.seeders === 0) return reject('Zero reported seeders');
  if (m.resolution > p.maxResolution) return reject('Above the resolution policy');
  if (m.resolution < p.config.minimumResolution) return reject('Below the optional minimum resolution');
  if (m.videoCodecs.some(codec => !p.videoCodecs.includes(codec))) return reject('Video codec label outside supported policy');
  if (m.hdrFormats.some(format => !p.hdrFormats.includes(format))) return reject('HDR label outside supported policy');
  if (m.audioCodecs.some(codec => !p.audioCodecs.includes(codec))) return reject('Audio codec label outside supported policy');
  if (m.atmos && !m.audioCodecs.length && !p.atmos) return reject('Atmos label without a supported base audio codec');
  if (m.bitDepth && m.bitDepth > p.maxVideoBitDepth) return reject('Bit depth label outside supported policy');
  if (m.frameRate && m.frameRate > p.maxFrameRate) return reject('Frame rate label outside supported policy');

  const suppliedRuntime = Number(options.runtimeMinutes);
  const runtimeKnown = Number.isFinite(suppliedRuntime) && suppliedRuntime >= 1 && suppliedRuntime <= 600;
  const minutes = runtimeKnown ? suppliedRuntime : options.type === 'series' ? 30 : 90;
  const mbps = m.sizeGB === null ? null : m.sizeGB * 8000 / (minutes * 60);
  Object.assign(m, {estimatedMbps: mbps, runtimeMinutes: minutes, runtimeBasis: runtimeKnown ? 'metadata' : 'fallback',
    budgetMbps: p.budgetMbps, bandwidthBasis: p.bandwidthBasis});
  const sizeCap = p.config.maxFileGB || (p.unknownBandwidth ? (options.type === 'series' ? 2 : 8) : 0);
  if (sizeCap && m.sizeGB > sizeCap) return reject('Above the conservative file size ceiling');
  if (mbps !== null && mbps > p.budgetMbps) return reject('Estimated average bitrate exceeds the selection budget');

  let score = ({2160: 95, 1080: 65, 720: 40, 480: 15})[m.resolution] ?? 0;
  if (!m.videoCodecs.length) { score -= 25; reasons.push('Video codec unknown'); }
  if (!m.audioCodecs.length) { score -= 8; reasons.push('Audio codec unknown'); }
  if (!m.resolution) reasons.push('Resolution unknown');
  if (m.sizeGB === null) { score -= 45; reasons.push('Size and bitrate unknown'); }
  if (!runtimeKnown) reasons.push('Runtime estimated conservatively');
  if (m.direct) score += 8;
  if (m.isTorrent) {
    if (m.seeders === null) { score -= 20; reasons.push('Source availability unknown'); }
    else {
      score += clamp(Math.log2(m.seeders + 1) * 3, 0, 25);
      if (m.seeders < 5) { score -= 65; reasons.push('Very few reported seeders'); }
      else if (m.seeders < 15) score -= 20;
    }
  }
  if (mbps !== null) score -= 10 * mbps / p.budgetMbps;
  if (m.resolution === 2160 && mbps !== null && mbps < 4) score -= 20;
  if (p.config.preferredLanguage === 'en') score += m.english ? 5 : m.explicitForeign ? -10 : 0;
  return {eligible: true, score: Math.round(score * 10) / 10, reasons, metadata: m};
}

export function rankStreams(streams, config = defaultConfig(), options = {}) {
  const groups = new Map();
  for (const stream of Array.isArray(streams) ? streams.slice(0, 3000) : []) {
    const key = playbackIdentity(stream);
    if (!key) continue;
    const group = groups.get(key) || [];
    group.push(stream);
    groups.set(key, group);
  }
  const ranked = [...groups.values()].map(reports => {
    const stream = {...reports[0], [reportsKey]: reports};
    if (stream.infoHash) stream.infoHash = stream.infoHash.toLowerCase();
    stream.behaviorHints = Object.assign({}, ...reports.map(s => s.behaviorHints && typeof s.behaviorHints === 'object' && !Array.isArray(s.behaviorHints) ? s.behaviorHints : {}));
    if (reports.some(s => s.behaviorHints?.notWebReady)) stream.behaviorHints.notWebReady = true;
    if (stream.infoHash) stream.sources = [...new Set(reports.flatMap(s => Array.isArray(s.sources) ? s.sources.filter(v => typeof v === 'string') : []))];
    return {stream, ...scoreStream(stream, config, options)};
  });
  return ranked.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || playbackIdentity(a.stream).localeCompare(playbackIdentity(b.stream)));
}

export function selectedStream(streams, config = defaultConfig(), options = {}) {
  const result = rankStreams(streams, config, options).find(s => s.eligible);
  if (!result) return null;
  const {stream, metadata: m} = result;
  const hints = {...stream.behaviorHints, bingeGroup: 'smartplay-auto-v1'};
  if (stream.url && (stream.url.startsWith('http:') || !/\.mp4(?:[?#]|$)/i.test(stream.url) || hints.proxyHeaders)) hints.notWebReady = true;
  return {
    ...(stream.url ? {url: stream.url} : {infoHash: stream.infoHash}),
    ...(stream.infoHash && Number.isInteger(stream.fileIdx) ? {fileIdx: stream.fileIdx} : {}),
    ...(stream.infoHash && stream.sources?.length ? {sources: stream.sources} : {}),
    ...(Array.isArray(stream.subtitles) ? {subtitles: stream.subtitles} : {}),
    behaviorHints: hints, name: '▶ Play',
    title: `Automatically selected${m.resolution ? ` · ${m.resolution}p` : ''}`
  };
}
