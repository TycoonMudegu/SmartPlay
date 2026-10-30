import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {defaultConfig, rankStreams, selectedStream} from './ranking.js';
import {allowedHosts, checkSource, decodeProfile, encodeProfile, profileId, sourceStreamUrl, validateProfile} from './profiles.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const cache = new Map();
const requests = new Map();

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
function rateLimit(req) {
  const now = Date.now();
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0];
  for (const [k,v] of requests) if (v.exp < now) requests.delete(k);
  const record = requests.get(ip) || {exp: now + 60_000, count:0};
  record.count++;
  requests.set(ip, record);
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
  try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
  catch { throw new Error('Invalid JSON request body'); }
}
function validRemote(url) {
  if (url.hostname === 'v3-cinemeta.strem.io' && url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443')) return true;
  return url.protocol === 'https:' && allowedHosts.has(url.hostname.toLowerCase()) &&
    !url.username && !url.password && (!url.port || url.port === '443');
}
async function fetchJson(fetchFn, input, {limit=2_600_000, timeout=7_000}={}) {
  let current = new URL(input);
  for (let i=0; i<3; i++) {
    if (!validRemote(current)) throw new Error('Disallowed upstream host');
    const response = await fetchFn(current.href, {
      redirect:'manual', headers:{'Accept':'application/json','User-Agent':'SmartPlay/0.2'},
      signal:AbortSignal.timeout(timeout)
    });
    if (response.status >= 300 && response.status < 400) {
      const next = response.headers.get('location');
      if (!next) throw new Error('Upstream redirect has no location');
      current = new URL(next, current);
      continue;
    }
    if (!response.ok) throw new Error('Upstream HTTP ' + response.status);
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
function cached(key, ttl, producer) {
  const found = cache.get(key);
  if (found && found.exp > Date.now()) return found.value;
  const pending = Promise.resolve().then(producer);
  cache.set(key, {exp:Date.now()+ttl,value:pending});
  pending.catch(()=>cache.delete(key));
  if (cache.size > 900) cache.clear();
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
async function runtime(fetchFn,type,id) {
  const base = id.split(':')[0];
  return cached('runtime:'+type+':'+base, 6*3600_000, async()=>{
    try {
      const info = await fetchJson(fetchFn, `https://v3-cinemeta.strem.io/meta/${type}/${encodeURIComponent(base)}.json`, {timeout:3000});
      return parseRuntime(info?.meta?.runtime);
    } catch { return null; }
  });
}
async function collect(fetchFn, config, type, id) {
  const outcome = await Promise.allSettled(config.sources.map(source => {
    const url = sourceStreamUrl(source,type,id);
    return cached('streams:'+url, 120_000, async()=>{
      const response = await fetchJson(fetchFn,url);
      return Array.isArray(response?.streams) ? response.streams.slice(0,500) : [];
    });
  }));
  return {
    streams:outcome.flatMap(v => v.status === 'fulfilled' ? v.value : []),
    errors:outcome.flatMap((v,i) => v.status === 'rejected' ? [`${new URL(config.sources[i]).hostname}: ${v.reason?.message || 'Unavailable'}`] : [])
  };
}
function manifest(token, config) {
  return {
    id:'com.smartplay.family.' + profileId(token),
    version:'0.2.0',
    name:'Smart Play · ' + config.name,
    description:'One automatically ranked compatible stream. Film and TV playback is handled by Stremio.',
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

export function createServer({fetchFn=fetch}={}) {
  return http.createServer(async(req,res)=>{
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204,{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'86400'});
        return res.end();
      }
      const pathname = new URL(req.url,'http://localhost').pathname;
      if (req.method === 'GET' && (pathname==='/' || pathname==='/configure')) return staticFile(res,'index.html','text/html; charset=utf-8');
      if (req.method === 'GET' && pathname==='/app.js') return staticFile(res,'app.js','text/javascript; charset=utf-8');
      if (req.method === 'GET' && pathname==='/styles.css') return staticFile(res,'styles.css','text/css; charset=utf-8');
      if (req.method === 'GET' && pathname==='/healthz') return json(res,200,{status:'ok',version:'0.2.0'});
      if (req.method === 'GET' && pathname==='/api/info') return json(res,200,{defaultConfig:defaultConfig(),allowedHosts:[...allowedHosts],stateless:true});
      if (req.method === 'POST' && pathname==='/api/config') {
        if (!rateLimit(req)) return error(res,429,'Too many requests');
        const config = validateProfile((await body(req)).config);
        const token = encodeProfile(config);
        const base = String(process.env.PUBLIC_BASE_URL || new URL(req.headers.host ? `${req.headers['x-forwarded-proto']==='https'?'https':'http'}://${req.headers.host}` : 'http://localhost').origin).replace(/\/$/,'');
        return json(res,200,{token,manifestUrl:`${base}/p/${token}/manifest.json`,config});
      }
      if (req.method === 'POST' && pathname==='/api/preview') {
        if (!rateLimit(req)) return error(res,429,'Too many requests');
        const payload = await body(req,1_000_000);
        const config = validateProfile(payload.config);
        const streams=Array.isArray(payload.streams) ? payload.streams : payload.streams?.streams;
        if (!Array.isArray(streams)) return error(res,400,'Expected a Torrentio JSON object or streams array');
        const ranked=rankStreams(streams,config,{type:payload.type==='series'?'series':'movie',runtimeMinutes:Number(payload.runtimeMinutes)||null});
        return json(res,200,diagnostics(ranked));
      }
      if (req.method === 'POST' && pathname==='/api/test') {
        if (!rateLimit(req)) return error(res,429,'Too many requests');
        const request=await body(req);
        const config=validateProfile(request.config);
        const type=request.type==='series'?'series':'movie';
        const id=String(request.id||'');
        if (!/^tt\d{5,12}(?::\d{1,4}:\d{1,4})?$/.test(id)) return error(res,400,'Enter a valid IMDb ID, e.g. tt1757678');
        const [collection,minutes] = await Promise.all([collect(fetchFn,config,type,id),runtime(fetchFn,type,id)]);
        return json(res,200,diagnostics(rankStreams(collection.streams,config,{type,runtimeMinutes:minutes}),{
          runtimeMinutes:minutes,sourceErrors:collection.errors
        }));
      }
      const existing = pathname.match(/^\/api\/profile\/([A-Za-z0-9_-]{10,3400})$/);
      if (req.method === 'GET' && existing) return json(res,200,{config:decodeProfile(existing[1])});
      const m = pathname.match(/^\/p\/([A-Za-z0-9_-]{10,3400})\/manifest\.json$/);
      if (req.method === 'GET' && m) {
        const config=decodeProfile(m[1]);
        return json(res,200,manifest(m[1],config),300);
      }
      const s = pathname.match(/^\/p\/([A-Za-z0-9_-]{10,3400})\/stream\/(movie|series)\/(tt\d{5,12}(?::\d{1,4}:\d{1,4})?)\.json$/);
      if (req.method === 'GET' && s) {
        const config=decodeProfile(s[1]);
        const [collection,minutes] = await Promise.all([collect(fetchFn,config,s[2],s[3]),runtime(fetchFn,s[2],s[3])]);
        const chosen=selectedStream(collection.streams,config,{type:s[2],runtimeMinutes:minutes});
        return json(res,200,{streams:chosen?[chosen]:[],cacheMaxAge:120},60);
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
  createServer().listen(PORT,'0.0.0.0',()=>console.log(`Smart Play v0.2 listening on 0.0.0.0:${PORT}`));
}
