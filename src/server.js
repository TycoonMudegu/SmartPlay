import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultConfig, rankStreams, selectedStream} from './ranking.js';
import {allowedHosts, checkSource, decodeProfile, encodeProfile, profileId, sourceStreamUrl, validateProfile} from './profiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const VERSION = '0.3.0';

function json(res, status, value, maxAge=0) {
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':'*',
    'Cache-Control':maxAge ? `public, max-age=${maxAge}` : 'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer'
  });
  res.end(JSON.stringify(value));
}
const error = (res,status,message) => json(res,status,{error:message});
const publicBaseUrl = req => String(process.env.PUBLIC_BASE_URL || new URL(req.headers.host ?
  `${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}` : 'http://localhost').origin).replace(/\/$/,'');
function rateLimit(req, requests) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0];
  for (const [k,v] of requests) if (v.exp < now) requests.delete(k);
  const record = requests.get(ip) || {exp: now + 60_000, count:0};
  record.count++;
  requests.set(ip, record);
  if (requests.size > 2000) requests.delete(requests.keys().next().value);
  return record.count <= 25;
}
async function body(req, maxBytes=180_000) {
  const parts=[];
  let count=0;
  for await (const chunk of req) {
    count += chunk.length;
    if (count > maxBytes) throw new Error('Request body is too large');
    parts.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  }
  catch { throw new Error('Invalid JSON request body'); }
}
function validRemote(url) {
  if (url.hostname === 'v3-cinemeta.strem.io' && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')) return true;
  return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) &&
    !url.username && !url.password && (!url.port || url.port === '443');
}
async function fetchJson(fetchFn, input, {limit=2_600_000, timeout=7_000}={}) {
  let current = new URL(input);
  const signal = AbortSignal.timeout(timeout);
  for (let i=0; i<3; i++) {
    if (!validRemote(current)) throw new Error('Disallowed upstream host');
    const response = await fetchFn(current.href, {
      redirect:'manual', headers:{'Accept':'application/json','User-Agent':`SmartPlay/${VERSION}`}, signal
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      await response.body?.cancel();
      if (!next) throw new Error('Upstream redirect has no location');
      current = new URL(next, current);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('Upstream HTTP ' + response.status);
    }
    const chunks=[]; let bytes=0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes>limit) throw new Error('Upstream response too large');
      chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  throw new Error('Too many redirects');
}
function cached(cache, key, ttl, producer) {
  const found = cache.get(key);
  if (found && found.exp > Date.now()) return found.value;
  const pending = Promise.resolve().then(producer);
  cache.set(key, {exp:Date.now()+ttl,value:pending});
  pending.catch(()=>cache.delete(key));
  if (cache.size > 900) cache.delete(cache.keys().next().value);
  return pending;
}
function parseRuntime(value) {
  if (typeof value === 'number' && value > 0 && value < 500) return value;
  const s = String(value ?? '').toLowerCase();
  if (/^\d+$/.test(s)) return Number(s);
  const hour = s.match(/(\d+)\s*h(?:ours?|rs?)?/);
  const min = s.match(/(\d+)\s*m(?:in(?:utes?)?)?/);
  return hour || min ? Number(hour?.[1] || 0)*60 + Number(min?.[1] || 0) : null;
}
async function runtime(fetchFn,cache,type,id) {
  const base = id.split(':')[0];
  return cached(cache, 'runtime:'+type+':'+base, 6*3600_000, async()=>{
    try {
      const info = await fetchJson(fetchFn, `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(base)}.json`, {timeout:3000});
      return parseRuntime(info?.meta?.runtime);
    } catch { return null; }
  });
}
async function collect(fetchFn, cache, config, type, id) {
  const outcome = await Promise.allSettled(config.sources.map(source => {
    const url = sourceStreamUrl(source,type,id);
    return cached(cache, 'streams:'+url, 120_000, async()=>{
      const response = await fetchJson(fetchFn,url);
      if (!Array.isArray(response?.streams)) throw new Error('Invalid upstream stream response');
      return response.streams.slice(0,500);
    });
  }));
  return {
    streams:outcome.flatMap(v => v.status === 'fulfilled' ? v.value : []),
    errors:outcome.flatMap((v,i) => v.status === 'rejected' ? [`${new URL(config.sources[i]).hostname}: ${v.reason?.message || 'Unavailable'}`] : [])
  };
}
function manifest(baseUrl, token, config=defaultConfig()) {
  return {
    id:token ? 'com.smartplay.family.' + profileId(token) : 'com.smartplay.universal',
    version:VERSION,
    name:token ? 'Smart Play · ' + config.name : 'Smart Play',
    logo:`${baseUrl}/logo.png`,
    description:'One automatically selected stream for films and episodes. Install and play; no setup required.',
    resources:[{name:'stream',types:['movie','series'],idPrefixes:['tt']}],
    types:['movie','series'], idPrefixes:['tt'], catalogs:[],
    behaviorHints:{p2p:true, configurable:false, configurationRequired:false}
  };
}
async function staticFile(res,filename,mime) {
  const content = await fs.readFile(path.join(ROOT,'public',filename));
  res.writeHead(200,{'Content-Type':mime,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  res.end(content);
}
const diagnostics = (ranked, more={})=>({
  ...more, total:ranked.length, eligible:ranked.filter(v=>v.eligible).length,
  selected:ranked.find(v=>v.eligible)?.stream?.title || null,
  top:ranked.slice(0,15).map(v=>({title:String(v.stream.title || v.stream.name || '').slice(0,300),
    eligible:v.eligible, score:v.eligible?v.score:null, reasons:v.reasons, metadata:v.metadata}))
});

export function serverConfig(env=process.env) {
  const config = defaultConfig();
  if (env.SOURCE_MANIFEST_URLS) {
    let sources;
    try { sources = JSON.parse(env.SOURCE_MANIFEST_URLS); }
    catch { throw new Error('SOURCE_MANIFEST_URLS must be a JSON array'); }
    if (!Array.isArray(sources) || !sources.length || sources.length > 6 || sources.some(s => typeof s !== 'string')) {
      throw new Error('SOURCE_MANIFEST_URLS must contain one to six manifest URLs');
    }
    config.sources = [...new Set(sources.map(s => s.trim()))];
  }
  config.sources.forEach(checkSource);
  return config;
}

function logRequest(req, log) {
  // Explicit allowlist: never log IPs, cookies, authorization, query strings or profile tokens.
  const headers = Object.fromEntries(['user-agent','accept','origin','sec-ch-ua-platform','downlink','rtt','ect','save-data']
    .filter(k => req.headers[k] !== undefined).map(k => [k, String(req.headers[k]).slice(0,300)]));
  log({kind:'smartplay.request',method:req.method,resource:req.url.includes('/stream/')?'stream':'manifest',headers,
    stremioHeaderNames:Object.keys(req.headers).filter(k=>k.startsWith('x-stremio-')),
    capabilitiesDetected:false,viewerBandwidthMeasured:false});
}

const validId = (type,id) => type==='series' ? /^tt\d{5,12}:\d{1,4}:\d{1,4}$/.test(id) : /^tt\d{5,12}$/.test(id);

export function createServer({fetchFn=fetch, config=serverConfig(), logHeaders=process.env.LOG_REQUEST_HEADERS==='1', log=entry=>console.log(JSON.stringify(entry))}={}) {
  const cache = new Map();
  const requests = new Map();
  config = validateProfile(config);
  return http.createServer(async(req,res)=>{
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'});
        return res.end();
      }
      let pathname;
      try { pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname); }
      catch { return error(res,400,'Invalid request URL'); }
      if (logHeaders && req.method==='GET' && (pathname.endsWith('/manifest.json') || pathname.includes('/stream/'))) logRequest(req,log);
      if (req.method === 'GET' && (pathname==='/' || pathname==='/configure')) return staticFile(res,'index.html','text/html; charset=utf-8');
      if (req.method === 'GET' && pathname==='/app.js') return staticFile(res,'app.js','text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname==='/styles.css') return staticFile(res,'styles.css','text/css; charset=utf-8');
      if (req.method === 'GET' && pathname==='/logo.svg') return staticFile(res,'logo.svg','image/svg+xml');
      if (req.method === 'GET' && pathname==='/logo.png') return staticFile(res,'logo.png','image/png');
      if (req.method === 'GET' && pathname==='/healthz') return json(res,200,{status:'ok',version:VERSION});
      if (req.method === 'GET' && pathname==='/manifest.json') return json(res,200,manifest(publicBaseUrl(req)),300);
      if (req.method === 'GET' && pathname==='/api/info') return json(res,200,{version:VERSION,universalManifest:'/manifest.json',stateless:true,
        detection:{capabilities:false,bandwidth:false},selection:{maxResolution:1080,averageBitrateBudgetMbps:5,bandwidthMeasured:false}});
      if (req.method === 'POST' && pathname==='/api/config') {
        if (!rateLimit(req,requests)) return error(res,429,'Too many requests');
        const config = validateProfile((await body(req)).config);
        const token = encodeProfile(config);
        const base = publicBaseUrl(req);
        return json(res,200,{token,manifestUrl:`${base}/p/${token}/manifest.json`,config});
      }
      if (req.method === 'POST' && pathname==='/api/preview') {
        if (!rateLimit(req,requests)) return error(res,429,'Too many requests');
        const payload = await body(req,1_000_000);
        const previewConfig = payload.config ? validateProfile(payload.config) : config;
        const streams=Array.isArray(payload.streams) ? payload.streams : payload.streams?.streams;
        if (!Array.isArray(streams)) return error(res,400,'Expected a Torrentio JSON object or streams array');
        const ranked=rankStreams(streams,previewConfig,{type:payload.type==='series'?'series':'movie',runtimeMinutes:Number(payload.runtimeMinutes)||null});
        return json(res,200,diagnostics(ranked));
      }
      if (req.method === 'POST' && pathname==='/api/test') {
        if (!rateLimit(req,requests)) return error(res,429,'Too many requests');
        const request=await body(req);
        const testConfig=request.config ? validateProfile(request.config) : config;
        const type=request.type==='series'?'series':'movie';
        const id=String(request.id||'');
        if (!validId(type,id)) return error(res,400,'Enter a valid IMDb movie ID or series ID:season:episode');
        const [collection,minutes] = await Promise.all([collect(fetchFn,cache,testConfig,type,id),runtime(fetchFn,cache,type,id)]);
        return json(res,200,diagnostics(rankStreams(collection.streams,testConfig,{type,runtimeMinutes:minutes}),{
          runtimeMinutes:minutes,sourceErrors:collection.errors
        }));
      }
      const existing = pathname.match(/^\/api\/profile\/([A-Za-z0-9_-]{10,3400})$/);
      if (req.method === 'GET' && existing) return json(res,200,{config:decodeProfile(existing[1])});
      const m = pathname.match(/^\/p\/([A-Za-z0-9_-]{10,3400})\/manifest\.json$/);
      if (req.method === 'GET' && m) {
        const config=decodeProfile(m[1]);
        return json(res,200,manifest(publicBaseUrl(req),m[1],config),300);
      }
      const s = pathname.match(/^(?:\/p\/([A-Za-z0-9_-]{10,3400}))?\/stream\/(movie|series)\/([^/]+?)(?:\/[^/]+)?\.json$/);
      if (req.method === 'GET' && s) {
        if (!validId(s[2],s[3])) return json(res,200,{streams:[],cacheMaxAge:0});
        const playbackConfig=s[1] ? decodeProfile(s[1]) : config;
        // Stock clients supply no confirmed playback capabilities or network measurement.
        // Ignore speculative capability headers, User-Agent guesses and query parameters.
        const [collection,minutes] = await Promise.all([collect(fetchFn,cache,playbackConfig,s[2],s[3]),runtime(fetchFn,cache,s[2],s[3])]);
        const chosen=selectedStream(collection.streams,playbackConfig,{type:s[2],runtimeMinutes:minutes});
        if (collection.errors.length) log({kind:'smartplay.upstream',errors:collection.errors});
        return json(res,200,{streams:chosen?[chosen]:[],cacheMaxAge:chosen?60:0},chosen?60:0);
      }
      return error(res,404,'Not found');
    } catch (err) {
      const message=String(err?.message || 'Unknown error');
      const expected=/^(Invalid|Expected|Source|Do not|Minimum|Add at|Configuration|Too many|Request body|Installation URL|Unsupported)/.test(message);
      if(!expected) console.error('[smart-play]', message);
      return error(res,expected?400:500,expected?message:'Unable to process request');
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  createServer().listen(PORT,'0.0.0.0',()=>console.log(`Smart Play v${VERSION} listening on 0.0.0.0:${PORT}`));
}
