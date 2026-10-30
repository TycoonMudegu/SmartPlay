const el = id => document.getElementById(id);
const configFields = ['name','internetMbps','tvResolution','minimumResolution','hdr','audio','preferredLanguage','conservative','maxFileGB'];
let token='';
function message(text,invalid=false) {
  const node=el('alert');node.hidden=false;node.textContent=text;node.classList.toggle('error',invalid);
}
async function parseResponse(response) {
  let data;
  try {data=await response.json();} catch {throw new Error('Server returned an invalid response');}
  if(!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}
function readConfig() {
  const data={};
  for (const id of configFields) {
    const input=el(id);
    data[id]=input.type==='checkbox'?input.checked:
      ['internetMbps','tvResolution','minimumResolution','maxFileGB'].includes(id)?Number(input.value):input.value;
  }
  data.sources=el('sources').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  return data;
}
function populate(data) {
  for (const id of configFields) {
    const input=el(id);
    if (!input || data[id]===undefined) continue;
    if(input.type==='checkbox') input.checked=!!data[id];else input.value=data[id];
  }
  el('sources').value=(data.sources||[]).join('\n');
}
async function start() {
  try {
    const info=await parseResponse(await fetch('/api/info'));
    populate(info.defaultConfig);
    el('allowedHosts').textContent='Approved provider hosts: ' + info.allowedHosts.join(', ');
    const hash=new URLSearchParams(location.hash.slice(1));
    if(hash.get('profile')) await loadToken(hash.get('profile'));
  } catch(e){ message(e.message,true); }
}
async function loadToken(value) {
  const result=await parseResponse(await fetch('/api/profile/'+encodeURIComponent(value)));
  populate(result.config);
  token=value;
  el('manifestUrl').value=`${location.origin}/p/${token}/manifest.json`;
  el('copyManifest').disabled=false;
  el('install').disabled=false;
  message('Configuration loaded. Generate a new link after making changes.');
}
el('settings').addEventListener('submit',async event=>{
  event.preventDefault();el('generate').disabled=true;
  try {
    const response=await fetch('/api/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:readConfig()})});
    const result=await parseResponse(response);
    token=result.token;
    // Use the origin actually serving this page, avoiding reliance on any proxy host headers.
    el('manifestUrl').value=`${location.origin}/p/${token}/manifest.json`;
    el('copyManifest').disabled=false;
    el('install').disabled=false;
    history.replaceState(null,'','#profile='+token);
    message('Stremio link generated. Copy it and install it in Stremio.');
  } catch(e){message(e.message,true);} finally{el('generate').disabled=false;}
});
el('copyManifest').onclick=async()=>{
  try {await navigator.clipboard.writeText(el('manifestUrl').value);message('Manifest URL copied.');}
  catch {el('manifestUrl').select();message('Select and copy the link manually.',true);}
};
el('install').onclick=()=>{
  const uri=el('manifestUrl').value.replace(/^https?:\/\//,'stremio://');
  location.href=uri;
};
el('loadExisting').onclick=async()=>{
  try {
    const raw=el('existingUrl').value.trim();
    const parsed=new URL(raw);
    const match=parsed.pathname.match(/^\/p\/([A-Za-z0-9_-]{10,3400})\/manifest\.json$/);
    if(!match) throw new Error('This is not a Smart Play manifest URL');
    await loadToken(match[1]);
    history.replaceState(null,'','#profile='+match[1]);
  } catch(e){message(e.message,true);}
};
el('cinemaPreset').onclick=()=>{
  const c=readConfig();
  populate({...c,name:'Home Cinema',internetMbps:15,tvResolution:2160,minimumResolution:2160,hdr:'dolbyvision',audio:'atmos',conservative:true,maxFileGB:0});
};
el('easyPreset').onclick=()=>{
  const c=readConfig();
  populate({...c,name:'Family TV',internetMbps:15,tvResolution:1080,minimumResolution:720,hdr:'none',audio:'stereo',conservative:true,maxFileGB:0});
};
el('previewButton').onclick=()=>{
  el('previewPanel').hidden=!el('previewPanel').hidden;
  if(!el('previewPanel').hidden)el('previewPanel').scrollIntoView({behavior:'smooth'});
};
el('jsonFile').onchange=async event=>{
  const file=event.target.files?.[0];if(!file)return;
  if(file.size>850_000)return message('JSON file must be under 850 KB.',true);
  el('jsonInput').value=await file.text();
};
function rankings(where,data) {
  const root=el(where);root.replaceChildren();
  const summary=document.createElement('p');summary.className='muted';
  summary.textContent=`${data.total} unique streams; ${data.eligible} eligible${data.runtimeMinutes?' · '+data.runtimeMinutes+' min':''}.`;
  root.append(summary);
  if(data.sourceErrors?.length) {
    const fail=document.createElement('p');fail.className='bad';fail.textContent='Provider errors: '+data.sourceErrors.join('; ');root.append(fail);
  }
  if(!data.top?.length){const empty=document.createElement('p');empty.textContent='No streams returned.';root.append(empty);}
  for (const [index,item] of (data.top||[]).entries()){
    const wrap=document.createElement('div');wrap.className='result';
    const primary=document.createElement('div');primary.className='main';
    primary.textContent=`${index===0&&item.eligible?'Recommended · ':''}${(item.title||'Unknown stream').split('\n')[0]}`;
    const secondary=document.createElement('div');secondary.className='sub';
    const info=item.metadata||{};
    secondary.textContent=`${item.eligible?'Score '+item.score:'Excluded'} · ${info.resolution||'?'}p · ${info.sizeGB?.toFixed(2)||'?'} GB · ${info.estimatedMbps?.toFixed(1)||'?'} Mbps${info.atmos?' · Atmos':''}${info.dv?' · Dolby Vision':''}${info.seeders!=null?' · '+info.seeders+' peers':''}${item.reasons?.length?' · '+item.reasons.join(' / '):''}`;
    if(!item.eligible)secondary.classList.add('bad');
    wrap.append(primary,secondary);root.append(wrap);
  }
}
el('runPreview').onclick=async()=>{
  try {
    const data=JSON.parse(el('jsonInput').value);
    const res=await parseResponse(await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:readConfig(),streams:data,runtimeMinutes:Number(el('runtimeMinutes').value),type:'movie'})}));
    rankings('previewResults',res);
  }catch(e){message('Preview failed: '+e.message,true);}
};
el('testLive').onclick=async()=>{
  el('testLive').disabled=true;el('results').textContent='Checking sources…';
  try {
    const res=await parseResponse(await fetch('/api/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({config:readConfig(),type:'movie',id:el('testId').value.trim()})}));
    rankings('results',res);
  }catch(e){el('results').textContent=e.message;}
  finally{el('testLive').disabled=false;}
};
start();
