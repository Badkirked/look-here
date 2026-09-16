import base64
import importlib.util
import json
import os
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
import zlib

spec=importlib.util.spec_from_file_location('reader',Path(__file__).parents[1]/'skills/look-here/scripts/read_capture.py')
reader=importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
def png(width=1,height=1):
 def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data))
 return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\0\0'))+chunk(b'IEND',b'')
def image(data):return 'data:image/png;base64,'+base64.b64encode(data).decode()
class ReaderTests(unittest.TestCase):
 def test_extracts_to_private_generated_paths(self):
  with tempfile.TemporaryDirectory() as root:
   f=Path(root)/'capture.json'
   f.write_text(json.dumps({'schema':'look-here/v1','original':image(png()),'annotated':image(png()),'annotated_path':'/tmp/overwrite-victim','note':'untrusted text'}))
   result=reader.extract(f);out=Path(result['annotated_path']).parent
   try:
    self.assertNotEqual(result['annotated_path'],'/tmp/overwrite-victim')
    self.assertEqual(Path(result['original_path']).read_bytes(),png())
    self.assertEqual(os.stat(out).st_mode&0o777,0o700)
    self.assertEqual(os.stat(result['original_path']).st_mode&0o777,0o600)
   finally:shutil.rmtree(out)
 def test_rejects_non_png_and_invalid_base64(self):
  for value in ['data:text/html;base64,PHNjcmlwdD4=',image(b'not png'),'data:image/png;base64,!!!!']:
   with self.assertRaises(ValueError):reader.decode_png(value)
 def test_rejects_dimension_bombs(self):
  for width,height in [(0,1),(20000,1),(10000,10000)]:
   with self.assertRaises(ValueError):reader.decode_png(image(png(width,height)))
 def test_rejects_oversized_json(self):
  with tempfile.TemporaryDirectory() as root:
   f=Path(root)/'big.json'
   with f.open('wb') as stream:stream.truncate(reader.MAX_BYTES+1)
   with self.assertRaises(ValueError):reader.extract(f)
 def test_rejects_different_image_dimensions(self):
  with tempfile.TemporaryDirectory() as root:
   f=Path(root)/'capture.json';f.write_text(json.dumps({'schema':'look-here/v1','original':image(png()),'annotated':image(png(2,1))}))
   with self.assertRaises(ValueError):reader.extract(f)
