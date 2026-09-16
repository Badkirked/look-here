'use strict';
const sample=document.getElementById('sample');
const marks=document.getElementById('marks');
const feedback=document.getElementById('feedback');
let count=0;
function mark(x,y){
 if(count>=20){feedback.textContent='Twenty marks is plenty for this demo. Clear them to start again.';return;}
 const dot=document.createElement('span');dot.className='mark';dot.textContent=String(++count);
 dot.style.left=Math.max(0,Math.min(100,x))+'%';dot.style.top=Math.max(0,Math.min(100,y))+'%';marks.append(dot);
 feedback.textContent='“Look at mark #'+count+' — that’s the part I mean.”';
}
sample.addEventListener('click',event=>{const box=sample.getBoundingClientRect();mark((event.clientX-box.left)/box.width*100,(event.clientY-box.top)/box.height*100);});
sample.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();mark(50,50);}});
document.getElementById('reset').addEventListener('click',()=>{marks.replaceChildren();count=0;feedback.textContent='“This bit here — can we change it?”';});
