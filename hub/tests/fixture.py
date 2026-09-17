"""Isolated test hub. Never touches production uploads or orders."""
from pathlib import Path
import sqlite3,sys,tempfile
from fastapi import FastAPI
from fastapi.responses import HTMLResponse,FileResponse
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import look_here_captures
root=Path(tempfile.mkdtemp(prefix='look-here-v120-fixture-'));uploads=root/'uploads';uploads.mkdir()
def db():
 c=sqlite3.connect(root/'hub.sqlite',check_same_thread=False);c.row_factory=sqlite3.Row;return c
with db() as c:c.execute('CREATE TABLE uploads(id INTEGER PRIMARY KEY,filename TEXT,original_name TEXT,path TEXT,mime_type TEXT,size_bytes INTEGER,uploader TEXT,tags TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)')
app=FastAPI();look_here_captures.install(app,db,uploads)
@app.get('/preview',response_class=HTMLResponse)
def preview():return '<html><body style="margin:0;background:white"><div style="background:red;width:400px;height:200px;color:white">PRIVATE TEST PIXELS</div><h1>Look here end-to-end capture fixture</h1></body></html>'
@app.get('/files/{name}')
def file(name:str):return FileResponse(uploads/name)
@app.get('/api/look-here/urls')
def urls(after:int|None=None):return {'latest':0,'events':[],'machines':[],'retentionDays':7}
