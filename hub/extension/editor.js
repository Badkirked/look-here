'use strict';
const $ = id => document.getElementById(id);
const canvas = $('picture'), ctx = canvas.getContext('2d');
const params = new URLSearchParams(location.search);
let capture, image, current, mode = 'point', busy = false, draftWrites = Promise.resolve();
const message = (text, error = false) => { $('message').textContent = text; $('message').classList.toggle('error', error); };
function persist() {
  // Queue a snapshot of each edit, so rapid undo/draw events cannot reorder drafts.
  const draft = structuredClone(capture);
  draftWrites = draftWrites.then(() => captureDB.put(draft)).catch(error => message('Could not retain the local draft: ' + error.message, true));
}
function changed() { delete capture.uploadId; capture.saveKey=crypto.randomUUID(); $('save').disabled = false; message('Ready to save. Tell me “look here” in our conversation after saving.'); persist(); }
function paint() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const scale = Math.max(1, canvas.width / 1400);
  for (const mark of [...capture.marks, ...(current ? [current] : [])]) {
    const first = mark.points[0], last = mark.points.at(-1);
    for (const [color, width] of [['white', 7], ['#e83d16', 4]]) {
      ctx.strokeStyle = color; ctx.lineWidth = width * scale; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      if (['box','redact'].includes(mark.mode) && mark.points.length > 1) ctx.rect(first.x, first.y, last.x - first.x, last.y - first.y);
      else if (mark.points.every(p => Math.hypot(p.x-first.x,p.y-first.y) < 5*scale)) ctx.arc(first.x, first.y, 14*scale, 0, Math.PI*2);
      else { ctx.moveTo(first.x,first.y); for(const point of mark.points.slice(1))ctx.lineTo(point.x,point.y); }
      ctx.stroke();
    }
  }
}
function position(event) { const r=canvas.getBoundingClientRect();return {x:Math.max(0,Math.min(canvas.width,(event.clientX-r.x)*canvas.width/r.width)),y:Math.max(0,Math.min(canvas.height,(event.clientY-r.y)*canvas.height/r.height))}; }
canvas.onpointerdown = event => {if(!capture||busy||event.button!==0||current)return;event.preventDefault();canvas.setPointerCapture(event.pointerId);current={mode,pointerId:event.pointerId,points:[position(event)]};paint();};
canvas.onpointermove = event => {if(!current||current.pointerId!==event.pointerId)return;const point=position(event);if(['box','redact'].includes(current.mode))current.points[1]=point;else current.points.push(point);paint();};
canvas.onpointerup = async event => {
 if(!current||current.pointerId!==event.pointerId)return;const mark=current;current=null;delete mark.pointerId;
 if(mark.mode==='redact'){
  const a=mark.points[0],b=mark.points.at(-1),x=Math.floor(Math.min(a.x,b.x)),y=Math.floor(Math.min(a.y,b.y)),width=Math.ceil(Math.abs(b.x-a.x)),height=Math.ceil(Math.abs(b.y-a.y));
  if(width<2||height<2){paint();return;}
  busy=true;
  try{const clean=document.createElement('canvas');clean.width=canvas.width;clean.height=canvas.height;const c=clean.getContext('2d');c.drawImage(image,0,0);c.fillStyle='#000';c.fillRect(x,y,width,height);
   capture.original=clean.toDataURL('image/png');capture.redactions=capture.redactions||[];capture.redactions.push({x,y,width,height});
   image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=capture.original;});
   // The original pixels are replaced in the saved draft, not merely covered in annotated output.
   changed();await draftWrites;
  }finally{busy=false;paint();}
 }else{capture.marks.push(mark);paint();changed();}
};
canvas.onpointercancel = () => {current=null;if(image)paint();};
for(const name of ['point','box','redact'])$(name).onclick=()=>{mode=name;for(const id of ['point','box','redact'])$(id).setAttribute('aria-pressed',String(id===name));};
$('undo').onclick=()=>{if(!capture||busy)return;capture.marks.pop();paint();changed();};
$('zoom').onchange=()=>{canvas.classList.toggle('actual',$('zoom').value==='actual');canvas.style.width=$('zoom').value==='actual'?canvas.width+'px':'';};
$('note').oninput=()=>{if(capture&&!busy){capture.note=$('note').value;changed();}};
$('close').onclick=async()=>{if(busy)return;await draftWrites;window.close();};
for(const field of ['project','thread'])$(field).oninput=()=>{if(capture&&!busy){capture[field]=$(field).value;changed();}};
window.addEventListener('beforeunload',event=>{if(busy){event.preventDefault();event.returnValue='';}});
$('save').onclick=async()=>{
  if(!capture||busy||capture.uploadId)return;
  busy=true;$('save').disabled=true;$('note').disabled=true;message('Saving to the LAN…');
  try {
    const {id,uploadId,...data}=capture;
    const bundle={...data,width:canvas.width,height:canvas.height,savedAt:new Date().toISOString(),annotated:canvas.toDataURL('image/png')};
    if(!capture.saveKey){capture.saveKey=crypto.randomUUID();persist();await draftWrites;}
    bundle.saveKey=capture.saveKey;
    const settings=await lookSettings();
    const response=await fetch(settings.hubUrl+'/api/look-here/captures',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(bundle),credentials:'include',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error('Server returned '+response.status);
    const result=await response.json();if(!Number.isInteger(result.id))throw Error('No save confirmation received');
    capture.uploadId=result.id;persist();
    message(`Saved mark #${result.id}. Tell me “look here” in our conversation, or quote #${result.id}.`);
  } catch(error) {message('Save failed: '+error.message+'. Your screenshot and marks are still here. Check the LAN connection and retry.',true);$('save').disabled=false;}
  finally{busy=false;$('note').disabled=false;}
};
(async()=>{
  try {
    if(params.has('error'))throw Error(params.get('error'));
    capture=await captureDB.get(params.get('id'));
    if(!capture)throw Error('This capture is no longer available. Return to the page and click the Look here extension again.');
    image=await new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('Could not open the captured image'));im.src=capture.original;});
    canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
    $('source').textContent=capture.title+' — '+capture.url;$('source').title=$('source').textContent;$('note').value=capture.note;
    for(const field of ['project','thread'])$(field).value=capture[field]||'';
    paint();$('save').disabled=Boolean(capture.uploadId);
    if(capture.uploadId)message(`Saved mark #${capture.uploadId}. Tell me “look here” in our conversation.`);
  } catch(error) {message(error.message,true);$('source').textContent='Capture unavailable';canvas.hidden=true;}
})();
