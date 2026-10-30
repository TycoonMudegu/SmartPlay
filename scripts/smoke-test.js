import assert from 'node:assert/strict';
import {playbackIdentity} from '../src/ranking.js';

const base = new URL(process.argv[2] || 'http://localhost:8080').origin;
async function get(path) {
  const response = await fetch(base + path, {signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200,`${path}: HTTP ${response.status}`);
  assert.equal(response.headers.get('access-control-allow-origin'),'*',`${path}: missing CORS`);
  return response.json();
}
try {
  const manifest = await get('/manifest.json');
  assert.equal(manifest.id,'com.smartplay.universal');
  assert.equal(manifest.behaviorHints.configurationRequired,false);
  assert.ok(manifest.resources.some(r=>r.name==='stream'));
  const info=await get('/api/info');
  assert.equal(info.version,'0.3.0');
  assert.deepEqual(info.detection,{capabilities:false,bandwidth:false});
  console.log(`PASS: universal manifest, CORS and version ${info.version} at ${base}`);
  if (process.argv[3]) {
    const id=process.argv[3];
    assert.match(id,/^tt\d{5,12}(?::\d{1,4}:\d{1,4})?$/);
    const type=id.includes(':')?'series':'movie';
    const result=await get(`/stream/${type}/${encodeURIComponent(id)}.json`);
    assert.ok(Array.isArray(result.streams));
    assert.ok(result.streams.length<=1);
    for (const stream of result.streams) assert.ok(playbackIdentity(stream));
    console.log(`PASS: ${type} ${id} returned ${result.streams.length} stream(s). ${result.streams.length ? 'Playback target is structurally valid; media was not downloaded.' : 'No eligible source; playback availability is unconfirmed.'}`);
  }
} catch (error) {
  console.error('FAIL:',error.message);
  process.exitCode=1;
}
