import requests
import re

s = requests.Session()

# Get CSRF token
r = s.get('http://127.0.0.1:8000/admin/login/')
csrf_match = re.search(r'csrfmiddlewaretoken.*?value="([^"]+)"', r.text)
csrf_token = csrf_match.group(1) if csrf_match else None

if not csrf_token:
    print('Could not find CSRF token')
    exit(1)

# Login
login_data = {
    'csrfmiddlewaretoken': csrf_token,
    'username': 'admin',
    'password': 'admin123',
    'next': '/admin/'
}
r = s.post(
    'http://127.0.0.1:8000/admin/login/',
    data=login_data,
    allow_redirects=False,
    headers={'Referer': 'http://127.0.0.1:8000/admin/login/'}
)

if r.status_code == 302 and '/admin/' in r.headers.get('Location', ''):
    sessionid = s.cookies.get('sessionid')
    print('LOGIN SUCCESS')
    print('sessionid=' + sessionid)
else:
    print('LOGIN FAILED - Status:', r.status_code)
