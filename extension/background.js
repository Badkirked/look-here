'use strict';
importScripts('db.js', 'policy.js');
const setupCleanup = () => chrome.alarms.create('expire-drafts', {periodInMinutes:60});
chrome.runtime.onInstalled.addListener(setupCleanup);
chrome.runtime.onStartup.addListener(setupCleanup);
chrome.alarms.onAlarm.addListener(alarm => {if(alarm.name==='expire-drafts')captureDB.prune().catch(()=>{});});
let capturing = false;
chrome.action.onClicked.addListener(async tab => {
  if (capturing) return;
  capturing = true;
  try {
    await captureDB.prune();
    if(!lookHerePolicy.safePageURL(tab.url))throw Error('Open a normal HTTP or HTTPS page to capture it.');
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
    if(original.length>lookHerePolicy.maxBundleBytes/2)throw Error('This screenshot is too large. Use a smaller browser window.');
    const id = crypto.randomUUID();
    await captureDB.put({id, schema: 'look-here/v1', captureKind: 'browser-viewport', url: lookHerePolicy.safePageURL(tab.url), title: tab.title || 'Browser page', capturedAt: new Date().toISOString(), viewport, target: {tag: 'browser-tab'}, original, marks: [], note: ''});
    await captureDB.prune();
    await chrome.tabs.create({url: chrome.runtime.getURL('editor.html') + '?id=' + id, windowId: tab.windowId});
  } catch (error) {
    await chrome.tabs.create({url: chrome.runtime.getURL('editor.html') + '?error=' + encodeURIComponent(error.message)});
  } finally { capturing = false; }
});
