'use strict';
const $=id=>document.getElementById(id);
const status=text=>{$('status').textContent=text;};
async function load(){const {receiver}=await chrome.storage.local.get('receiver');if(receiver){$('endpoint').value=receiver.url;$('allowLAN').checked=Boolean(receiver.allowLAN);}const {receiverToken}=await chrome.storage.session.get('receiverToken');$('token').value=receiverToken&&receiver&&receiverToken.url===receiver.url?receiverToken.token:'';}
$('settings').onsubmit=async event=>{
  event.preventDefault();
  try{
    const destination=lookHerePolicy.destination($('endpoint').value.trim(),$('allowLAN').checked);
    const token=$('token').value.trim();
    if(/[\r\n]/.test(token)||token.length>4096)throw Error('Invalid token.');
    // Invoke the permission request directly from the user's submit gesture.
    if(!await chrome.permissions.request({origins:[destination.permission]}))throw Error('Permission was not granted. No receiver settings were changed.');
    const {receiver:old}=await chrome.storage.local.get('receiver');
    await chrome.storage.local.set({receiver:{url:destination.url,allowLAN:$('allowLAN').checked}});
    await chrome.storage.session.set({receiverToken:{url:destination.url,token}});
    if(old){const prior=lookHerePolicy.destination(old.url,old.allowLAN);if(prior.permission!==destination.permission)await chrome.permissions.remove({origins:[prior.permission]});}
    status('Receiver saved. Reload an open marking tab to use it. Tokens must be re-entered after restarting the browser.');
  }catch(error){status(error.message);}
};
$('disconnect').onclick=async()=>{try{const {receiver}=await chrome.storage.local.get('receiver');await chrome.storage.local.remove('receiver');await chrome.storage.session.remove('receiverToken');if(receiver)await chrome.permissions.remove({origins:[lookHerePolicy.destination(receiver.url,receiver.allowLAN).permission]});$('endpoint').value='';$('token').value='';status('Receiver disconnected. Local export remains available.');}catch(error){status(error.message);}};
$('clear').onclick=async()=>{if(confirm('Delete all saved local screenshots and annotations? This does not delete files you exported or uploaded.')){await captureDB.run('readwrite',store=>store.clear());status('Local drafts deleted. Close any open marking tabs to clear their in-memory images too.');}};
load().catch(error=>status(error.message));
