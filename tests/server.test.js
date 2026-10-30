import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createServer, serverConfig} from '../src/server.js';
import {defaultConfig, playbackIdentity} from '../src/ranking.js';
import {decodeProfile, encodeProfile, sourceStreamUrl} from '../src/profiles.js';

const fixture=JSON.parse(fs.readFileSync(new URL('./fixtures/streams.json',import.meta.url)));
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
const mockFetch=async url=>url.includes('v3-cinemeta.strem.io') ? response({meta:{runtime:'2h 0min'}}) :
  response({streams:url.includes('/series/') ? [{...fixture.streams[3],title:'Episode H264 AAC 👤 200 💾 0.5 GB',fileIdx:7}] : fixture.streams});

async function setup(t, options={}) {
  const server=createServer({fetchFn:mockFetch,log:()=>{},...options});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const root=`http://127.0.0.1:${server.address().port}`;
  return {root,request:async(path,options)=>{
    const r=await fetch(root+path,options);
    return {status:r.status,headers:r.headers,body:await r.json()};
  }};
}
const post=value=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});

test('one public manifest needs no configuration and declares only implemented resources', async t=>{
  const {request}=await setup(t);
  const {status,body,headers}=await request('/manifest.json');
  assert.equal(status,200); assert.equal(headers.get('access-control-allow-origin'),'*');
  assert.equal(body.id,'com.smartplay.universal'); assert.equal(body.version,'0.3.0');
  assert.deepEqual(body.types,['movie','series']); assert.deepEqual(body.catalogs,[]);
  assert.deepEqual(body.resources,[{name:'stream',types:['movie','series'],idPrefixes:['tt']}]);
  assert.equal(body.behaviorHints.configurationRequired,false);
  assert.equal(body.behaviorHints.configurable,false);
});
test('a standard movie GET returns exactly one valid Stremio stream', async t=>{
  const {request}=await setup(t);
  const r=await request('/stream/movie/tt1254207.json');
  assert.equal(r.status,200); assert.equal(r.body.streams.length,1);
  assert.equal(r.body.streams[0].infoHash,fixture.streams[2].infoHash);
  assert.equal(r.body.streams[0].fileIdx,0); assert.ok(playbackIdentity(r.body.streams[0]));
  assert.equal(r.body.cacheMaxAge,60);
});
test('literal and URL-encoded series IDs select the exact episode file', async t=>{
  const {request}=await setup(t);
  for(const id of ['tt0898266:1:2','tt0898266%3A1%3A2']) {
    const {body}=await request(`/stream/series/${id}.json`);
    assert.equal(body.streams.length,1); assert.equal(body.streams[0].fileIdx,7);
  }
});
test('unknown headers and speculative capability extras cannot select an incompatible format', async t=>{
  const {request}=await setup(t);
  for(const ua of ['Stremio/AndroidTV','Mozilla/5.0 Windows Chrome','Mozilla/5.0 Android SHIELD']) {
    const {body}=await request('/stream/movie/tt1254207/videoCodecs=hevc&hdr=dolbyvision.json?downloadMbps=1000',{
      headers:{'user-agent':ua,'x-stremio-capabilities':'{"hevc":true,"hdr10":true}',downlink:'1000'}
    });
    assert.equal(body.streams[0].infoHash,fixture.streams[2].infoHash);
  }
});
test('operator-configured providers aggregate with partial failures', async t=>{
  const config={...defaultConfig(),sources:['https://torrentio.strem.fun/one/manifest.json','https://torrentio.strem.fun/two/manifest.json']};
  const calls=[];
  const {request}=await setup(t,{config,fetchFn:async(url,options)=>{
    calls.push({url,options});
    if(url.includes('/one/')) throw new Error('Provider unavailable');
    return mockFetch(url);
  }});
  const {body}=await request('/stream/movie/tt1254207.json');
  assert.equal(body.streams.length,1);
  assert.ok(calls.some(c=>c.url.includes('/one/'))); assert.ok(calls.some(c=>c.url.includes('/two/')));
  assert.ok(calls.every(c=>c.options.headers['User-Agent']==='SmartPlay/0.3.0'));
});
test('complete upstream failure returns an empty uncached stream response', async t=>{
  const {request}=await setup(t,{fetchFn:async()=>{throw new Error('Network failure');}});
  const {status,body,headers}=await request('/stream/movie/tt1254207.json');
  assert.equal(status,200); assert.deepEqual(body,{streams:[],cacheMaxAge:0});
  assert.equal(headers.get('cache-control'),'no-store');
});
test('incompatible-only provider responses return no fabricated stream', async t=>{
  const {request}=await setup(t,{fetchFn:async url=>url.includes('cinemeta') ? response({meta:{runtime:120}}) : response({streams:fixture.streams.slice(0,2)})});
  assert.deepEqual((await request('/stream/movie/tt1254207.json')).body.streams,[]);
});
test('metadata failure uses fallback runtime and still ranks streams', async t=>{
  const {request}=await setup(t,{fetchFn:async url=>url.includes('cinemeta') ? response({},503) : mockFetch(url)});
  assert.equal((await request('/stream/movie/tt1254207.json')).body.streams[0].infoHash,fixture.streams[2].infoHash);
});
test('unavailable, malformed, oversized and disallowed-redirect providers fail closed', async t=>{
  const upstreams=[
    ()=>response({},503), ()=>response({streams:'bad'}), ()=>new Response('not-json'),
    ()=>new Response('x'.repeat(2_600_001)),
    ()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}}),
    ()=>{throw new DOMException('Timeout','TimeoutError');}
  ];
  for(const upstream of upstreams) {
    const {request}=await setup(t,{fetchFn:async url=>url.includes('cinemeta') ? response({}) : upstream()});
    assert.deepEqual((await request('/stream/movie/tt1254207.json')).body.streams,[]);
  }
});
test('raw upstream results cache per instance and do not forward viewer headers', async t=>{
  const calls=[];
  const {request}=await setup(t,{fetchFn:async(url,options)=>{calls.push(options);return mockFetch(url);}});
  await request('/stream/movie/tt1254207.json',{headers:{authorization:'private',cookie:'private','user-agent':'private'}});
  await request('/stream/movie/tt1254207.json');
  assert.equal(calls.length,2);
  assert.ok(calls.every(c=>!c.headers.authorization&&!c.headers.cookie&&c.headers['User-Agent']!=='private'));
});
test('failed stream fetch is retried rather than cached as permanent unavailability', async t=>{
  let attempts=0;
  const {request}=await setup(t,{fetchFn:async url=>{
    if(!url.includes('cinemeta')&&++attempts===1) throw new Error('Temporary outage');
    return mockFetch(url);
  }});
  assert.equal((await request('/stream/movie/tt1254207.json')).body.streams.length,0);
  assert.equal((await request('/stream/movie/tt1254207.json')).body.streams.length,1);
});
test('unsupported identifiers do not trigger upstream requests', async t=>{
  let calls=0;
  const {request}=await setup(t,{fetchFn:async()=>{calls++;return response({});}});
  for(const path of ['/stream/movie/tmdb:123.json','/stream/series/tt0898266.json','/stream/movie/tt0898266:1:1.json']) {
    assert.deepEqual((await request(path)).body.streams,[]);
  }
  assert.equal(calls,0);
  assert.equal((await request('/stream/movie/%FF.json')).status,400);
});
test('CORS preflight supports Stremio Web', async t=>{
  const {root}=await setup(t);
  const r=await fetch(root+'/manifest.json',{method:'OPTIONS',headers:{origin:'https://web.stremio.com'}});
  assert.equal(r.status,204); assert.equal(r.headers.get('access-control-allow-origin'),'*');
});
test('optional header observation captures real incoming HTTP headers with sensitive fields omitted', async t=>{
  const logs=[];
  const {request}=await setup(t,{logHeaders:true,log:entry=>logs.push(entry)});
  await request('/manifest.json?token=private',{headers:{'user-agent':'Node test client',authorization:'private',cookie:'private','x-stremio-test':'private'}});
  assert.equal(logs[0].headers['user-agent'],'Node test client');
  assert.equal(logs[0].capabilitiesDetected,false); assert.equal(logs[0].viewerBandwidthMeasured,false);
  assert.deepEqual(logs[0].stremioHeaderNames,['x-stremio-test']);
  assert.ok(!JSON.stringify(logs).includes('private'));
});
test('preview and live diagnostic APIs require no profile', async t=>{
  const {request}=await setup(t);
  const a=await request('/api/preview',post({streams:fixture.streams,runtimeMinutes:120}));
  assert.equal(a.status,200); assert.equal(a.body.total,7); assert.equal(a.body.eligible,2);
  const b=await request('/api/test',post({id:'tt1254207'}));
  assert.equal(b.status,200); assert.equal(b.body.runtimeMinutes,120);
  assert.equal((await request('/api/preview',post(null))).status,400);
});
test('existing stateless profile URLs remain readable and have separate manifest identities', async t=>{
  const config={...defaultConfig(),name:'Optional profile'};
  const token=encodeProfile(config);
  assert.equal(decodeProfile(token).name,config.name);
  assert.throws(()=>decodeProfile('not-a-profile-token'),/Invalid/);
  const {request}=await setup(t);
  const {body}=await request(`/p/${token}/manifest.json`);
  assert.match(body.id,/^com.smartplay.family\./);
  assert.equal((await request(`/p/${token}/stream/movie/tt1254207.json`)).body.streams.length,1);
  assert.equal((await request(`/api/profile/${token}`)).body.config.name,config.name);
});
test('provider manifests are server-approved and preserve configured provider paths', () => {
  const url=sourceStreamUrl('https://torrentio.strem.fun/sort=seeders|providers=yts,eztv/manifest.json','series','tt0898266:1:2');
  assert.ok(url.includes('sort=seeders|providers=yts,eztv/stream/series/tt0898266%3A1%3A2.json'));
  for(const source of ['http://torrentio.strem.fun/manifest.json','https://127.0.0.1/manifest.json','https://evil.example/manifest.json']) {
    assert.throws(()=>sourceStreamUrl(source,'movie','tt1254207'),/HTTPS/);
  }
  assert.throws(()=>serverConfig({SOURCE_MANIFEST_URLS:'not json'}),/JSON/);
  assert.throws(()=>serverConfig({SOURCE_MANIFEST_URLS:'[]'}),/one to six/);
  assert.equal(serverConfig({SOURCE_MANIFEST_URLS:'["https://torrentio.strem.fun/manifest.json"]'}).sources.length,1);
});
test('installation page has a single manifest link and no mandatory settings', async t=>{
  const {root,request}=await setup(t);
  const html=await fetch(root+'/').then(r=>r.text());
  assert.match(html,/Open in Stremio/); assert.match(html,/manifest-url/);
  assert.ok(!html.includes('<select')); assert.ok(!html.includes('type="number"'));
  assert.equal((await request('/healthz')).body.version,'0.3.0');
  assert.deepEqual((await request('/api/info')).body.detection,{capabilities:false,bandwidth:false});
});
