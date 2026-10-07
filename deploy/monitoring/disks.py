"""Private volume capacity exporter. Never reads database files or object contents."""
import hmac
import os
import shutil
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        expected = 'Bearer ' + os.environ['METRICS_TOKEN']
        if self.path != '/metrics' or not hmac.compare_digest(self.headers.get('Authorization',''), expected):
            self.send_error(404)
            return
        lines = []
        for name in ('db','scratch','backup'):
            try:
                usage=shutil.disk_usage('/volumes/'+name)
                lines.extend([f'insta_volume_available_bytes{{volume="{name}"}} {usage.free}',f'insta_volume_capacity_bytes{{volume="{name}"}} {usage.total}',f'insta_volume_up{{volume="{name}"}} 1'])
            except OSError:
                lines.append(f'insta_volume_up{{volume="{name}"}} 0')
        content=('\n'.join(lines)+'\n').encode()
        self.send_response(200)
        self.send_header('Content-Type','text/plain; version=0.0.4')
        self.send_header('Content-Length',str(len(content)))
        self.end_headers()
        self.wfile.write(content)

    def log_message(self, *args):
        pass


ThreadingHTTPServer(('0.0.0.0',9101),Handler).serve_forever()
