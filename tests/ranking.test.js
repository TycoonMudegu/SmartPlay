import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultConfig, inspectStream, playbackIdentity, rankStreams, selectedStream, scoreStream} from '../src/ranking.js';

const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/streams.json', import.meta.url)));
const streams = fixture.streams;
const base = {runtimeMinutes: fixture.runtimeMinutes};
const caps = {
  maxResolution:2160, videoCodecs:['h264','hevc'], hdrFormats:['dolbyvision','hdr10','hdr10plus'],
  audioCodecs:['aac','mp3','eac3'], maxVideoBitDepth:10, maxFrameRate:60
};
const sample = (title='Film H264 AAC 👤 100 💾 2 GB', extra={}) => ({name:'1080p',title,infoHash:'a'.repeat(40),fileIdx:0,...extra});
const select = (list=streams, options={}) => selectedStream(list, defaultConfig(), {...base,...options});

test('universal defaults make no device or bandwidth detection claims', () => {
  assert.equal(defaultConfig().internetMbps,null);
  assert.equal(defaultConfig().hdr,'none');
  assert.equal(select().infoHash,streams[2].infoHash);
  assert.equal(select().title,'Automatically selected · 1080p');
});
test('simulated 4K HEVC Dolby Vision television can select a suitable higher quality stream', () => {
  assert.equal(select(streams,{capabilities:caps,network:{downloadMbps:100}}).infoHash,streams[0].infoHash);
});
test('simulated AV1 HDR10 device does not inherit Dolby Vision support', () => {
  const capabilities={...caps,videoCodecs:['h264','av1'],hdrFormats:['hdr10']};
  assert.equal(select(streams,{capabilities,network:{downloadMbps:100}}).infoHash,streams[1].infoHash);
});
test('simulated H264-only 720p television never receives HEVC or 1080p', () => {
  assert.equal(select(streams,{capabilities:{maxResolution:720},network:{downloadMbps:100}}).infoHash,streams[3].infoHash);
});
test('slow and unstable simulated connections select the highest quality that fits the reduced budget', () => {
  for (const [network,expected] of [[{downloadMbps:3},streams[3]],[{downloadMbps:6,stable:false},streams[4]]]) {
    assert.equal(select(streams,{capabilities:caps,network}).infoHash,expected.infoHash);
  }
});
test('unknown network stays conservative even with a simulated high end television', () => {
  assert.equal(select(streams,{capabilities:caps}).infoHash,streams[4].infoHash);
  const result=scoreStream(streams[2],undefined,base);
  assert.equal(result.metadata.bandwidthBasis,'policy-default-unmeasured');
  assert.equal(result.metadata.budgetMbps,5);
});
test('invalid or missing simulated throughput cannot remove the default bitrate limit', () => {
  for (const downloadMbps of [0,-1,NaN,Infinity,undefined]) {
    assert.equal(scoreStream(streams[5],undefined,{...base,network:{downloadMbps}}).eligible,false);
  }
});
test('resolution label overrides DS4K in a filename', () => {
  assert.equal(inspectStream(sample('Film DS4K x264 AAC')).resolution,1080);
});
test('reads actual GB/GiB/MiB units, byte hints, seed counts and format risk labels', () => {
  const m=inspectStream(sample('Film HEVC 10bit DV HDR10+ TrueHD Atmos 👤 1.2k 💾 2 GiB'));
  assert.equal(m.sizeGB,2*2**30/1e9);
  assert.equal(m.seeders,1200);
  assert.deepEqual(m.videoCodecs,['hevc']);
  assert.deepEqual(m.hdrFormats,['dolbyvision','hdr10plus']);
  assert.deepEqual(m.audioCodecs,['truehd']);
  assert.equal(m.atmos,true);
  assert.equal(m.bitDepth,10);
  assert.equal(m.evidence,'unverified-provider-metadata');
  assert.equal(inspectStream(sample('Film size: 500 MiB')).sizeGB,500*2**20/1e9);
  assert.equal(inspectStream(sample('Film',{behaviorHints:{videoSize:1e9}})).sizeGB,1);
});
test('E-AC-3 is not parsed as AC3; DTS-HD is distinct from DTS', () => {
  assert.deepEqual(inspectStream(sample('E-AC-3')).audioCodecs,['eac3']);
  assert.deepEqual(inspectStream(sample('DDP5.1')).audioCodecs,['eac3']);
  assert.deepEqual(inspectStream(sample('DTS-HD')).audioCodecs,['dtshd']);
});
test('unknown capabilities reject risky HDR, codecs, audio, bit depths and high frame rates', () => {
  for (const label of ['HEVC','AV1','HDR10','HDR10+','DV','DTS','DTS-HD','TrueHD','AC3','EAC3','Atmos','H264 Hi10P','H264 12bit','H264 60fps']) {
    assert.equal(scoreStream(sample(`Film ${label} 👤 100 💾 2 GB`),undefined,base).eligible,false,label);
  }
});
test('Dolby Vision and HDR10 labels together do not imply a playable HDR10 fallback', () => {
  assert.equal(scoreStream(sample('Film HEVC DV HDR10 AAC 👤 100 💾 2 GB'),undefined,
    {...base,capabilities:{...caps,hdrFormats:['hdr10']}}).eligible,false);
});
test('Atmos over a supported EAC3 base is allowed without claiming Atmos output', () => {
  const s=sample('Film H264 EAC3 Atmos 👤 100 💾 2 GB');
  assert.equal(scoreStream(s,undefined,{...base,capabilities:{audioCodecs:['eac3']}}).eligible,true);
});
test('runtime converts size to average bitrate, retaining peak headroom', () => {
  const result=scoreStream(streams[2],undefined,base);
  assert.ok(Math.abs(result.metadata.estimatedMbps-3.3333333333)<0.00001);
  assert.equal(scoreStream(streams[2],undefined,{...base,network:{downloadMbps:5}}).eligible,false);
});
test('missing or invalid runtime uses 90 minute films and 30 minute episodes', () => {
  for (const runtimeMinutes of [undefined,null,NaN,Infinity,-1,900]) {
    assert.equal(scoreStream(streams[2],undefined,{runtimeMinutes}).metadata.runtimeMinutes,90);
  }
  assert.equal(scoreStream(streams[2],undefined,{type:'series'}).metadata.runtimeMinutes,30);
});
test('unknown metadata is a penalized last resort and never described as verified', () => {
  const unknown=sample('Film',{name:'Provider'});
  assert.equal(scoreStream(unknown).eligible,true);
  assert.equal(select([unknown,streams[3]]).infoHash,streams[3].infoHash);
  const m=scoreStream(unknown).metadata;
  assert.equal(m.sizeGB,null); assert.equal(m.seeders,null);
  assert.equal(m.estimatedMbps,null); assert.equal(m.resolution,0);
});
test('missing size loses to a reasonably sized, well seeded lower resolution stream', () => {
  assert.equal(select([sample('Film H264 AAC 👤 100'),streams[3]]).infoHash,streams[3].infoHash);
});
test('source availability can outweigh resolution', () => {
  assert.equal(select([sample('Film H264 AAC 👤 2 💾 2 GB'),streams[3]]).infoHash,streams[3].infoHash);
  assert.equal(scoreStream(streams[6]).eligible,false);
  assert.equal(scoreStream({url:'https://video.example/film.mp4',title:'H264 AAC 💾 2 GB',seeders:0},undefined,base).eligible,true);
});
test('remux-sized files, camera recordings and 3D releases are excluded by default', () => {
  assert.equal(select([streams[5]]),null);
  for (const label of ['CAM','HDCAM','HDTS','SCR','3D','HSBS']) assert.equal(select([sample(`Film ${label}`)]),null);
});
test('invalid playback identifiers and file selectors are removed', () => {
  const invalid=[null,[],{}, {url:'javascript:alert(1)'},{url:'https://user:password@video.example/film.mp4'},
    {infoHash:'bad'},sample('',{fileIdx:-1}),sample('',{fileIdx:'0'}),sample('',{url:'https://video.example/film.mp4'})];
  assert.deepEqual(rankStreams(invalid),[]);
  assert.equal(select(invalid),null);
});
test('deduplication is case insensitive for hashes but retains different torrent file indices', () => {
  const a=sample();
  assert.equal(rankStreams([a,{...a,infoHash:a.infoHash.toUpperCase()},{...a,fileIdx:1}]).length,2);
});
test('duplicates combine tracker discovery and retain conservative metadata', () => {
  const a=sample('Film H264 AAC 👤 30 💾 2 GB',{sources:['tracker:udp://one.example:80']});
  const b={...a,title:'Film H264 AAC 👤 10 💾 3 GB',sources:['tracker:udp://two.example:80']};
  const [result]=rankStreams([a,b],undefined,base);
  assert.equal(result.metadata.sizeGB,3); assert.equal(result.metadata.seeders,10);
  assert.equal(result.stream.sources.length,2);
  assert.equal(select([a,{...b,title:'Film HEVC AAC 👤 10 💾 3 GB'}]),null);
});
test('zero results when all candidates are unavailable or incompatible', () => {
  assert.equal(select([streams[0],streams[1],streams[6]]),null);
  assert.equal(select([]),null);
});
test('playback targets, proxy headers and subtitle hints survive selection', () => {
  const s=sample('Film H264 AAC 💾 2 GB',{
    infoHash:undefined,url:'https://video.example/film.mkv',
    behaviorHints:{filename:'film.mkv',videoHash:'abcd',proxyHeaders:{request:{Referer:'https://video.example'}}},
    subtitles:[{id:'en',lang:'eng',url:'https://video.example/film.vtt'}]
  });
  const selected=select([s]);
  assert.equal(selected.url,s.url); assert.equal(selected.behaviorHints.notWebReady,true);
  assert.deepEqual(selected.behaviorHints.proxyHeaders,s.behaviorHints.proxyHeaders);
  assert.deepEqual(selected.subtitles,s.subtitles);
  assert.equal(selected.behaviorHints.bingeGroup,'smartplay-auto-v1');
  assert.ok(playbackIdentity(selected));
});
test('episode torrents require a file index and preserve the chosen episode selector', () => {
  assert.equal(select([sample('',{fileIdx:undefined})],{type:'series'}),null);
  const episode=sample('Episode H264 AAC 👤 100 💾 0.5 GB',{fileIdx:7});
  assert.equal(select([episode],{type:'series',runtimeMinutes:24}).fileIdx,7);
});
test('deterministic tie breaks do not depend on provider ordering', () => {
  const a=sample(),b=sample(undefined,{infoHash:'b'.repeat(40)});
  assert.equal(select([a,b]).infoHash,select([b,a]).infoHash);
});
