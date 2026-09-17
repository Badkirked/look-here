/* Local drafts survive editor reloads and service-worker suspension. */
'use strict';
globalThis.captureDB = {
  async open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('look-here-drafts', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('captures', {keyPath: 'id'});
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async run(mode, operation) {
    const db = await this.open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = db.transaction('captures', mode);
        const request = operation(transaction.objectStore('captures'));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || Error('Draft storage aborted'));
      });
    } finally { db.close(); }
  },
  list() { return this.run('readonly', store => store.getAll()); },
  async prune(days) { if(!days)return; for(const c of await this.list())if(c.uploadId && Date.now()-Date.parse(c.capturedAt)>days*86400000)await this.remove(c.id); },
  get(id) { return this.run('readonly', store => store.get(id)); },
  put(capture) { return this.run('readwrite', store => store.put(capture)); },
  remove(id) { return this.run('readwrite', store => store.delete(id)); }
};
