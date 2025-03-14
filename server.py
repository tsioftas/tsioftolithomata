import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler
import os


# if __name__ == '__main__':
#     test(CORSRequestHandler, HTTPServer, port=int(sys.argv[1]) if len(sys.argv) > 1 else 8000)
class CORSRequestHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_GET(self):
        uncached = ['/scripts/language.js', '/jsondata/dict.json']
        if self.path in uncached:
            self.send_response(200)
            if self.path.endswith(".json"):
                self.send_header('Content-type', 'application/json')
            self.end_headers()
            with open(os.path.join(os.getcwd(), self.path.lstrip('/')), 'rb') as file:
                self.wfile.write(file.read())
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
