"""
Fetch all OSM building footprints inside DTHU campus using "out geom"
to get exact coordinates directly, then match them to local Location names.
"""
import os
import sys
import json
import math
import urllib.request
import urllib.parse
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'BanDo.settings')
django.setup()

from locations.models import Location

# 1. Fetch from Overpass
query = """[out:json][timeout:60];
(
  way["building"](10.4185,105.6408,10.4230,105.6455);
  relation["building"](10.4185,105.6408,10.4230,105.6455);
);
out geom;"""

url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)
headers = {
    "Accept": "application/json",
    "User-Agent": "DTHU-Map-Builder/1.0 (contact: admin@dthu.edu.vn)"
}

print("Querying Overpass API for all building geometries...")
req = urllib.request.Request(url, headers=headers)
try:
    with urllib.request.urlopen(req, timeout=90) as response:
        res_data = json.loads(response.read().decode("utf-8"))
except Exception as e:
    print(f"Error fetching from Overpass: {e}")
    sys.exit(1)

elements = res_data.get("elements", [])
print(f"Retrieved {len(elements)} OSM building elements.")

# 2. Get local locations for matching
locations = list(Location.objects.all())
print(f"Loaded {len(locations)} local locations from Database.")

def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))

# 3. Process OSM ways
parsed_buildings = []
for el in elements:
    if el["type"] == "way" and "geometry" in el:
        coords = [[pt["lat"], pt["lon"]] for pt in el["geometry"]]
        if len(coords) < 3:
            continue
            
        # Calculate center
        lats = [c[0] for c in coords]
        lngs = [c[1] for c in coords]
        center_lat = sum(lats) / len(lats)
        center_lng = sum(lngs) / len(lngs)
        
        # Match with closest location
        best_loc = None
        min_dist = float('inf')
        for loc in locations:
            dist = haversine(center_lat, center_lng, float(loc.latitude), float(loc.longitude))
            if dist < min_dist:
                min_dist = dist
                best_loc = loc
                
        # If best match is within 35 meters, associate it
        name = el.get("tags", {}).get("name", "")
        if not name and best_loc and min_dist <= 35.0:
            name = best_loc.name
            
        if not name:
            name = f"Building {el['id']}"
            
        parsed_buildings.append({
            "osm_id": el["id"],
            "name": name,
            "coords": coords,
            "center": (center_lat, center_lng),
            "match_dist": min_dist if best_loc else 999
        })

print(f"Processed {len(parsed_buildings)} buildings.")

# Sort by name for neat output
parsed_buildings.sort(key=lambda x: x["name"])

# 4. Generate Python code content
code_lines = []
code_lines.append("# ============================================================")
code_lines.append("# BUILDING FOOTPRINTS (Đa giác vật cản các tòa nhà từ OSM thật)")
code_lines.append("# ============================================================")
code_lines.append("BUILDING_POLYGONS = [")

for b in parsed_buildings:
    name_clean = b["name"].encode('ascii', 'replace').decode('ascii')
    code_lines.append(f"    # {name_clean} (OSM way {b['osm_id']})")
    coords_str = ", ".join(f"[{round(lat, 6)}, {round(lng, 6)}]" for lat, lng in b["coords"])
    code_lines.append(f"    [{coords_str}],")

code_lines.append("]")

# Save to a temporary file
with open("osm_building_polygons.py", "w", encoding="utf-8") as f:
    f.write("\n".join(code_lines))
print("\nGenerated polygons code saved to osm_building_polygons.py")

# Also dump JSON for reference
with open("osm_buildings_processed.json", "w", encoding="utf-8") as f:
    json.dump(parsed_buildings, f, indent=2, ensure_ascii=False)
print("Saved osm_buildings_processed.json")
