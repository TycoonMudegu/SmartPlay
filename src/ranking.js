/** Stream metadata is inferred from untrusted titles and is NOT verified media inspection. */
const clamp = (x, low, high) => Math.max(low, Math.min(high, x));

export function defaultConfig() {
  return {
    name: 'Family TV',
    internetMbps: 15,
    tvResolution: 2160,
    minimumResolution: 720,
    hdr: 'dolbyvision',
    audio: 'atmos',
    preferredLanguage: 'en',
    conservative: true,
    maxFileGB: 0,
    sources: [
      'https://torrentio.strem.fun/providers=yts,eztv,rarbg,1337x,thepiratebay,kickasstorrents,torrentgalaxy,magnetdl,horriblesubs,ext|qualityfilter=scr,cam,unknown,threed|limit=100/manifest.json'
    ]
  };
}

export function normaliseConfig(value = {}) {
  const d = defaultConfig();
  const c = {...d, ...value};
  c.name = String(c.name || d.name).trim().slice(0, 60);
  c.internetMbps = clamp(Number(c.internetMbps) || 15, 1, 1000);
  c.tvResolution = [720, 1080, 2160].includes(Number(c.tvResolution)) ? Number(c.tvResolution) : 1080;
  c.minimumResolution = [0, 720, 1080, 2160].includes(Number(c.minimumResolution)) ? Number(c.minimumResolution) : 0;
  c.hdr = ['none', 'hdr10', 'hdr10plus', 'dolbyvision'].includes(c.hdr) ? c.hdr : 'none';
  c.audio = ['stereo', 'surround', 'atmos'].includes(c.audio) ? c.audio : 'stereo';
  c.preferredLanguage = ['en', 'any'].includes(c.preferredLanguage) ? c.preferredLanguage : 'en';
  c.conservative = c.conservative !== false;
  c.maxFileGB = clamp(Number(c.maxFileGB) || 0, 0, 200);
  c.sources = Array.isArray(c.sources) ? [...new Set(c.sources.map(s => String(s).trim()).filter(Boolean))].slice(0, 6) : [];
  return c;
}

function readSizeGB(t) {
  const match = t.match(/💾\s*([\d,.]+)\s*(GiB|GB|MiB|MB|TB)/i) || t.match(/(?:size\s*[:=]\s*)([\d,.]+)\s*(GiB|GB|MiB|MB|TB)/i);
  if (!match) return null;
  const num = Number(match[1].replaceAll(',', ''));
  if (!Number.isFinite(num) || num <= 0) return null;
  const u = match[2].toUpperCase();
  return u === 'TB' ? num * 1000 : ['MB','MIB'].includes(u) ? num / 1000 : num;
}

export function inspectStream(stream) {
  const name = String(stream?.name || '');
  const title = String(stream?.title || stream?.description || '');
  const filename = String(stream?.behaviorHints?.filename || '');
  const group = String(stream?.behaviorHints?.bingeGroup || '');
  const combined = `${name} ${title} ${filename} ${group}`;
  // Prefer provider's explicit resolution field to avoid DS4K being mistaken for 2160p.
  let resolution = /(?:^|\W)(?:2160p|4k)(?:$|\W)/i.test(name) ? 2160 :
    /(?:^|\W)1080p(?:$|\W)/i.test(name) ? 1080 :
    /(?:^|\W)720p(?:$|\W)/i.test(name) ? 720 : 0;
  if (!resolution) resolution = /(?:^|\W)(?:2160p|4k|uhd)(?:$|\W)/i.test(combined) ? 2160 :
    /(?:^|\W)(?:1080p|fhd)(?:$|\W)/i.test(combined) ? 1080 :
    /(?:^|\W)720p(?:$|\W)/i.test(combined) ? 720 : 0;
  const dv = /(?:dolby.?vision|\bDoVi\b|\bDV\b)/i.test(combined);
  const hdr10plus = /hdr10\+/i.test(combined);
  const hdr = /\bhdr\b|\bhdr10\b|hdr10\+/i.test(combined);
  const atmos = /\batmos\b|\batmo\b/i.test(combined);
  const truehd = /truehd/i.test(combined);
  const ddp = /(?:\bddp\b|\bddp5\.1\b|\beac3\b|e-ac-3|dolby digital plus)/i.test(combined);
  const hevc = /\b(?:hevc|x265|h265|h\.265)\b/i.test(combined);
  const av1 = /\bav1\b/i.test(combined);
  const seedMatch = title.match(/👤\s*(\d[\d,]*)/) || title.match(/\b(?:seeders|seeds)\s*[:=]\s*(\d[\d,]*)/i);
  const seeders = seedMatch ? Number(seedMatch[1].replaceAll(',', '')) : null;
  const sizeGB = readSizeGB(title) ?? (Number(stream?.behaviorHints?.videoSize) > 0 ? Number(stream.behaviorHints.videoSize) / 1e9 : null);
  const suspect = /(?:\bCAM\b|\bTS\b|\bHDTS\b|\bSCR\b|screener|telesync)/i.test(combined);
  const isTorrent = /^[a-f\d]{40}$/i.test(stream?.infoHash || '');
  const direct = typeof stream?.url === 'string' && /^https?:\/\//i.test(stream.url);
  const valid = isTorrent || direct;
  const english = /🇬🇧|🇺🇸|\benglish\b|\beng\b/i.test(combined);
  const explicitForeign = /🇨🇿|🇮🇹|🇫🇷|🇷🇺|🇪🇸|🇵🇹|🇲🇽|\b(?:ita|cz|rus|french|spanish)\b/i.test(combined);
  return { resolution, dv, hdr10plus, hdr, atmos, truehd, ddp, hevc, av1, seeders, sizeGB, suspect, isTorrent, direct, valid, english, explicitForeign };
}

export function scoreStream(stream, rawConfig, {type='movie', runtimeMinutes} = {}) {
  const config = normaliseConfig(rawConfig);
  const m = inspectStream(stream);
  const reasons = [];
  if (!m.valid) return {eligible:false, score:-Infinity, reasons:['No playable URL or torrent hash'], metadata:m};
  if (m.suspect) reasons.push('Low-quality source label');
  if (m.resolution && m.resolution > config.tvResolution) return {eligible:false,score:-Infinity,reasons:['Above TV resolution'],metadata:m};
  if (m.resolution < config.minimumResolution) return {eligible:false,score:-Infinity,reasons:[m.resolution ? 'Below minimum resolution' : 'Unknown resolution does not meet minimum'],metadata:m};
  if (m.isTorrent && m.seeders === 0) return {eligible:false,score:-Infinity,reasons:['Zero reported peers'],metadata:m};
  if (m.sizeGB && config.maxFileGB && m.sizeGB > config.maxFileGB) return {eligible:false,score:-Infinity,reasons:['Above file size cap'],metadata:m};

  // Missing runtime uses a conservative estimate rather than assuming a long film.
  const minutes = clamp(Number(runtimeMinutes) || (type === 'series' ? 42 : 120), 10, 400);
  const mbps = m.sizeGB ? m.sizeGB * 8000 / (minutes * 60) : null;
  const budget = config.internetMbps * (config.conservative ? 0.72 : 0.85);
  if (mbps !== null && mbps > budget) {
    return {eligible:false,score:-Infinity,reasons:[`Estimated ${mbps.toFixed(1)} Mbps exceeds ${budget.toFixed(1)} Mbps budget`],metadata:{...m, estimatedMbps:mbps}};
  }
  let score = ({2160:110, 1080:70, 720:35})[m.resolution] ?? 10;
  if (m.resolution === 0) reasons.push('Resolution unknown');
  if (config.hdr !== 'none') {
    if (m.dv && config.hdr === 'dolbyvision') score += 24;
    else if (m.hdr10plus && ['dolbyvision','hdr10plus'].includes(config.hdr)) score += 20;
    else if (m.hdr || m.dv || m.hdr10plus) score += 13;
  }
  if (m.hevc || m.av1) score += 7;
  if (config.audio === 'atmos' && m.atmos) score += m.truehd ? 12 : 20;
  else if (config.audio !== 'stereo' && m.ddp) score += 6;
  if (m.direct) score += 15;
  if (m.seeders !== null) score += clamp(Math.log2(m.seeders+1) * 3, 0, 24);
  if (m.isTorrent && m.seeders === null) score -= 12;
  if (m.sizeGB === null) { score -= 18; reasons.push('File size unknown'); }
  if (m.suspect) score -= 80;
  if (config.preferredLanguage === 'en') {
    if (m.english) score += 5;
    else if (m.explicitForeign) score -= 6; // unknown language is not automatically rejected
  }
  // Avoid extreme low bitrate encodes; only an approximation of image fidelity.
  if (mbps !== null && m.resolution === 2160 && mbps < 5) score -= 8;
  return {eligible:true,score:Math.round(score*10)/10,reasons,metadata:{...m,estimatedMbps:mbps}};
}

function identity(stream) {
  if (stream.infoHash) return `torrent:${String(stream.infoHash).toLowerCase()}:${stream.fileIdx ?? ''}`;
  return `url:${stream.url}`;
}

export function rankStreams(streams, config, options={}) {
  const seen = new Set();
  const evaluations = [];
  for (const stream of Array.isArray(streams) ? streams.slice(0, 1000) : []) {
    if (!stream || typeof stream !== 'object') continue;
    const key = identity(stream);
    if (seen.has(key)) continue;
    seen.add(key);
    const assessment = scoreStream(stream, config, options);
    evaluations.push({stream, ...assessment});
  }
  evaluations.sort((a,b) => Number(b.eligible)-Number(a.eligible) || b.score - a.score);
  return evaluations;
}

export function selectedStream(streams, config, options={}) {
  const result = rankStreams(streams,config,options).find(s=>s.eligible);
  if (!result) return null;
  const stream = result.stream;
  // Preserve the exact playback identifiers and hints needed by the Stremio client.
  return {
    ...(stream.url ? {url:stream.url} : {}),
    ...(stream.infoHash ? {infoHash:stream.infoHash} : {}),
    ...(Number.isInteger(stream.fileIdx) ? {fileIdx:stream.fileIdx} : {}),
    ...(Array.isArray(stream.sources) ? {sources:stream.sources} : {}),
    ...(stream.behaviorHints ? {behaviorHints:stream.behaviorHints} : {}),
    ...(stream.subtitles ? {subtitles:stream.subtitles} : {}),
    name:'▶ Play',
    title:'Recommended for this TV'
  };
}
