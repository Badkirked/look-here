'use strict';
let urlPollRunning=false;
let watchOperations=Promise.resolve();
function exclusive(fn){const task=watchOperations.then(fn,fn);watchOperations=task.catch(()=>{});return task;}
function safeLink(value){try{const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return null;
 if([...u.searchParams.keys()].some(k=>/password|passwd|token|secret|signature|credential|api.?key|^code$|^sig$/i.test(k)))return null;
 if(/(?:reset|verify|magic|enrol|invite|token|secret|auth|login)[-/]/i.test(u.pathname)||/[A-Za-z0-9_-]{32,}/.test(u.pathname+u.hash))return null;return u;}catch{return null;}}
function allowedLink(url,domains){const allowed=domains.split(/[\s,]+/).filter(Boolean).map(s=>s.toLowerCase());return !allowed.length||allowed.some(d=>url.hostname===d||(d.startsWith('*.')&&url.hostname.endsWith(d.slice(1))));}
async function openWatchItem(id,manual=false){
 let s=await lookSettings(),data=await chrome.storage.local.get(['urlQueue','openedURLsV2']);
 const queue=data.urlQueue||[],event=queue.find(e=>e.id===id&&e.hub===s.hubUrl);if(!event)return;
 const url=safeLink(event.url);if(!url)throw Error('Link rejected: unsupported or potentially sensitive URL');
 if(!manual&&(!s.urlWatchEnabled||s.watchMode!=='auto'||!allowedLink(url,s.allowedDomains)))return;
 const opened=data.openedURLsV2||{};
 if(!manual&&Date.now()-(opened[url.href]||0)<s.cooldownMinutes*60000){event.state='suppressed';await chrome.storage.local.set({urlQueue:queue});return;}
 // Recheck after async work: a paused or reconfigured watcher must not open tabs.
 const current=await lookSettings();if(!manual&&(!current.urlWatchEnabled||current.watchMode!=='auto'||current.hubUrl!==s.hubUrl))return;
 await chrome.tabs.create({url:url.href,active:manual});
 event.state='opened';opened[url.href]=Date.now();
 for(const [key,when] of Object.entries(opened))if(Date.now()-when>30*86400000)delete opened[key];
 const boundedOpened=Object.fromEntries(Object.entries(opened).sort((a,b)=>b[1]-a[1]).slice(0,2000));
 await chrome.storage.local.set({urlQueue:queue,openedURLsV2:boundedOpened,urlWatchLast:{url:url.href,machine:event.machine,session:event.session}});
}
function pollTmuxURLs(recover=false){return exclusive(()=>pollInternal(recover));}
async function pollInternal(recover=false){
 if(urlPollRunning)return;urlPollRunning=true;
 try{
  const s=await lookSettings();if(!s.urlWatchEnabled&&!recover)return;
  const state=await chrome.storage.local.get(['urlCursor','urlQueue','urlRecoveryCursor']);
  const cursor=recover?(state.urlRecoveryCursor||0):state.urlCursor;
  const response=await fetch(s.hubUrl+'/api/look-here/urls'+(Number.isInteger(cursor)?'?after='+cursor+'&limit=50':'?limit=50'),{credentials:'include',signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw Error('Hub connection failed ('+response.status+')');const data=await response.json();
  const fresh=await lookSettings();if(fresh.hubUrl!==s.hubUrl||(!fresh.urlWatchEnabled&&!recover))return;
  let queue=state.urlQueue||[],next=cursor;
  queue=[...queue.filter(e=>e.state==='queued'),...queue.filter(e=>e.state!=='queued'&&Date.now()-e.received<7*86400000).slice(-500)].sort((a,b)=>a.received-b.received);
  let warning=data.gap?'Some older events expired. Recover retained links to inspect what remains.':'';
  if(!Number.isInteger(cursor))next=data.latest;
  else for(const event of data.events){
   if(queue.filter(e=>e.state==='queued').length>=500){warning='Queue full (500). Open or dismiss links to resume collection.';break;}
   const url=safeLink(event.url);
   if(url&&!queue.some(e=>e.hub===s.hubUrl&&e.id===event.id))queue.push({...event,hub:s.hubUrl,received:Date.now(),state:allowedLink(url,s.allowedDomains)?'queued':'filtered',recovered:recover});
   next=event.id;
  }
  // Manual recovery stays in review: never auto-open an old batch.
  if(!recover&&data.events.length===0)next=Math.max(next||0,data.latest);
  const machines=data.machines||[],bad=machines.filter(m=>m.error||Date.now()/1000-m.checked>90),gaps=machines.filter(m=>m.warnings?.length);
  const status=(fresh.urlWatchEnabled?'Watching':'Paused')+' '+machines.length+' configured machines; '+bad.length+' unavailable/stale; '+gaps.length+' with history warnings.';
  const update={urlQueue:queue,urlMachines:machines,urlWatchStatus:status,urlCheckedAt:Date.now(),urlRetentionDays:data.retentionDays,urlEventCount:data.eventCount,urlWarning:warning};
  if(!recover)update.urlCursor=next;
  else {update.urlRecoveryCursor=next;update.urlWarning=data.events.length?'Recovered up to 50 retained links for review. Click again for the next batch.':'No more retained links to recover.';}
  await chrome.storage.local.set(update);
  if(!recover&&fresh.watchMode==='auto')for(const e of queue.filter(e=>e.hub===s.hubUrl&&e.state==='queued'&&!e.recovered).slice(0,3))await openWatchItem(e.id);
 }catch(error){await chrome.storage.local.set({urlWatchStatus:error.message+'. Will retry automatically.'});}
 finally{urlPollRunning=false;}
}
async function syncURLWatch(){const s=await lookSettings();if(s.urlWatchEnabled){await chrome.alarms.create('look-here-tmux-urls',{periodInMinutes:0.5});await pollTmuxURLs();}else{await chrome.alarms.clear('look-here-tmux-urls');await chrome.storage.local.set({urlWatchStatus:'Paused.'});}}
chrome.alarms.onAlarm.addListener(a=>{if(a.name==='look-here-tmux-urls')pollTmuxURLs();});
chrome.runtime.onInstalled.addListener(syncURLWatch);chrome.runtime.onStartup.addListener(syncURLWatch);
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&(changes.urlWatchEnabled||changes.hubUrl||changes.watchMode))syncURLWatch();});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
 if(!['poll','recover','open','dismiss'].includes(m.action))return;
 (async()=>{if(m.action==='poll')await pollTmuxURLs();if(m.action==='recover')await pollTmuxURLs(true);if(m.action==='open')await exclusive(()=>openWatchItem(m.id,true));
 if(m.action==='dismiss')await exclusive(async()=>{const s=await lookSettings(),d=await chrome.storage.local.get('urlQueue');await chrome.storage.local.set({urlQueue:(d.urlQueue||[]).map(e=>e.id===m.id&&e.hub===s.hubUrl?{...e,state:'dismissed'}:e)});});return {ok:true};})().then(reply,e=>reply({error:e.message}));return true;
});
