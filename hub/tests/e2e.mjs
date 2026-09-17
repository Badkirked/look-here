import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
if(!process.env.CHROME_PATH)throw Error('Set CHROME_PATH to a recent Chromium binary');
const results=path.resolve(process.env.TEST_RESULTS||'test-results/hub');await fs.mkdir(results,{recursive:true});
const extension=await fs.mkdtemp(path.join(os.tmpdir(),'look-here-test-extension-'));await fs.cp(fileURLToPath(new URL('../extension/',import.meta.url)),extension,{recursive:true});
const manifest=JSON.parse(await fs.readFile(extension+'/manifest.json','utf8'));manifest.host_permissions=['http://127.0.0.1/*'];await fs.writeFile(extension+'/manifest.json',JSON.stringify(manifest));
const profile=await fs.mkdtemp('/tmp/look-here-extension-');
const browser=spawn(process.env.CHROME_PATH,['--headless=new','--password-store=basic','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--enable-unsafe-extension-debugging','--remote-debugging-port=0','--user-data-dir='+profile,'--window-size=1440,1100','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));const sockets=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise(r=>ws.onopen=r);let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result)}};return (method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
try{
let port;for(let i=0;i<100;i++){try{port=(await fs.readFile(profile+'/DevToolsActivePort','utf8')).split('\n')[0];break}catch{await delay(100)}}if(!port)throw Error('No debug port');
const base='http://127.0.0.1:'+port;
const protocol=await(await fetch(base+'/json/protocol')).json();

const version=await(await fetch(base+'/json/version')).json();
const control=await connect(version.webSocketDebuggerUrl);
const installed=await control('Extensions.loadUnpacked',{path:extension});console.log('Installed:',installed);
const targets=()=>fetch(base+'/json/list').then(r=>r.json());
let page=(await targets()).find(t=>t.type==='page');const pageCall=await connect(page.webSocketDebuggerUrl);
await pageCall('Page.enable');await pageCall('Runtime.enable');
const evaluate=async(call,expression)=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
const waitFor=async(fn,label)=>{for(let i=0;i<200;i++){const r=await fn();if(r)return r;await delay(100)}throw Error('Timed out: '+label)};

const worker=await waitFor(async()=> (await targets()).find(t=>t.type==='service_worker'&&t.url.includes(installed.id)),'worker');
const wc=await connect(worker.webSocketDebuggerUrl);await wc('Runtime.enable');await waitFor(()=>evaluate(wc,'!!globalThis.chrome?.storage?.local'),'worker storage');
await evaluate(wc,"chrome.storage.local.set({hubUrl:'http://127.0.0.1:18420',urlWatchEnabled:false})");
await pageCall('Page.navigate',{url:'http://127.0.0.1:18420/preview'});
await waitFor(()=>evaluate(pageCall,"document.querySelector('h1')?.textContent.includes('end-to-end')"),'preview');
await pageCall('Page.bringToFront');
const tabTargets=await control('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
await control('Extensions.triggerAction',{id:installed.id,targetId:tabTargets.targetInfos.find(t=>t.url.includes('/preview')).targetId});
const editor=await waitFor(async()=> (await targets()).find(t=>t.url.includes('/editor.html')),'editor');
const ec=await connect(editor.webSocketDebuggerUrl);await ec('Runtime.enable');await ec('Page.enable');
await waitFor(()=>evaluate(ec,'typeof image!=="undefined"&&!!image'),'image');
await evaluate(ec,"document.getElementById('redact').click()");
const rect=await evaluate(ec,'(()=>{const r=canvas.getBoundingClientRect();return {x:r.x,y:r.y,s:r.width/canvas.width}})()');
const a={x:rect.x+50*rect.s,y:rect.y+50*rect.s},b={x:rect.x+250*rect.s,y:rect.y+150*rect.s};
await ec('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...a});
await ec('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...b});
await ec('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...b});
await waitFor(()=>evaluate(ec,'!busy&&capture.redactions?.length===1'),'redaction');
const pixel=await evaluate(ec,'(()=>{const c=document.createElement("canvas");c.width=image.width;c.height=image.height;const x=c.getContext("2d");x.drawImage(image,0,0);return Array.from(x.getImageData(150,100,1,1).data)})()');
if(JSON.stringify(pixel)!=='[0,0,0,255]')throw Error('Original not redacted: '+pixel);
await evaluate(ec,"document.getElementById('project').value='gst-test';document.getElementById('project').dispatchEvent(new Event('input'));document.getElementById('note').value='Redacted fixture';document.getElementById('note').dispatchEvent(new Event('input'));window.realFetch=fetch;window.dropReply=true;window.fetch=async(...args)=>{const r=await realFetch(...args);if(dropReply&&String(args[0]).includes('/captures')){dropReply=false;throw Error('Simulated lost reply after server save');}return r;};document.getElementById('save').click()");
await waitFor(()=>evaluate(ec,"document.getElementById('message').textContent.startsWith('Save failed')"),'lost reply');
await evaluate(ec,"document.getElementById('save').click()");
await waitFor(()=>evaluate(ec,'!!capture.uploadId'),'retry saved');
const proof=await evaluate(ec,"lookFetch('/api/look-here/captures').then(x=>({count:x.count,project:x.captures[0].project}))");
if(proof.count!==1||proof.project!=='gst-test')throw Error('Retry duplicated save or label lost');
// Verify uploaded original AND annotated pixels, not just the editor overlay.
const uploaded=await evaluate(ec,"(async()=>{const list=await lookFetch('/api/look-here/captures');const r=await realFetch('http://127.0.0.1:18420/files/'+list.captures[0].filename);const bundle=await r.json();const pixels=[];for(const name of ['original','annotated']){const im=await new Promise(resolve=>{const i=new Image();i.onload=()=>resolve(i);i.src=bundle[name]});const c=document.createElement('canvas');c.width=im.width;c.height=im.height;const x=c.getContext('2d');x.drawImage(im,0,0);pixels.push(Array.from(x.getImageData(150,100,1,1).data));}return pixels})()");
if(JSON.stringify(uploaded)!=='[[0,0,0,255],[0,0,0,255]]')throw Error('Upload leaked unredacted original');
await ec('Page.reload');await waitFor(()=>evaluate(ec,'typeof capture!=="undefined"&&capture?.uploadId'),'reload saved draft');
console.log('PASS redaction of both uploaded PNGs, lost-reply idempotent retry, labels, reload recovery');
// Pending poll is released after pause: it must not create a tab.
await evaluate(wc,"globalThis.realFetch=fetch;globalThis.releasePoll=null;globalThis.fetch=()=>new Promise(resolve=>{releasePoll=resolve;});chrome.storage.local.set({urlWatchEnabled:true,urlCursor:0,urlQueue:[]})");
await waitFor(()=>evaluate(wc,'!!releasePoll'),'pending poll');
await evaluate(wc,"chrome.storage.local.set({urlWatchEnabled:false})");
await evaluate(wc,"releasePoll({ok:true,json:async()=>({latest:99,events:[{id:99,url:'http://127.0.0.1:18420/preview?paused=1',machine:'test',session:'test'}],machines:[]})})");
await delay(300);if((await targets()).some(t=>t.url.includes('paused=1')))throw Error('Pause race opened a tab');
await evaluate(wc,"globalThis.fetch=realFetch");
console.log('PASS pause during in-flight request opens no tab');
await pageCall('Page.navigate',{url:'chrome-extension://'+installed.id+'/options.html'});
await waitFor(()=>evaluate(pageCall,"document.getElementById('drafts')?.textContent.includes('Saved #')"),'history draft');
await waitFor(()=>evaluate(pageCall,"document.getElementById('captures')?.textContent.includes('gst-test')"),'saved history');
let shot=await pageCall('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await fs.writeFile(path.join(results,'options.png'),Buffer.from(shot.data,'base64'));
shot=await ec('Page.captureScreenshot',{format:'png'});await fs.writeFile(path.join(results,'editor.png'),Buffer.from(shot.data,'base64'));
console.log('PASS history/settings rendered; E2E COMPLETE');
}finally{for(const ws of sockets)ws.close();browser.kill('SIGTERM');}
