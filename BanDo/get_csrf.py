import requests
import re

r = requests.get('http://127.0.0.1:8000/admin/login/')
csrf_match = re.search(r'csrfmiddlewaretoken.*?value="([^"]+)"', r.text)
if csrf_match:
    print(csrf_match.group(1))
else:
    print('NOT_FOUND')
