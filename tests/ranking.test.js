import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultConfig,inspectStream,rankStreams,selectedStream,scoreStream} from '../src/ranking.js';
const mk=(name,title,hash)=>({name,title,infoHash:hash||'a'.repeat(40),fileIdx:0});
const c={...defaultConfig(),internetMbps:15,tvResolution:2160,minimumResolution:1080,hdr:'dolbyvision',audio:'atmos'};
test('reads 4K, HDR and bitrate from Torrentio metadata',()=>{
  const s=mk('Torrentio\n4k DV | HDR10+','Film [2160p] HEVC \n👤 94 💾 9.75 GB');
  const m=inspectStream(s);
  assert.equal(m.resolution,2160);assert.equal(m.dv,true);assert.equal(m.hdr10plus,true);assert.equal(m.seeders,94);assert.equal(m.sizeGB,9.75);
});
test('prefers provider resolution over DS4K title',()=>{
  const s=mk('Torrentio\n1080p HDR','Film 1080p DS4K BluRay HEVC \n👤 10 💾 12 GB');
  assert.equal(inspectStream(s).resolution,1080);
});
test('rejects large file at 15 Mbps with 195 minute runtime',()=>{
  const s=mk('Torrentio\n4k','Film \n👤 81 💾 30 GB');
  assert.equal(scoreStream(s,c,{runtimeMinutes:195}).eligible,false);
});
test('atmos is a preference, not an exclusion when absent',()=>{
  const s=mk('Torrentio\n4k DV','Film \n👤 81 💾 10 GB');
  assert.equal(scoreStream(s,c,{runtimeMinutes:195}).eligible,true);
});
test('strict 4K filters all 1080p and unknown resolution',()=>{
  const cfg={...c,minimumResolution:2160};
  const s=mk('Torrentio\n1080p','Film \n👤 81 💾 6 GB');
  assert.equal(scoreStream(s,cfg,{runtimeMinutes:195}).eligible,false);
  assert.equal(scoreStream(mk('Torrentio\nBluRay','Film 👤 11 💾 4 GB'),cfg,{runtimeMinutes:195}).eligible,false);
});
test('deduplicates and chooses one best stream with correct torrent selectors',()=>{
  const a=mk('Torrentio\n4k DV','Film \n👤 81 💾 10 GB','a'.repeat(40));
  const b=mk('Torrentio\n1080p Atmos','Film \n👤 120 💾 8 GB','b'.repeat(40));
  assert.equal(rankStreams([a,a,b],c,{runtimeMinutes:195}).length,2);
  const best=selectedStream([a,b],c,{runtimeMinutes:195});
  assert.equal(best.name,'▶ Play');assert.equal(best.infoHash,'a'.repeat(40));assert.equal(best.fileIdx,0);
});
test('zero seed torrents excluded, while URLs can play without peers',()=>{
  const zero=mk('Torrentio\n4k','Film \n👤 0 💾 4 GB');
  assert.equal(scoreStream(zero,c,{runtimeMinutes:195}).eligible,false);
  const direct={url:'https://example.com/film.mp4',name:'1080p',title:'Film 💾 4 GB'};
  assert.equal(scoreStream(direct,c,{runtimeMinutes:195}).eligible,true);
});
test('too-short unknown movie runtime is treated conservatively',()=>{
  const large=mk('Torrentio\n4k','Film 👤 100 💾 18 GB');
  assert.equal(scoreStream(large,c,{type:'movie'}).eligible,false);
});
