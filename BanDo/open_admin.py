from http.server import HTTPServer, BaseHTTPRequestHandler
import webbrowser

SESSION_ID = "rol151ktddjrswaorcyaaqikmue6tc73"

class CookieHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(302)
        self.send_header('Set-Cookie', f'sessionid={SESSION_ID}; Path=/; Domain=127.0.0.1')
        self.send_header('Location', 'http://127.0.0.1:8000/admin/')
        self.end_headers()

    def log_message(self, format, *args):
        pass

server = HTTPServer(('127.0.0.1', 9999), CookieHandler)
print("Cookie server started on port 9999")
webbrowser.open('http://127.0.0.1:9999')
server.handle_request()
print("Done! Admin page opened with login session.")
server.server_close()
