'use strict';
const LOOK_DEFAULTS={hubUrl:'http://localhost:8420',urlWatchEnabled:false,watchMode:'auto',allowedDomains:'',cooldownMinutes:60,draftRetentionDays:30,project:'',thread:''};
async function lookSettings(){return {...LOOK_DEFAULTS,...await chrome.storage.local.get(Object.keys(LOOK_DEFAULTS))};}
function lookOrigin(value){const u=new URL(value);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Use a hub origin, such as http://localhost:8420');return u.origin;}
async function lookFetch(path,options={}){const s=await lookSettings();const r=await fetch(s.hubUrl+path,{...options,credentials:'include',signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('Hub returned '+r.status);return r.json();}
