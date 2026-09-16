import {spawn,spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
if(!process.env.HEADFUL)throw Error('The optional-permission test needs HEADFUL=1 and a display (or xvfb-run).');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(!process.env.CHROME_PATH)throw Error('Set CHROME_PATH to a Chrome/Chromium executable');
const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'look-here-browser-'));
const downloads=path.join(scratch,'downloads');await fs.mkdir(downloads);
let uploadMode='success',posts=[],leaks=0;
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/page')){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>&lt;img src=x onerror=alert(1)&gt;</title><style>body{font:24px system-ui;background:#def;padding:50px}button{font:inherit}</style><h1>Whole-page review fixture</h1><p>Point at this heading or the button.</p><button>Example control</button>');return;}
 if(req.url==='/leak'){leaks++;res.end('unexpected');return;}
 if(req.url==='/api/upload'){
  const chunks=[];for await(const part of req)chunks.push(part);posts.push({headers:req.headers,body:Buffer.concat(chunks).toString()});
  if(uploadMode==='redirect'){res.writeHead(307,{Location:'/leak'});res.end();return;}
  if(uploadMode==='failure'){res.writeHead(503);res.end('unavailable');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:77}));return;
 }
 res.writeHead(404);res.end();
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const browser=spawn(process.env.CHROME_PATH,[...(process.env.HEADFUL?[]:['--headless=new']),'--no-sandbox','--disable-dev-shm-usage','--no-first-run','--enable-unsafe-extension-debugging','--remote-debugging-port=0','--user-data-dir='+path.join(scratch,'profile'),'--window-size=1400,1000','about:blank'],{stdio:'ignore'});
const delay=ms=>new Promise(r=>setTimeout(r,ms));const sockets=[];const errors=[];
async function connect(url){const ws=new WebSocket(url);sockets.push(ws);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});let seq=0;const pending=new Map();ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.text);if(m.id&&pending.has(m.id)){const {resolve,reject}=pending.get(m.id);pending.delete(m.id);m.error?reject(Error(JSON.stringify(m.error))):resolve(m.result);}};return (method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});}
const waitFor=async(fn,label)=>{for(let i=0;i<150;i++){const value=await fn();if(value)return value;await delay(100);}throw Error('Timed out: '+label);};
const evaluate=async(call,expression)=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,userGesture:true});if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));return result.result.value;};
try{
 const port=await waitFor(async()=>{try{return(await fs.readFile(path.join(scratch,'profile/DevToolsActivePort'),'utf8')).split('\n')[0];}catch{return null;}},'debug port');
 const base='http://127.0.0.1:'+port;
 const targets=()=>fetch(base+'/json/list').then(r=>r.json());
 const version=await(await fetch(base+'/json/version')).json();const control=await connect(version.webSocketDebuggerUrl);
 await control('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
 const installed=await control('Extensions.loadUnpacked',{path:path.join(repo,'extension')});
 const worker=await waitFor(async()=>(await targets()).find(t=>t.type==='service_worker' && t.url.includes(installed.id)),'extension worker');const workerCall=await connect(worker.webSocketDebuggerUrl);await workerCall('Runtime.enable');await waitFor(()=>evaluate(workerCall,'typeof capturing!=="undefined"'),'worker ready');
 const optionsTarget=await control('Target.createTarget',{url:'chrome-extension://'+installed.id+'/options.html'});
 const settingsInfo=await waitFor(async()=>(await targets()).find(t=>t.id===optionsTarget.targetId),'settings');
 const settings=await connect(settingsInfo.webSocketDebuggerUrl);await settings('Runtime.enable');
 await waitFor(()=>evaluate(settings,'document.getElementById("endpoint")'),'settings ready');await delay(150);
 assert.equal(await evaluate(settings,'document.getElementById("status").textContent'),'');
 await evaluate(settings,"document.getElementById('endpoint').value='http://example.com/upload';document.getElementById('settings').dispatchEvent(new Event('submit',{cancelable:true}))");
 assert.ok((await evaluate(settings,'document.getElementById("status").textContent')).includes('Use HTTPS'));
 await control('Target.closeTarget',{targetId:optionsTarget.targetId});
 const page=(await targets()).find(t=>t.type==='page');const pageCall=await connect(page.webSocketDebuggerUrl);await pageCall('Runtime.enable');
 await pageCall('Page.navigate',{url:origin+'/page?access_token=must-not-export#private-fragment'});
 await waitFor(()=>evaluate(pageCall,'document.querySelector("h1")'),'fixture');
 await evaluate(pageCall,"document.cookie='fixture_session=must-not-upload'");
 await pageCall('Page.bringToFront');
 const tabs=await control('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
 await control('Extensions.triggerAction',{id:installed.id,targetId:tabs.targetInfos.find(t=>t.url.includes('/page')).targetId});
 const editor=await waitFor(async()=>(await targets()).find(t=>t.url.includes('/editor.html')),'editor');const edit=await connect(editor.webSocketDebuggerUrl);await edit('Runtime.enable');
 await waitFor(()=>evaluate(edit,'typeof capture!=="undefined" && Boolean(capture?.original) && !document.getElementById("export").disabled'),'editor ready');
 assert.equal(await evaluate(edit,'capture.url'),origin+'/page');
 assert.equal(await evaluate(edit,'document.getElementById("save").disabled'),true);
 assert.equal(await evaluate(edit,'document.getElementById("source").children.length'),0);
 assert.equal(posts.length,0);
 await evaluate(edit,'document.getElementById("export").click()');
 const exportName=await waitFor(async()=>(await fs.readdir(downloads)).find(n=>n.endsWith('.json')),'local export');
 const exported=JSON.parse(await fs.readFile(path.join(downloads,exportName),'utf8'));
 assert.equal(exported.url,origin+'/page');assert.ok(exported.original.startsWith('data:image/png;base64,'));assert.equal(posts.length,0);
 const rect=await evaluate(edit,'(()=>{const r=canvas.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()');
 const pt={x:rect.x+rect.width*.3,y:rect.y+rect.height*.14};
 await edit('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...pt});await edit('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...pt});
 await evaluate(edit,'draftWrites');await edit('Page.reload');
 await waitFor(()=>evaluate(edit,'typeof capture!=="undefined" && capture?.marks.length===1 && image'),'draft restored');
 // Optional host access requires real user consent in a headed browser.
 await evaluate(edit,"chrome.permissions.request({origins:['http://127.0.0.1/*']}).then(value=>globalThis.testConsent=value);void 0");
 await delay(1000);
 if(process.env.HEADFUL){
  await fs.mkdir(path.join(repo,'test-results'),{recursive:true});
  spawnSync('python3',['-c',"from PIL import ImageGrab; ImageGrab.grab().save('test-results/permission-prompt.png')"],{cwd:repo,env:process.env});
  console.log('Permission prompt ready on display',process.env.DISPLAY);
  if(process.env.TEST_ACCEPT_PERMISSION==='1'){
   const result=spawnSync('python3',['-c',"from Xlib import X, XK, display; from Xlib.ext import xtest; d=display.Display(); xtest.fake_input(d,X.KeyPress,d.keysym_to_keycode(XK.string_to_keysym('Tab'))); xtest.fake_input(d,X.KeyRelease,d.keysym_to_keycode(XK.string_to_keysym('Tab'))); xtest.fake_input(d,X.KeyPress,d.keysym_to_keycode(XK.string_to_keysym('Return'))); xtest.fake_input(d,X.KeyRelease,d.keysym_to_keycode(XK.string_to_keysym('Return'))); d.sync()"],{env:process.env});
   if(result.status!==0)throw Error('Could not accept the isolated test-profile permission prompt');
  }else await delay(20000);
 }
 await waitFor(()=>evaluate(edit,'globalThis.testConsent===true'),'receiver permission consent');
 assert.equal(await evaluate(edit,"chrome.permissions.contains({origins:['http://127.0.0.1/*']})"),true);
 await evaluate(edit,`chrome.storage.local.set({receiver:{url:${JSON.stringify(origin+'/api/upload')},allowLAN:true}})`);
 await evaluate(edit,`chrome.storage.session.set({receiverToken:{url:${JSON.stringify(origin+'/api/upload')},token:'test-fixture-only'}})`);
 await edit('Page.reload');await waitFor(()=>evaluate(edit,'typeof receiver!=="undefined" && receiver && !document.getElementById("save").disabled'),'receiver loaded');
 uploadMode='redirect';await evaluate(edit,'document.getElementById("save").click()');
 await waitFor(()=>evaluate(edit,'document.getElementById("message").textContent.startsWith("Save failed")'),'redirect rejected');assert.equal(leaks,0);
 assert.equal(posts[0].headers.cookie,undefined);assert.equal(posts[0].headers.authorization,'Bearer test-fixture-only');
 assert.ok(!posts[0].body.includes('access_token'));assert.ok(!posts[0].body.includes('private-fragment'));
 uploadMode='success';await evaluate(edit,'document.getElementById("save").click()');
 await waitFor(()=>evaluate(edit,'document.getElementById("message").textContent.startsWith("Saved mark #77")'),'upload success');
 assert.equal(await evaluate(edit,'captureDB.get(capture.id).then(Boolean)'),false);
 const beforeChangedDestination=posts.length;
 await evaluate(edit,"delete capture.uploadId;document.getElementById('note').value='new edit';document.getElementById('note').dispatchEvent(new Event('input'))");
 await evaluate(edit,`chrome.storage.local.set({receiver:{url:${JSON.stringify(origin+'/leak')},allowLAN:true}})`);
 await evaluate(edit,'document.getElementById("save").click()');
 await waitFor(()=>evaluate(edit,'document.getElementById("message").textContent.includes("Receiver settings changed")'),'changed destination refused');
 assert.equal(posts.length,beforeChangedDestination);assert.equal(leaks,0);
 await evaluate(edit,`chrome.storage.local.set({receiver:{url:${JSON.stringify(origin+'/api/upload')},allowLAN:true}})`);
 await evaluate(edit,`chrome.storage.session.set({receiverToken:{url:${JSON.stringify(origin+'/different-receiver')},token:'must-not-leak'}})`);
 await evaluate(edit,'document.getElementById("save").click()');
 await waitFor(()=>evaluate(edit,'document.getElementById("message").textContent.includes("Receiver credentials changed")'),'credential scope refused');
 assert.equal(posts.length,beforeChangedDestination);
 const shot=await edit('Page.captureScreenshot',{format:'png'});await fs.mkdir(path.join(repo,'test-results'),{recursive:true});await fs.writeFile(path.join(repo,'test-results/editor.png'),Buffer.from(shot.data,'base64'));
 await evaluate(edit,"captureDB.put({id:'expired',capturedAt:'2000-01-01T00:00:00Z'}).then(()=>captureDB.prune())");assert.equal(await evaluate(edit,"captureDB.get('expired').then(Boolean)"),false);
 await evaluate(edit,"Promise.all(Array.from({length:12},(_,i)=>captureDB.put({id:'bounded-'+i,capturedAt:new Date(Date.now()+i).toISOString()}))).then(()=>captureDB.prune())");assert.equal(await evaluate(edit,"captureDB.run('readonly',s=>s.count())"),10);
 assert.deepEqual(errors,[]);
 console.log('PASS: real extension capture, URL sanitization, safe title rendering, default offline export, draft recovery, scoped receiver permission, redirect rejection, no cookies, bearer upload, successful-upload cleanup, draft expiry/count limit, changed-destination refusal.');
}finally{
 for(const ws of sockets)ws.close();browser.kill('SIGTERM');await new Promise(resolve=>server.close(resolve));
 await delay(300);await fs.rm(scratch,{recursive:true,force:true});
}
