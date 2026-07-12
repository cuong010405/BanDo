import os, django, re
os.environ['DJANGO_SETTINGS_MODULE'] = 'BanDo.settings'
django.setup()

from django.test import RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware
from django.contrib.messages.middleware import MessageMiddleware
from accounts.models import User

factory = RequestFactory()
request = factory.get('/dashboard/')
middleware = SessionMiddleware(lambda r: None)
middleware.process_request(request)
request.session.save()
middleware = MessageMiddleware(lambda r: None)
middleware.process_request(request)
request.session.save()
user = User.objects.get(username='admin')
request.user = user

from dashboard.views import overview
response = overview(request)
content = response.content.decode()

# Check for broken template variables
for var in ['total_users', 'total_locations', 'total_routes', 'avg_latency_ms', 'ratings', 'routes_over_time']:
    marker = '{{ ' + var + ' }}'
    if marker in content:
        print(f'WARNING: {var} not rendered!')
    else:
        print(f'OK: {var} rendered')

# Check JSON validity
import json
ratings_match = re.search(r"JSON\.parse\('(\[.+?\])'\)", content)
if ratings_match:
    try:
        json.loads(ratings_match.group(1))
        print(f'OK: ratings JSON valid')
    except:
        print(f'ERROR: ratings JSON invalid: {ratings_match.group(1)[:80]}')

routes_match = re.search(r"JSON\.parse\('(\[.+?\])'\)", content)
if routes_match:
    try:
        json.loads(routes_match.group(1))
        print(f'OK: routes_over_time JSON valid')
    except:
        print(f'ERROR: routes JSON invalid: {routes_match.group(1)[:80]}')

# Check for Script error patterns
if 'chart.js' not in content.lower() and 'Chart' in content:
    print('WARNING: Chart.js referenced but CDN might be missing')

print(f'\nTotal content length: {len(content)} bytes')
