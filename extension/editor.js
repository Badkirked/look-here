'use strict';
const $ = id => document.getElementById(id);
const canvas = $('picture'), ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
let capture, image, current, mode = 'point', busy = false, draftWrites = Promise.resolve(), receiver = null;
const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
function persist() {
  // Queue a snapshot of each edit, so rapid undo/draw events cannot reorder drafts.
  const draft = structuredClone(capture);
  draftWrites = draftWrites.then(() => captureDB.put(draft)).catch(error => message('Could not retain the local draft: ' + error.message, true));
}
function changed() { delete capture.uploadId; $('save').disabled = !receiver; $('export').disabled = false; message('Ready to save. Tell me “look here” in our conversation after saving.'); persist(); }
function paint() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const scale = Math.max(1, canvas.width / 1400);
  for (const mark of [...capture.marks, ...(current ? [current] : [])]) {
    const first = mark.points[0], last = mark.points.at(-1);
    for (const [color, width] of [['white', 7], ['#e83d16', 4]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width * scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      if (mark.mode === 'box' && mark.points.length > 1) ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
      else if (mark.points.every(p => Math.hypot(p.x-first.x,p.y-first.y) < 5*scale)) ctx.arc(first.x, first.y, 14*scale, 0, Math.PI*2);
      else { ctx.moveTo(first.x,first.y); for(const point of mark.points.slice(1))ctx.lineTo(point.x,point.y); }
      ctx.stroke();
    }
  }
}
function position(event) { const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-r.x)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-r.y)*canvas.height/r.height))}; }
canvas.onpointerdown = event => {if(!capture||busy||event.button!==0||current||capture.marks.length>=200)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);current={mode,pointerId:event.pointerId,points:[position(event)]};paint();};
canvas.onpointermove = event => {if(!current||current.pointerId!==event.pointerId||current.points.length>=10000)return;const point=position(event);if(current.mode==='box')current.points[1]=point;else current.points.push(point);paint();};
canvas.onpointerup = event => {if(!current||current.pointerId!==event.pointerId)return;delete current.pointerId;capture.marks.push(current);current=null;paint();changed();};
canvas.onpointercancel = () => {current=null;if(image)paint();};
for(const name of ['point','box'])$(name).onclick=()=>{mode=name;for(const id of ['point','box'])$(id).setAttribute('aria-pressed',String(id===name));};
$('undo').onclick=()=>{if(!capture||busy)return;capture.marks.pop();paint();changed();};
$('zoom').onchange=()=>{canvas.classList.toggle('actual',$('zoom').value==='actual');canvas.style.width=$('zoom').value==='actual'?canvas.width+'px':'';};
$('note').oninput=()=>{if(capture&&!busy){capture.note=$('note').value;changed();}};
$('close').onclick=async()=>{if(busy)return;if(capture&&!capture.uploadId&&(capture.marks.length||capture.note)&&!confirm('Close this local draft without sending it?'))return;await draftWrites;if(capture)await captureDB.remove(capture.id);window.close();};
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
$('save').onclick=async()=>{
  if(!capture||busy||capture.uploadId||!receiver)return;
  if(!capture.marks.length){message('Click a spot, draw, or box an area first.',true);return;}
  busy=true;$('save').disabled=true;$('note').disabled=true;message('Uploading to your configured receiver…');
  try {
    const {receiver:latest}=await chrome.storage.local.get('receiver');
    if(!latest || latest.url!==receiver.url || latest.allowLAN!==receiver.allowLAN)throw Error('Receiver settings changed. Reload this tab before uploading.');
    const destination=lookHerePolicy.destination(receiver.url,receiver.allowLAN);
    if(!await chrome.permissions.contains({origins:[destination.permission]}))throw Error('Receiver permission was removed. Open Settings to reconnect.');
    const {receiverToken}=await chrome.storage.session.get('receiverToken');
    const bundle=makeBundle();
    const form=new FormData();form.append('file',new Blob([JSON.stringify(bundle)],{type:'application/json'}),'look-here-'+capture.id+'.json');form.append('uploader','look-here');form.append('tags','look-here,browser-extension');
    if(receiverToken && receiverToken.url!==destination.url)throw Error('Receiver credentials changed. Reopen Settings before uploading.');
    const headers=receiverToken?.token?{Authorization:'Bearer '+receiverToken.token}:{};
    const response=await fetch(destination.url,{method:'POST',body:form,headers,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Server returned '+response.status);
    const result=await response.json();if(!Number.isSafeInteger(result.id)||result.id<=0)throw Error('No save confirmation received');
    capture.uploadId=result.id;await draftWrites;await captureDB.remove(capture.id);
    message(`Saved mark #${result.id}. Tell me “look here” in our conversation, or quote #${result.id}.`);
  } catch(error) {message('Save failed: '+error.message+'. Your screenshot and marks are still here. Check your receiver connection and retry.',true);$('save').disabled=false;}
  finally{busy=false;$('note').disabled=false;}
};
(async()=>{
  try {
    if(params.has('error'))throw Error(params.get('error'));
    await captureDB.prune();
    ({receiver}=await chrome.storage.local.get('receiver'));
    if(receiver){const destination=lookHerePolicy.destination(receiver.url,receiver.allowLAN);$('destination').textContent='Upload destination: '+destination.url+(destination.insecure?' (unencrypted HTTP)':'');}
    capture=await captureDB.get(params.get('id'));
    if(!capture)throw Error('This capture is no longer available. Return to the page and click the Look here extension again.');
    image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Could not open the captured image'));im.src=capture.original;});
    if(image.naturalWidth*image.naturalHeight>lookHerePolicy.maxPixels)throw Error('Screenshot dimensions exceed the supported limit.');
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    $('source').textContent=capture.title+' — '+capture.url;$('source').title=$('source').textContent;$('note').value=capture.note;
    paint();$('save').disabled=!receiver||Boolean(capture.uploadId);$('export').disabled=false;
    if(capture.uploadId)message(`Saved mark #${capture.uploadId}. Tell me “look here” in our conversation.`);
  } catch(error) {message(error.message,true);$('source').textContent='Capture unavailable';canvas.hidden=true;}
})();

function makeBundle(){
  const {id,uploadId,...data}=capture;
  const bundle={...data,url:lookHerePolicy.safePageURL(data.url),width:canvas.width,height:canvas.height,savedAt:new Date().toISOString(),annotated:canvas.toDataURL('image/png')};
  if(new Blob([JSON.stringify(bundle)]).size>lookHerePolicy.maxBundleBytes)throw Error('This capture exceeds the 40 MiB sharing limit.');
  return bundle;
}
$('settings').onclick=()=>chrome.runtime.openOptionsPage();
$('export').onclick=()=>{
  if(!capture||busy)return;
  try{
    const blob=new Blob([JSON.stringify(makeBundle())],{type:'application/json'});
    const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='look-here-'+capture.id+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
    message('Export started. Give the downloaded file to your assistant through your usual file workflow.');
  }catch(error){message(error.message,true);}
};
