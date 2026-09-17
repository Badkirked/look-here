#!/usr/bin/env python3
"""Review Look here captures with explicit project/task filters and private local caching."""
import argparse,base64,json,os,re,sys,tempfile,time
from pathlib import Path
from urllib.request import Request,urlopen
from urllib.parse import urlencode,urlsplit

DEFAULT_HUB='http://localhost:8420'
CACHE=Path.home()/'.cache/look-here'

def fetch(hub,path,body=None):
    request=Request(hub+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json'})
    with urlopen(request,timeout=20) as response:data=response.read(32*1024*1024+1)
    if len(data)>32*1024*1024:raise ValueError('Capture exceeds 32 MiB')
    return json.loads(data)

def private(path,data):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,name=tempfile.mkstemp(prefix='.capture-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as stream:stream.write(data)
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('id',nargs='?',default='latest');p.add_argument('--list',action='store_true');p.add_argument('--limit',type=int,default=10)
    p.add_argument('--hub',default=os.environ.get('LOOK_HERE_HUB',DEFAULT_HUB));p.add_argument('--project',default='');p.add_argument('--thread',default='')
    p.add_argument('--mark-reviewed',action='store_true');p.add_argument('--context',default='');p.add_argument('--cache-days',type=int,default=30)
    a=p.parse_args();hub=a.hub.rstrip('/');u=urlsplit(hub)
    if u.scheme not in ('http','https') or not u.netloc or u.username or u.password or u.path or u.query or u.fragment:p.error('Use a hub origin')
    if not 1<=a.limit<=100 or a.cache_days<1:p.error('Limit: 1–100; cache days: positive')
    if a.id!='latest' and (not a.id.isdecimal() or int(a.id)<1):p.error('Use a positive mark ID')
    # Only age out this helper\'s own regular cache files. Never follow links.
    if CACHE.exists():
        for base,dirs,files in os.walk(CACHE,followlinks=False):
            dirs[:]=[d for d in dirs if not (Path(base)/d).is_symlink()]
            for name in files:
                f=Path(base)/name
                if not f.is_symlink() and f.is_file() and time.time()-f.stat().st_mtime>a.cache_days*86400:f.unlink()
    params={'limit':a.limit,'project':a.project,'thread':a.thread}
    if a.id!='latest':params['id']=int(a.id)
    data=fetch(hub,'/api/look-here/captures?'+urlencode(params));rows=data['captures']
    if a.list:
        for row in rows:print(json.dumps(row,ensure_ascii=False))
        if not rows:print('No matching user captures. Check filters or save a new mark.')
        return
    if not rows:raise ValueError('No matching saved user capture; automated test uploads are excluded')
    row=rows[0]
    if a.mark_reviewed:
        if a.id=='latest' or not a.context:p.error('--mark-reviewed requires an explicit ID and --context after viewing the image')
        print(json.dumps(fetch(hub,f"/api/look-here/captures/{row['id']}/reviewed",{'context':a.context})));return
    filename=row['filename']
    if not re.fullmatch(r'[a-zA-Z0-9_-]+\.json',filename):raise ValueError('Unexpected capture filename')
    item=fetch(hub,'/files/'+filename)
    if item.get('schema')!='look-here/v1':raise ValueError('Unsupported capture schema')
    import hashlib
    destination=CACHE/hashlib.sha256(hub.encode()).hexdigest()[:12]/str(row['id'])
    meta={k:v for k,v in item.items() if k not in ('original','annotated','marks','saveKey')}
    meta.update(upload_id=row['id'],reviewed_at=row.get('reviewed_at'),reviewed_context=row.get('reviewed_context'),mark_count=len(item.get('marks',[])))
    for name in ('original','annotated'):
        value=item.get(name,'')
        if not value.startswith('data:image/png;base64,'):raise ValueError('Expected PNG screenshot')
        blob=base64.b64decode(value.split(',',1)[1],validate=True)
        if not blob.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Invalid PNG')
        path=destination/(name+'.png');private(path,blob);meta[name+'_path']=str(path)
    private(destination/'metadata.json',json.dumps(meta,indent=2).encode());print(json.dumps(meta,indent=2,ensure_ascii=False))

if __name__=='__main__':
    try:main()
    except Exception as e:print('Look here retrieval failed: '+str(e),file=sys.stderr);sys.exit(1)
