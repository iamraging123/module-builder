"""Module Builder local server.

Serves the app on http://localhost:8791 and keeps the question database on disk in ./data:
  data/questions/<id>/meta.json + stem.png, c0..c3.png, answer.png, rationale.png
  data/modules/<id>.json
  data/attempts/<id>.json
Standard library only. Listens on this computer only.
"""
import base64
import json
import os
import re
import shutil
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA = ROOT / 'data'
# "--port N" overrides the default port.
PORT = int(sys.argv[sys.argv.index('--port') + 1]) if '--port' in sys.argv else 8791
URL = f'http://localhost:{PORT}/'
HOSTS = {f'localhost:{PORT}', f'127.0.0.1:{PORT}'}
ID = re.compile(r'^[A-Za-z0-9_-]{1,64}$')
ROUTE = re.compile(r'^/api/(questions|modules|attempts)/([^/?#]+)$')
IMAGES = {'stem', 'answer', 'rationale', 'c0', 'c1', 'c2', 'c3'}
MAX_BODY = 40 * 1024 * 1024
lock = threading.Lock()


def write_json(path, obj):
    # Write to a temp file first so a crash mid-write cannot leave a half-written record.
    tmp = path.with_suffix('.tmp')
    tmp.write_text(json.dumps(obj), encoding='utf-8')
    os.replace(tmp, path)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return None


def load_state():
    state = {
        'questions': [read_json(f) for f in (DATA / 'questions').glob('*/meta.json')],
        'modules': [read_json(f) for f in (DATA / 'modules').glob('*.json')],
        'attempts': [read_json(f) for f in (DATA / 'attempts').glob('*.json')],
    }
    return {k: [x for x in v if x] for k, v in state.items()}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        # Always revalidate, so edits to the app and re-imported images show up immediately.
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def reply(self, obj, code=200):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def allowed(self):
        # The custom header cannot be sent by another website without a CORS preflight,
        # which this server never answers; the Host check blocks DNS-rebinding tricks.
        return self.headers.get('Host') in HOSTS and self.headers.get('X-Module-Builder') == '1'

    def do_GET(self):
        if self.path.split('?')[0] == '/api/state':
            if self.headers.get('Host') not in HOSTS:
                return self.reply({'error': 'forbidden'}, 403)
            with lock:
                return self.reply(load_state())
        super().do_GET()

    def do_PUT(self):
        m = ROUTE.match(self.path)
        if not m or not ID.match(m.group(2)):
            return self.reply({'error': 'not found'}, 404)
        if not self.allowed():
            return self.reply({'error': 'forbidden'}, 403)
        size = int(self.headers.get('Content-Length') or 0)
        if size > MAX_BODY:
            return self.reply({'error': 'too large'}, 413)
        try:
            body = json.loads(self.rfile.read(size))
        except ValueError:
            return self.reply({'error': 'bad json'}, 400)
        store, key = m.groups()
        with lock:
            if store != 'questions':
                if body.get('id') != key:
                    return self.reply({'error': 'id mismatch'}, 400)
                (DATA / store).mkdir(parents=True, exist_ok=True)
                write_json(DATA / store / f'{key}.json', body)
                return self.reply({'ok': True})
            meta, images = body.get('meta') or {}, body.get('images') or {}
            # Questions from a PDF need at least the stem image; questions from a JSON set are text only.
            needs_stem = meta.get('kind') != 'text'
            if meta.get('id') != key or (needs_stem and 'stem' not in images) or not set(images) <= IMAGES:
                return self.reply({'error': 'bad question'}, 400)
            decoded = {}
            for name, data_url in images.items():
                raw = base64.b64decode(data_url.split(',', 1)[-1])
                if not raw.startswith(b'\x89PNG'):
                    return self.reply({'error': 'images must be PNG'}, 400)
                decoded[name] = raw
            qdir = DATA / 'questions' / key
            qdir.mkdir(parents=True, exist_ok=True)
            for old in qdir.glob('*.png'):
                if old.stem not in decoded:
                    old.unlink()
            for name, raw in decoded.items():
                (qdir / f'{name}.png').write_bytes(raw)
            write_json(qdir / 'meta.json', meta)
        self.reply({'ok': True})

    def do_DELETE(self):
        m = ROUTE.match(self.path)
        if not m or not ID.match(m.group(2)):
            return self.reply({'error': 'not found'}, 404)
        if not self.allowed():
            return self.reply({'error': 'forbidden'}, 403)
        store, key = m.groups()
        with lock:
            if store == 'questions':
                shutil.rmtree(DATA / 'questions' / key, ignore_errors=True)
            else:
                (DATA / store / f'{key}.json').unlink(missing_ok=True)
        self.reply({'ok': True})


def main():
    for sub in ('questions', 'modules', 'attempts'):
        (DATA / sub).mkdir(parents=True, exist_ok=True)
    browser = '--no-browser' not in sys.argv
    try:
        server = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    except OSError:
        # Most likely Module Builder is already running; just show it.
        print(f'Port {PORT} is already in use. If Module Builder is already running, use {URL}')
        if browser:
            webbrowser.open(URL)
        return
    print(f'Module Builder is running at {URL}')
    print(f'Database folder: {DATA}')
    print('Keep this window open while you practise. Close it to stop.')
    if browser:
        webbrowser.open(URL)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    main()
