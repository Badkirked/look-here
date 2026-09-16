const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../extension/policy.js');
const p=globalThis.lookHerePolicy;
test('removes credentials, query tokens and fragments from page metadata',()=>{
 assert.equal(p.safePageURL('https://user:password@example.com/design?access_token=private#secret'),'https://example.com/design');
 assert.equal(p.safePageURL('file:///private/local-file'),'');
 assert.equal(p.safePageURL('javascript:alert(1)'),'');
});
test('receiver has no defaults and rejects insecure public endpoints',()=>{
 for(const url of ['http://example.com/upload','http://example.com/upload','ftp://localhost/upload','https://u:p@example.com/upload','https://example.com/?token=bad','https://example.com/#bad'])assert.throws(()=>p.destination(url,true));
 assert.throws(()=>p.destination('http://192.168.1.2/upload',false));
 assert.throws(()=>p.destination('http://192.168.1.2.evil.example/upload',true));
 assert.throws(()=>p.destination('http://172.32.0.1/upload',true));
});
test('private HTTP requires opt-in; permission origin excludes ports',()=>{
 assert.equal(p.destination('https://example.com:8443/upload').permission,'https://example.com/*');
 assert.equal(p.destination('http://127.0.0.1:9000/upload',true).origin,'http://127.0.0.1:9000');
 assert.equal(p.destination('http://172.16.0.1/upload',true).insecure,true);
});
