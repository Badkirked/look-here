"""Read-only tmux discovery with persistent pane positions and explicit coverage."""
import asyncio
import base64
import difflib
import hashlib
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from urllib.parse import parse_qsl, urlsplit, urlunsplit

DATABASE = Path(__file__).with_name('look-here-urls.sqlite')
SOURCE = r'''
import os,json,stat,subprocess
sockets=[]
base='/tmp/tmux-'+str(os.getuid())
try:
 for name in os.listdir(base):
  p=os.path.join(base,name);s=os.lstat(p)
  if stat.S_ISSOCK(s.st_mode) and s.st_uid==os.getuid(): sockets.append(p)
except FileNotFoundError: pass
out=[];warnings=[]
for sock in sockets:
 try:
  p=subprocess.run(['tmux','-S',sock,'list-panes','-a','-F','#{session_name}\t#{pane_id}\t#{pane_pid}'],capture_output=True,text=True,timeout=3)
  if p.returncode: continue
  for line in p.stdout.splitlines():
   session,pane,pid=line.split('\t',2)
   c=subprocess.run(['tmux','-S',sock,'capture-pane','-p','-J','-S','-1000','-t',pane],capture_output=True,text=True,timeout=3)
   if c.returncode==0:out.append({'session':session,'pane':sock+':'+pane+':'+pid,'socket':sock,'text':c.stdout})
 except subprocess.TimeoutExpired: warnings.append('A tmux socket timed out')
print(json.dumps({'panes':out,'sockets':sockets,'warnings':warnings,'scope':'configured SSH user; sockets in /tmp/tmux-UID; last 1000 lines per pane'}))
'''
COMMAND = "python3 -c \"import base64;exec(base64.b64decode('" + base64.b64encode(SOURCE.encode()).decode() + "'))\""


def extract_urls(text, host):
    """Reject recognised credentials; this is filtering, not a secrecy guarantee."""
    found=set()
    for match in re.finditer(r'https?://[^\s<>\x00-\x20"\x27`]+',text):
        url=match.group().rstrip('.,;:!?')
        while url.endswith(')') and url.count(')')>url.count('('):url=url[:-1]
        url=url.rstrip(']}')
        try:
            p=urlsplit(url)
            if not p.hostname or p.username or p.password or len(url)>2048 or any(c in url for c in '{}\\'):continue
            if any(re.search(r'password|passwd|token|secret|signature|credential|api.?key|^code$|^sig$',k,re.I) for k,v in parse_qsl(p.query)+parse_qsl(p.fragment)):continue
            if re.search(r'(?:reset|verify|magic|enrol|invite|token|secret|auth|login)[-/]',p.path,re.I):continue
            if re.search(r'[A-Za-z0-9_-]{32,}',p.path+'#'+p.fragment):continue
            port=p.port
            if p.hostname in ('localhost','127.0.0.1','::1'):p=p._replace(netloc=host+(':'+str(port) if port else ''))
            found.add(urlunsplit(p))
        except ValueError:continue
    return found


class URLStore:
    def __init__(self,path):
        self.path=Path(path)
        with self.connect() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,url TEXT,machine TEXT,session TEXT,created REAL);
            CREATE TABLE IF NOT EXISTS status(machine TEXT PRIMARY KEY,checked REAL,panes INTEGER,error TEXT);
            CREATE TABLE IF NOT EXISTS pane_positions(machine TEXT,pane TEXT,hashes TEXT,checked REAL,PRIMARY KEY(machine,pane));
            CREATE TABLE IF NOT EXISTS watch_details(machine TEXT PRIMARY KEY,details TEXT);
            CREATE TABLE IF NOT EXISTS watch_settings(key TEXT PRIMARY KEY,value INTEGER);''')
        os.chmod(self.path,0o600)

    def connect(self):return sqlite3.connect(self.path,timeout=10)

    def ingest(self,machine,host,result,baseline=False):
        now=time.time();panes=result['panes'];warnings=list(result.get('warnings',[]))
        with self.connect() as db:
            for pane in panes:
                lines=pane['text'].splitlines();hashes=[hashlib.sha256(x.encode()).hexdigest() for x in lines]
                row=db.execute('SELECT hashes FROM pane_positions WHERE machine=? AND pane=?',(machine,pane['pane'])).fetchone()
                if row and not baseline:
                    old=json.loads(row[0]);matcher=difflib.SequenceMatcher(None,old,hashes,autojunk=False)
                    if old and hashes and not any(b.size for b in matcher.get_matching_blocks()):warnings.append('Pane history gap or screen replacement: '+pane['session'])
                    added=[line for tag,a,b,c,d in matcher.get_opcodes() if tag in ('insert','replace') for line in lines[c:d]]
                    for url in sorted(extract_urls('\n'.join(added),host)):
                        recent=db.execute('SELECT 1 FROM events WHERE url=? AND created>? LIMIT 1',(url,now-15)).fetchone()
                        if not recent:db.execute('INSERT INTO events(url,machine,session,created) VALUES(?,?,?,?)',(url,machine,pane['session'],now))
                db.execute('INSERT OR REPLACE INTO pane_positions VALUES(?,?,?,?)',(machine,pane['pane'],json.dumps(hashes),now))
            db.execute('INSERT OR REPLACE INTO status VALUES(?,?,?,?)',(machine,now,len(panes),None))
            prior=db.execute('SELECT details FROM watch_details WHERE machine=?',(machine,)).fetchone()
            prior=json.loads(prior[0]) if prior else {}
            warning_at=now if warnings else prior.get('warningsAt',0)
            if not warnings and now-warning_at<7*86400:warnings=prior.get('warnings',[])
            db.execute('INSERT OR REPLACE INTO watch_details VALUES(?,?)',(machine,json.dumps({'sockets':result.get('sockets',[]),'warnings':warnings[-5:],'warningsAt':warning_at,'scope':result.get('scope','')})))
            days=db.execute("SELECT value FROM watch_settings WHERE key='retentionDays'").fetchone();days=days[0] if days else 7
            db.execute('DELETE FROM events WHERE created<?',(now-days*86400,))
            db.execute('DELETE FROM pane_positions WHERE checked<?',(now-30*86400,))
            # The obsolete v1.1 forever-dedup table is no longer used.
            if db.execute("SELECT 1 FROM sqlite_master WHERE name='seen'").fetchone():db.execute('DELETE FROM seen')

    def failure(self,machine):
        with self.connect() as db:db.execute('INSERT OR REPLACE INTO status VALUES(?,?,?,?)',(machine,time.time(),0,'Connection unavailable'))

    def read(self,after=None,limit=3):
        with self.connect() as db:
            seq=db.execute("SELECT seq FROM sqlite_sequence WHERE name='events'").fetchone();latest=seq[0] if seq else 0
            oldest=db.execute('SELECT MIN(id) FROM events').fetchone()[0]
            rows=[] if after is None else db.execute('SELECT id,url,machine,session,created FROM events WHERE id>? ORDER BY id LIMIT ?',(after,limit)).fetchall()
            statuses=[]
            for machine,checked,panes,error in db.execute('SELECT * FROM status ORDER BY machine'):
                extra=db.execute('SELECT details FROM watch_details WHERE machine=?',(machine,)).fetchone()
                statuses.append(dict(machine=machine,checked=checked,panes=panes,error=error,**(json.loads(extra[0]) if extra else {})))
            count=db.execute('SELECT COUNT(*) FROM events').fetchone()[0]
            days=db.execute("SELECT value FROM watch_settings WHERE key='retentionDays'").fetchone()
        return {'latest':latest,'oldest':oldest,'gap':after is not None and after>0 and ((oldest is not None and after<oldest-1) or (oldest is None and after<latest)),
                'events':[dict(zip(['id','url','machine','session','created'],r)) for r in rows], 'machines':statuses,'retentionDays':days[0] if days else 7,'eventCount':count}


def install(app,machines,ssh_exec):
    from fastapi import APIRouter,Query,HTTPException
    router=APIRouter(prefix='/api/look-here');store=URLStore(DATABASE);semaphore=asyncio.Semaphore(3)
    @router.get('/urls')
    async def urls(after:int|None=Query(default=None,ge=0),limit:int=Query(default=3,ge=1,le=50)):return await asyncio.to_thread(store.read,after,limit)
    @router.put('/url-retention')
    async def retention(days:int=Query(ge=1,le=30)):
        with store.connect() as db:db.execute('INSERT OR REPLACE INTO watch_settings VALUES(?,?)',('retentionDays',days))
        return {'days':days}
    app.include_router(router)
    async def poll_one(mid,m):
        async with semaphore:
            try:
                raw=await asyncio.to_thread(ssh_exec,m,COMMAND,20);result=json.loads(raw)
                if not isinstance(result,dict) or not isinstance(result.get('panes'),list):raise ValueError()
                await asyncio.to_thread(store.ingest,mid,m['ip'],result)
            except Exception:await asyncio.to_thread(store.failure,mid)
    async def run():
        while True:
            unique={}
            for mid,m in machines().items():unique.setdefault((m['ip'],m.get('ssh_port',22)),(mid,m))
            await asyncio.gather(*(poll_one(mid,m) for mid,m in unique.values()))
            await asyncio.sleep(15)
    return run
