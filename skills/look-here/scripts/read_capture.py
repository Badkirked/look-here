#!/usr/bin/env python3
"""Validate and extract a user-provided Look Here export. No network access."""
import argparse
import base64
import binascii
import json
import os
import struct
import sys
import tempfile
from pathlib import Path

MAX_BYTES = 40 * 1024 * 1024
MAX_PIXELS = 32 * 1024 * 1024


def decode_png(value):
    prefix = 'data:image/png;base64,'
    if not isinstance(value, str) or not value.startswith(prefix):
        raise ValueError('Expected an embedded PNG image')
    data = base64.b64decode(value[len(prefix):], validate=True)
    if len(data) < 33 or data[:8] != b'\x89PNG\r\n\x1a\n' or data[8:16] != b'\x00\x00\x00\rIHDR':
        raise ValueError('Invalid PNG header')
    width, height = struct.unpack('>II', data[16:24])
    if not 0 < width <= 16384 or not 0 < height <= 16384 or width * height > MAX_PIXELS:
        raise ValueError('PNG dimensions exceed the supported limit')
    return data, width, height


def extract(source):
    with Path(source).open('rb') as stream:
        raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError('Capture exceeds the 40 MiB limit')
    item = json.loads(raw)
    if not isinstance(item, dict) or item.get('schema') != 'look-here/v1':
        raise ValueError('Unsupported capture format')
    images = {name: decode_png(item.get(name)) for name in ('original', 'annotated')}
    if images['original'][1:] != images['annotated'][1:]:
        raise ValueError('Original and annotated dimensions differ')
    # Use only known metadata fields, never filenames or output paths from the bundle.
    metadata = {key: item.get(key) for key in ('captureKind', 'url', 'title', 'capturedAt', 'savedAt', 'note', 'viewport')}
    metadata.update(width=images['original'][1], height=images['original'][2])
    output = Path(tempfile.mkdtemp(prefix='look-here-'))
    for name, (data, _, _) in images.items():
        path = output / (name + '.png')
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
        metadata[name + '_path'] = str(path)
    return metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('file', type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(extract(args.file), indent=2, ensure_ascii=True))
    except (ValueError, OSError, TypeError, RecursionError, binascii.Error) as error:
        print('Cannot read capture: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
