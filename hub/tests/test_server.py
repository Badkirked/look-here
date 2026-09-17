import base64,json,sqlite3,sys,tempfile,time,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from fastapi import FastAPI
from fastapi.testclient import TestClient
import look_here_captures as captures
from look_here_urls import URLStore,extract_urls

class ServerTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.uploads=self.root/'uploads';self.uploads.mkdir()
  def db():
   c=sqlite3.connect(self.root/'hub.sqlite',check_same_thread=False);c.row_factory=sqlite3.Row;return c
  self.db=db
  with db() as c:c.execute("CREATE TABLE uploads(id INTEGER PRIMARY KEY,filename TEXT,original_name TEXT,path TEXT,mime_type TEXT,size_bytes INTEGER,uploader TEXT,tags TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)")
  app=FastAPI();captures.install(app,db,self.uploads);self.client=TestClient(app)
 def tearDown(self):self.client.close();self.temp.cleanup()
 def bundle(self,key='0123456789abcdef'):
  png='data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nfixture').decode()
  return dict(schema='look-here/v1',saveKey=key,original=png,annotated=png,project='train',thread='task-1',note='Move this',url='http://example.test/',savedAt='one')
 def test_retry_and_conflict(self):
  b=self.bundle();a=self.client.post('/api/look-here/captures',json=b);self.assertEqual(a.status_code,200)
  b['savedAt']='two';retry=self.client.post('/api/look-here/captures',json=b);self.assertEqual(a.json()['id'],retry.json()['id']);self.assertTrue(retry.json()['duplicate'])
  b['note']='different';self.assertEqual(self.client.post('/api/look-here/captures',json=b).status_code,409)
  self.assertEqual(len(list(self.uploads.iterdir())),1)
 def test_labels_review_and_delete(self):
  id=self.client.post('/api/look-here/captures',json=self.bundle()).json()['id']
  self.assertEqual(len(self.client.get('/api/look-here/captures?project=train&thread=task-1').json()['captures']),1)
  self.assertEqual(self.client.get('/api/look-here/captures?project=other').json()['captures'],[])
  self.client.post(f'/api/look-here/captures/{id}/reviewed',json={'context':'task-1'})
  self.assertTrue(self.client.get('/api/look-here/captures').json()['captures'][0]['reviewed_at'])
  self.client.delete(f'/api/look-here/captures/{id}');self.assertEqual(self.client.get('/api/look-here/captures').json()['count'],0);self.assertFalse(list(self.uploads.iterdir()))
 def test_retention_is_opt_in(self):
  id=self.client.post('/api/look-here/captures',json=self.bundle()).json()['id']
  with self.db() as c:c.execute('UPDATE look_here_capture_meta SET created=?',(time.time()-100*86400,))
  self.assertEqual(self.client.get('/api/look-here/captures').json()['count'],1)
  self.client.put('/api/look-here/capture-retention?days=30');self.assertEqual(self.client.get('/api/look-here/captures').json()['count'],0)
 def test_bad_payload(self):
  b=self.bundle();b['original']='bad';self.assertEqual(self.client.post('/api/look-here/captures',json=b).status_code,400)
 def test_pane_positions_survive_restart_and_repeat(self):
  path=self.root/'urls.sqlite';s=URLStore(path)
  def feed(text):return {'panes':[{'pane':'default:%0:99','session':'work','text':text}], 'sockets':['default']}
  s.ingest('host','192.168.0.1',feed('old http://old.test/'));self.assertEqual(s.read()['latest'],0)
  s=URLStore(path);s.ingest('host','192.168.0.1',feed('old http://old.test/\nnew http://new.test/'))
  self.assertEqual(s.read(0)['events'][0]['url'],'http://new.test/')
  s.ingest('host','192.168.0.1',feed('old http://old.test/\nnew http://new.test/'));self.assertEqual(s.read()['latest'],1)
  with s.connect() as c:c.execute('UPDATE events SET created=?',(time.time()-20,))
  s.ingest('host','192.168.0.1',feed('old http://old.test/\nnew http://new.test/\nagain http://new.test/'))
  self.assertEqual(s.read()['latest'],2)
 def test_history_warning_survives_next_poll(self):
  s=URLStore(self.root/'warnings.sqlite')
  s.ingest('test','host',{'panes':[],'warnings':['History gap']})
  s.ingest('test','host',{'panes':[],'warnings':[]})
  self.assertEqual(s.read()['machines'][0]['warnings'],['History gap'])
 def test_sensitive_links(self):
  self.assertFalse(extract_urls('https://a.test/reset/abcd https://a.test/?token=abc https://a.test/'+('A'*40),'host'))
  self.assertEqual(extract_urls('http://localhost:8000/page','192.168.0.5'),{'http://192.168.0.5:8000/page'})

if __name__=='__main__':unittest.main()
