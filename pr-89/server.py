import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os
from urllib.parse import unquote


# if __name__ == '__main__':
#     test(CORSRequestHandler, HTTPServer, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

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
