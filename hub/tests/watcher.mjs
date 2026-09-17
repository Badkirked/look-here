import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const state={hubUrl:'http://test.local',urlWatchEnabled:true,urlCursor:0,urlQueue:[],watchMode:'auto',cooldownMinutes:60};const opened=[];let next;
const c={URL,AbortSignal,Date,console,setTimeout,clearTimeout,fetch:async()=>({ok:true,json:async()=>next}),chrome:{storage:{local:{async get(keys){if(Array.isArray(keys))return Object.fromEntries(keys.filter(k=>k in state).map(k=>[k,structuredClone(state[k])]));return {[keys]:structuredClone(state[keys])};},async set(values){Object.assign(state,structuredClone(values));}},onChanged:{addListener(){}}},tabs:{async create(x){opened.push(x);return {id:opened.length};}},alarms:{async create(){},async clear(){},onAlarm:{addListener(){}}},runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(){}}}}};
vm.createContext(c);const root=new URL('../extension/',import.meta.url);vm.runInContext(fs.readFileSync(new URL('config.js',root),'utf8')+'\n'+fs.readFileSync(new URL('url-watch.js',root),'utf8'),c);
function feed(id,url,extra={}){next={latest:id,events:[{id,url,machine:'test',session:'session'}],machines:[{machine:'offline',checked:0,panes:0,error:'Connection unavailable'}],retentionDays:7,...extra};}
feed(1,'http://example.test/a');await vm.runInContext('pollTmuxURLs()',c);assert.equal(opened.length,1);assert.match(state.urlWatchStatus,/1 unavailable/);
feed(2,'http://example.test/a');await vm.runInContext('pollTmuxURLs()',c);assert.equal(opened.length,1);assert.equal(state.urlQueue.at(-1).state,'suppressed');
await vm.runInContext('openWatchItem(2,true)',c);assert.equal(opened.length,2);
state.watchMode='review';feed(3,'http://example.test/b');await vm.runInContext('pollTmuxURLs()',c);assert.equal(opened.length,2);assert.equal(state.urlQueue.at(-1).state,'queued');
state.allowedDomains='*.allowed.test';feed(4,'http://blocked.test/a');await vm.runInContext('pollTmuxURLs()',c);assert.equal(state.urlQueue.at(-1).state,'filtered');
feed(5,'http://app.allowed.test/a',{gap:true});await vm.runInContext('pollTmuxURLs()',c);assert.equal(state.urlQueue.at(-1).state,'queued');assert.match(state.urlWarning,/expired/);
state.watchMode='auto';state.allowedDomains='';feed(6,'http://example.test/recovery');await vm.runInContext('pollTmuxURLs(true)',c);assert.equal(state.urlRecoveryCursor,6);assert.equal(state.urlCursor,5);assert.equal(opened.length,2);assert.equal(state.urlQueue.at(-1).recovered,true);
assert.equal(vm.runInContext("safeLink('https://a.test/token/secret')",c),null);
console.log('PASS: auto-open, cooldown, manual reopen, review mode, domain filtering, failure status, history gap, non-opening recovery, sensitive paths');
