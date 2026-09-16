'use strict';
globalThis.lookHerePolicy = {
  safePageURL(value) {
    try {const u=new URL(value);if(!['http:','https:'].includes(u.protocol))return '';u.username='';u.password='';u.search='';u.hash='';return u.href;}catch{return '';}
  },
  destination(value, allowLAN = false) {
    const u=new URL(value);
    if(u.username||u.password||u.search||u.hash)throw Error('Use a receiver URL without credentials, query parameters, or fragments.');
    const host=u.hostname;
    const parts=host.split('.').map(Number);
    const ipv4=parts.length===4&&parts.every(p=>Number.isInteger(p)&&p>=0&&p<=255);
    const local=host==='localhost'||host==='[::1]'||(ipv4&&(parts[0]===127||parts[0]===10||(parts[0]===192&&parts[1]===168)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)));
    if(u.protocol!=='https:'&&!(u.protocol==='http:'&&local&&allowLAN))throw Error('Use HTTPS, or explicitly enable HTTP for a private IP address / localhost.');
    return {url:u.href, origin:u.origin, permission:u.protocol+'//'+u.hostname+'/*', insecure:u.protocol==='http:'};
  },
  maxBundleBytes: 40*1024*1024,
  maxPixels: 32*1024*1024
};
