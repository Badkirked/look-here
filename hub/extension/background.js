'use strict';
importScripts('db.js','config.js');
let capturing = false;
chrome.action.onClicked.addListener(async tab => {
  if (capturing) return;
  capturing = true;
  try {
    const before = await chrome.tabs.query({active: true, windowId: tab.windowId});
    if (before[0]?.id !== tab.id) throw Error('The active tab changed. Click Look here on the page you want.');
    let viewport = null;
    // Metadata is optional: protected browser pages may allow capture but not script injection.
    try {
      const result = await chrome.scripting.executeScript({target: {tabId: tab.id}, func: () => ({width: innerWidth, height: innerHeight, scrollX, scrollY, devicePixelRatio})});
      viewport = result[0]?.result;
    } catch { /* Screenshot remains useful without page metadata. */ }
    const original = await chrome.tabs.captureVisibleTab(tab.windowId, {format: 'png'});
    const after = await chrome.tabs.query({active: true, windowId: tab.windowId});
    if (after[0]?.id !== tab.id || after[0]?.url !== tab.url) throw Error('The page changed during capture. Try again.');
    const id = crypto.randomUUID();
    const settings=await lookSettings();
    await captureDB.prune(settings.draftRetentionDays);
    await captureDB.put({id, project:settings.project, thread:settings.thread, redactions:[], saveKey:crypto.randomUUID(), schema: 'look-here/v1', captureKind: 'browser-viewport', url: (()=>{try{const u=new URL(tab.url);u.search='';u.hash='';return u.href;}catch{return '';}})(), title: tab.title || 'Browser page', capturedAt: new Date().toISOString(), viewport, target: {tag: 'browser-tab'}, original, marks: [], note: ''});
    await chrome.tabs.create({url: chrome.runtime.getURL('editor.html') + '?id=' + id, windowId: tab.windowId});
  } catch (error) {
    await chrome.tabs.create({url: chrome.runtime.getURL('editor.html') + '?error=' + encodeURIComponent(error.message)});
  } finally { capturing = false; }
});

importScripts('url-watch.js');
