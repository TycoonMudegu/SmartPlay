import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createServer} from '../src/server.js';
import {defaultConfig} from '../src/ranking.js';
import {decodeProfile, encodeProfile, sourceStreamUrl} from '../src/profiles.js';

let server, root;
const exampleSource=defaultConfig().sources[0];
const chosen={
  name:'Torrentio\n4k DV | HDR10+',
  title:'Avatar sample [2160p] HEVC\n👤 94 💾 9.75 GB',
  infoHash:'0'.repeat(40),fileIdx:0,
  behaviorHints:{filename:'Avatar sample HDR10 DV.mkv'}
};
const fallback={name:'Torrentio\n1080p',title:'Avatar sample\n👤 300 💾 5 GB',infoHash:'1'.repeat(40),fileIdx:0};
function mockFetch(url) {
  let result;
  if (url.includes('v3-cinemeta.strem.io')) result={meta:{runtime:'3h 15min'}};
  else if (url.includes('/stream/movie/tt1757678.json')) result={streams:[chosen,fallback]};
  else if (url.includes('/stream/series/')) result={streams:[]};
  else return Promise.resolve({ok:false,status:404,headers:new Headers()});
  return Promise.resolve({
    ok:true,status:200,headers:new Headers({'content-type':'application/json'}),
    body:Readable.from([Buffer.from(JSON.stringify(result))])
  });
}
async function req(path, options={}) {
  const response=await fetch(root+path,options);
  return [response.status, await response.json()];
}
before(async()=>{
  server=createServer({fetchFn:mockFetch});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  root=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{await new Promise(resolve=>server.close(resolve));});
const c={...defaultConfig(),name:'Cinema',minimumResolution:2160};
test('profiles round-trip without storage and reject corrupt tokens',()=>{
  const value=encodeProfile(c);
  assert.equal(decodeProfile(value).name,'Cinema');
  assert.throws(()=>decodeProfile('not-a-config-payload'),/Invalid/);
  assert.ok(value.length < 3400);
});
test('source paths keep Torrentio options when constructing stream URL',()=>{
  assert.equal(sourceStreamUrl(exampleSource,'movie','tt1757678').includes('/stream/movie/tt1757678.json'),true);
  assert.throws(()=>sourceStreamUrl('http://127.0.0.1/manifest.json','movie','tt1757678'),/HTTPS/);
});
test('generates usable stateless Stremio manifest and one stream',async()=>{
  const [response,created]=await req('/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:c})});
  assert.equal(response,200);
  assert.equal(created.config.name,'Cinema');
  const profile=created.token;
  const [manifestStatus, manifest]=await req(`/p/${profile}/manifest.json`);
  assert.equal(manifestStatus,200);
  assert.equal(manifest.resources[0].name,'stream');
  assert.equal(manifest.behaviorHints.p2p,true);
  const [streamStatus,result]=await req(`/p/${profile}/stream/movie/tt1757678.json`);
  assert.equal(streamStatus,200);
  assert.equal(result.streams.length,1);
  assert.equal(result.streams[0].name,'▶ Play');
  assert.equal(result.streams[0].infoHash,chosen.infoHash);
  assert.equal(result.streams[0].fileIdx,0);
  const [readStatus,read]=await req(`/api/profile/${profile}`);
  assert.equal(readStatus,200);
  assert.equal(read.config.minimumResolution,2160);
});
test('live test and JSON preview rank sources without an AI service',async()=>{
  const [s,d]=await req('/api/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:c,id:'tt1757678',type:'movie'})});
  assert.equal(s,200);
  assert.equal(d.total,2);
  assert.equal(d.eligible,1);
  assert.equal(d.runtimeMinutes,195);
  const [s2,d2]=await req('/api/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:c,runtimeMinutes:195,streams:[chosen,fallback]})});
  assert.equal(s2,200);
  assert.equal(d2.eligible,1);
});
test('source allowlist and minimum resolution are validated',async()=>{
  for(const bad of [
    {...c,sources:['http://evil.example/manifest.json']},
    {...c,sources:['https://127.0.0.1/manifest.json']},
    {...c,minimumResolution:2160,tvResolution:1080}
  ]) {
    const [code]=await req('/api/config',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({config:bad})});
    assert.equal(code,400);
  }
});
test('serves health and a local configuration UI',async()=>{
  assert.equal((await req('/healthz'))[1].status,'ok');
  const res=await fetch(root+'/');
  assert.equal(res.status,200);
  assert.match(await res.text(),/One Play option/);
});
