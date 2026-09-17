"""Look here capture API; uses the hub's existing authentication and upload storage."""
import asyncio
import base64
import hashlib
import json
import os
import re
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MAX_BYTES=32*1024*1024

def install(app,get_db,uploads):
    from fastapi import APIRouter,Request,HTTPException,Query
    router=APIRouter(prefix='/api/look-here')
    lock=asyncio.Lock()
    @contextmanager
    def connection():
        db=get_db()
        try:
            with db:yield db
        finally:db.close()
    with connection() as db:
        db.executescript('''CREATE TABLE IF NOT EXISTS look_here_capture_meta(
          upload_id INTEGER PRIMARY KEY,capture_key TEXT UNIQUE,content_hash TEXT,
          project TEXT,thread TEXT,url TEXT,note TEXT,created REAL,reviewed_at REAL,reviewed_context TEXT);
          CREATE TABLE IF NOT EXISTS look_here_config(key TEXT PRIMARY KEY,value INTEGER);''')
    def policy(db):
        r=db.execute("SELECT value FROM look_here_config WHERE key='retentionDays'").fetchone()
        return r[0] if r else 0
    def remove(db,ids):
        for id in ids:
            r=db.execute("SELECT filename FROM uploads WHERE id=? AND uploader='look-here'",(id,)).fetchone()
            if not r:continue
            path=uploads/r[0]
            if path.parent.resolve()!=uploads.resolve():raise ValueError('Invalid capture path')
            path.unlink(missing_ok=True)
            db.execute('DELETE FROM look_here_capture_meta WHERE upload_id=?',(id,))
            db.execute("DELETE FROM uploads WHERE id=? AND uploader='look-here'",(id,))
    def expire(db):
        days=policy(db)
        if days:
            ids=[r[0] for r in db.execute('SELECT upload_id FROM look_here_capture_meta WHERE created<?',(time.time()-days*86400,))]
            remove(db,ids)
    @router.get('/info')
    def info():return {'name':'Look here','version':'1.2.0','captureSchema':'look-here/v1','maxCaptureBytes':MAX_BYTES,'scope':'configured SSH users and their /tmp/tmux-UID sockets; not every cluster user or external socket'}
    @router.post('/captures')
    async def save(request:Request):
        data=bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data)>MAX_BYTES:raise HTTPException(413,'Capture exceeds 32 MiB; use a smaller viewport')
        try:
            item=json.loads(data)
            if not isinstance(item,dict):raise ValueError('Capture must be an object')
            if item.get('schema')!='look-here/v1':raise ValueError('Unsupported schema')
            key=item['saveKey']
            if not isinstance(key,str) or not re.fullmatch(r'[a-zA-Z0-9-]{16,100}',key):raise ValueError('Invalid save key')
            for name in ('original','annotated'):
                value=item[name]
                if not isinstance(value,str) or not value.startswith('data:image/png;base64,'):raise ValueError('PNG required')
                decoded=base64.b64decode(value.split(',',1)[1],validate=True)
                if not decoded.startswith(b'\x89PNG\r\n\x1a\n'):raise ValueError('Invalid PNG')
            for name,limit in [('project',120),('thread',120),('note',2000),('url',4096)]:
                if not isinstance(item.get(name,''),str) or len(item.get(name,''))>limit:raise ValueError('Invalid '+name)
            canonical={k:v for k,v in item.items() if k not in ('savedAt',)}
            digest=hashlib.sha256(json.dumps(canonical,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        except (ValueError,KeyError,TypeError) as e:raise HTTPException(400,str(e))
        async with lock:
            db=get_db()
            try:
                db.execute('BEGIN IMMEDIATE')
                old=db.execute('SELECT upload_id,content_hash FROM look_here_capture_meta WHERE capture_key=?',(key,)).fetchone()
                if old:
                    if old[1]!=digest:raise HTTPException(409,'Save key reused with different content')
                    db.rollback();return {'id':old[0],'duplicate':True}
                expire(db)
                filename='look-here-'+uuid.uuid4().hex+'.json';path=uploads/filename
                with path.open('xb') as stream:stream.write(data)
                os.chmod(path,0o600)
                try:
                    cur=db.execute('INSERT INTO uploads(filename,original_name,path,mime_type,size_bytes,uploader,tags) VALUES(?,?,?,?,?,?,?)',(filename,filename,str(path),'application/json',len(data),'look-here','look-here,browser-extension'))
                    id=cur.lastrowid
                    db.execute('INSERT INTO look_here_capture_meta VALUES(?,?,?,?,?,?,?,?,?,?)',(id,key,digest,item.get('project',''),item.get('thread',''),item.get('url',''),item.get('note',''),time.time(),None,None))
                    db.commit()
                except Exception:path.unlink(missing_ok=True);raise
                return {'id':id,'duplicate':False}
            finally:db.close()
    @router.get('/captures')
    def listing(limit:int=Query(20,ge=1,le=100),before:int|None=None,project:str='',thread:str='',id:int|None=None):
        db=get_db()
        try:
            expire(db);db.commit()
            where=["u.uploader='look-here'"];args=[]
            for field,value in [('m.project',project),('m.thread',thread),('u.id',id)]:
                if value is not None and value!='':where.append(field+'=?');args.append(value)
            if before is not None:where.append('u.id<?');args.append(before)
            rows=db.execute('SELECT u.id,u.filename,u.created_at,u.size_bytes,m.project,m.thread,m.url,m.note,m.reviewed_at,m.reviewed_context FROM uploads u LEFT JOIN look_here_capture_meta m ON u.id=m.upload_id WHERE '+' AND '.join(where)+' ORDER BY u.id DESC LIMIT ?',(*args,limit)).fetchall()
            totals=db.execute("SELECT COUNT(*),COALESCE(SUM(size_bytes),0) FROM uploads WHERE uploader='look-here'").fetchone()
            return {'captures':[dict(r) for r in rows],'count':totals[0],'bytes':totals[1],'retentionDays':policy(db)}
        finally:db.close()
    @router.post('/captures/{id}/reviewed')
    async def reviewed(id:int,request:Request):
        body=await request.json();context=str(body.get('context',''))[:120]
        with connection() as db:
            if not db.execute("SELECT 1 FROM uploads WHERE id=? AND uploader='look-here'",(id,)).fetchone():raise HTTPException(404)
            db.execute('INSERT INTO look_here_capture_meta(upload_id,reviewed_at,reviewed_context) VALUES(?,?,?) ON CONFLICT(upload_id) DO UPDATE SET reviewed_at=excluded.reviewed_at,reviewed_context=excluded.reviewed_context',(id,time.time(),context))
        return {'ok':True}
    @router.delete('/captures/{id}')
    async def delete(id:int):
        async with lock:
            with connection() as db:remove(db,[id])
        return {'ok':True}
    @router.put('/capture-retention')
    async def retention(days:int=Query(ge=0,le=3650)):
        if days and days<7:raise HTTPException(400,'Minimum retention is 7 days; 0 keeps captures')
        async with lock:
            with connection() as db:
                db.execute('INSERT OR REPLACE INTO look_here_config VALUES(?,?)',('retentionDays',days));expire(db)
        return {'days':days}
    app.include_router(router)
