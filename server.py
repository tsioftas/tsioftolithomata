import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
from pathlib import Path
from urllib.parse import unquote


# if __name__ == '__main__':
#     test(CORSRequestHandler, HTTPServer, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def translate_path(self, path):
        """Serve /foo out of foo.html, the way Cloudflare Pages does.

        Links on the site carry no .html suffix, so without this every page opens
        as a 404 locally while working in production.
        """
        resolved = super().translate_path(path)
        if not os.path.exists(resolved) and os.path.isfile(resolved + ".html"):
            return resolved + ".html"
        return resolved

    def nearest_404(self):
        """The 404.html closest to the requested path, the way Pages picks one.

        A miss under /el/ is answered in Greek, everything else falls back to the one
        at the site root.
        """
        root = Path(os.getcwd()).resolve()
        directory = Path(self.translate_path(self.path)).resolve().parent
        while directory == root or root in directory.parents:
            page = directory / "404.html"
            if page.is_file():
                return page
            directory = directory.parent
        return None

    def send_error(self, code, message=None, explain=None):
        """Answer a missing path with the site's own 404 page, as Pages does.

        Without this the dev server returns its stock error HTML while production
        returns the real page, so the one thing worth checking about a 404 — that it
        renders correctly from an arbitrary depth — cannot be checked locally.
        """
        page = self.nearest_404() if code == 404 else None
        if page is None:
            super().send_error(code, message, explain)
            return
        body = page.read_bytes()
        self.send_response(404, message)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def do_GET(self):
        uncached = []
        if self.path in uncached:
            self.send_response(200)
            # Determine content type
            if self.path.endswith(".json"):
                self.send_header('Content-type', 'application/json')
            elif self.path.endswith(".js"):
                self.send_header('Content-type', 'application/javascript')
            else:
                self.send_header('Content-type', 'application/octet-stream')
            self.end_headers()

            # Define safe base directory
            base_dir = os.getcwd()

            # Get the raw path and decode it
            raw_path = unquote(self.path).lstrip('/')
            abs_path = os.path.abspath(os.path.join(base_dir, raw_path))

            # Ensure path is inside base_dir
            if not abs_path.startswith(os.path.abspath(base_dir)):
                self.send_error(403, "Forbidden")
                return

            try:
                with open(abs_path, 'rb') as file:
                    self.wfile.write(file.read())
            except FileNotFoundError:
                self.send_error(404, "File not found")
        else:
            super().do_GET()


def run_server(port):
    server_address = ('0.0.0.0', port)
    httpd = HTTPServer(server_address, CORSRequestHandler)
    print(f"Server running on port {port}")
    httpd.serve_forever()


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    run_server(port)
