"""Parse OSM building data from saved content.md and produce Python polygon code."""
import json
import sys
import os

sys.stdout.reconfigure(encoding='utf-8')

content_path = r'C:\Users\PC\.gemini\antigravity-ide\brain\a4bfdd0c-4d1a-4c87-8fdb-5dff70aba4a8\.system_generated\steps\433\content.md'

with open(content_path, 'r', encoding='utf-8') as f:
    raw = f.read()

# Find JSON start
idx = raw.find('{')
if idx < 0:
    print('No JSON found')
    sys.exit(1)

raw_json = raw[idx:]

# Try to parse, handle truncation
try:
    data = json.loads(raw_json)
except json.JSONDecodeError:
    # Content may be truncated by markdown conversion
    # Try to fix by finding the last valid JSON object
    last_complete = raw_json.rfind('}\n\n')
    if last_complete > 0:
        raw_json = raw_json[:last_complete+1]
    # Balance brackets
    open_sq = raw_json.count('[') - raw_json.count(']')
    open_br = raw_json.count('{') - raw_json.count('}')
    raw_json += ']' * max(0, open_sq) + '}' * max(0, open_br)
    try:
        data = json.loads(raw_json)
    except json.JSONDecodeError as e:
        print(f'JSON parse error even after fix: {e}')
        print(f'Raw length: {len(raw_json)}')
        print(f'Last 200 chars: {raw_json[-200:]}')
        sys.exit(1)

elements = data.get('elements', [])
print(f'Total elements: {len(elements)}')

# Build node lookup
nodes = {}
for el in elements:
    if el['type'] == 'node':
        nodes[el['id']] = (el['lat'], el['lon'])

print(f'Nodes: {len(nodes)}')

# Extract buildings
buildings = []
for el in elements:
    if el['type'] == 'way' and 'tags' in el and 'building' in el.get('tags', {}):
        name = el['tags'].get('name', '')
        btype = el['tags'].get('building', 'yes')
        nids = el.get('nodes', [])
        coords = []
        for nid in nids:
            if nid in nodes:
                lat, lon = nodes[nid]
                coords.append([round(lat, 7), round(lon, 7)])
        if len(coords) >= 3:
            buildings.append({
                'name': name,
                'type': btype,
                'osm_id': el['id'],
                'coords': coords
            })

# Filter campus only
campus = []
for b in buildings:
    lats = [c[0] for c in b['coords']]
    lngs = [c[1] for c in b['coords']]
    clat = sum(lats) / len(lats)
    clng = sum(lngs) / len(lngs)
    if 10.4185 <= clat <= 10.423 and 105.6408 <= clng <= 105.646:
        campus.append(b)

print(f'Campus buildings: {len(campus)}')

# Output Python code
lines = []
lines.append('BUILDING_POLYGONS = [')
for b in campus:
    n = b['name'] or b['type']
    osm_id = b['osm_id']
    cs = ', '.join(f'[{c[0]}, {c[1]}]' for c in b['coords'])
    lines.append(f'    # {n} (OSM way {osm_id})')
    lines.append(f'    [{cs}],')
lines.append(']')

output = '\n'.join(lines)
print(output)

# Save
with open('osm_buildings.json', 'w', encoding='utf-8') as f:
    json.dump(campus, f, indent=2, ensure_ascii=False)

with open('osm_polygons_output.py', 'w', encoding='utf-8') as f:
    f.write(output)

print('\nSaved osm_buildings.json and osm_polygons_output.py')
