import {deflateRawSync, inflateRawSync} from 'node:zlib';
import crypto from 'node:crypto';
import {normaliseConfig} from './ranking.js';

const MAX_TOKEN_LENGTH = 3400;
const MAX_UNCOMPRESSED = 10000;
const MAX_SOURCES = 6;

// Only the server operator controls permitted upstream hostnames.
export const allowedHosts = new Set(String(process.env.ALLOWED_ADDON_HOSTS || 'torrentio.strem.fun')
  .split(',').map(host => host.trim().toLowerCase()).filter(Boolean));

export function checkSource(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('Invalid source manifest URL'); }
  if (url.protocol !== 'https:' || url.username || url.password ||
      (url.port && url.port !== '443') || !allowedHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Source must use HTTPS on an approved host: ' + [...allowedHosts].join(', '));
  }
  if (!url.pathname.endsWith('/manifest.json') || url.hash) {
    throw new Error('Source URL must end in /manifest.json with no fragment');
  }
  if (/(?:^|[?&])(?:api[_-]?key|token|password|secret)=/i.test(url.search)) {
    throw new Error('Do not put API keys or other credentials into a shareable installation link');
  }
  return url;
}

export function validateProfile(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected a configuration object');
  const c = normaliseConfig(raw);
  if (!c.sources.length) throw new Error('Add at least one stream source manifest');
  if (c.sources.length > MAX_SOURCES) throw new Error('Too many stream sources');
  if (c.minimumResolution > c.tvResolution) throw new Error('Minimum resolution exceeds the TV resolution');
  c.sources.forEach(checkSource);
  return c;
}

// Compression keeps installation URLs shorter. The token is not encryption or a secret.
export function encodeProfile(raw) {
  const json = JSON.stringify({v:2,c:validateProfile(raw)});
  if (Buffer.byteLength(json) > MAX_UNCOMPRESSED) throw new Error('Configuration is too large');
  const token = deflateRawSync(Buffer.from(json)).toString('base64url');
  if (token.length > MAX_TOKEN_LENGTH) throw new Error('Installation URL is too long. Reduce the source URLs');
  return token;
}

export function decodeProfile(token) {
  if (typeof token !== 'string' || token.length < 10 || token.length > MAX_TOKEN_LENGTH || !/^[a-zA-Z0-9_-]+$/.test(token)) {
    throw new Error('Invalid installation profile');
  }
  try {
    const bytes = inflateRawSync(Buffer.from(token, 'base64url'), {maxOutputLength: MAX_UNCOMPRESSED});
    const profile = JSON.parse(bytes.toString('utf8'));
    if (profile?.v !== 2) throw new Error('Unsupported profile version');
    return validateProfile(profile.c);
  } catch (e) {
    if (/^(Source|Do not|Add at|Minimum|Unsupported)/.test(e.message)) throw e;
    throw new Error('Invalid installation profile');
  }
}

export function profileId(token) {
  return crypto.createHash('sha256').update(token).digest('hex').slice(0,24);
}

export function sourceStreamUrl(source, type, id) {
  const url = checkSource(source);
  url.pathname = url.pathname.slice(0, -'/manifest.json'.length) + '/stream/' +
    encodeURIComponent(type) + '/' + encodeURIComponent(id) + '.json';
  return url.href;
}
