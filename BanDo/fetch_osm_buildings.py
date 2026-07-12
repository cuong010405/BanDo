"""
Fetch real building footprints from OpenStreetMap Overpass API
for Dai hoc Dong Thap campus area and output as Python list.
"""
import json
import urllib.request
import urllib.parse

# Campus bounding box (slightly expanded)
bbox = "10.418,105.640,10.423,105.646"

query = f"""
[out:json][timeout:60];
(
  way["building"](10.418,105.640,10.423,105.646);
  relation["building"](10.418,105.640,10.423,105.646);
);
out body;
>;
out skel qt;
"""

url = "https://overpass-api.de/api/interpreter?data=" + urllib.parse.quote(query)

print("Fetching OSM data...")
req = urllib.request.Request(url)
req.add_header("Accept", "application/json")
req.add_header("User-Agent", "DTHU-Map-Builder/1.0")
with urllib.request.urlopen(req, timeout=60) as resp:
    raw = resp.read().decode("utf-8")

osm = json.loads(raw)
elements = osm.get("elements", [])

# Build node coordinate lookup
node_coords = {}
for el in elements:
    if el["type"] == "node":
        node_coords[el["id"]] = (el["lat"], el["lon"])

# Extract building ways
buildings = []
for el in elements:
    if el["type"] == "way" and "tags" in el and "building" in el.get("tags", {}):
        name = el["tags"].get("name", "")
        btype = el["tags"].get("building", "yes")
        nodes = el.get("nodes", [])
        coords = []
        for nid in nodes:
            if nid in node_coords:
                lat, lon = node_coords[nid]
                coords.append([round(lat, 7), round(lon, 7)])
        if len(coords) >= 3:
            buildings.append({
                "osm_id": el["id"],
                "name": name,
                "type": btype,
                "coords": coords
            })

print(f"\nFound {len(buildings)} buildings in campus area:\n")

# Filter: only buildings inside campus (exclude houses outside)
campus_buildings = []
for b in buildings:
    lats = [c[0] for c in b["coords"]]
    lngs = [c[1] for c in b["coords"]]
    center_lat = sum(lats) / len(lats)
    center_lng = sum(lngs) / len(lngs)
    
    # Campus bounds check (tight)
    if 10.4185 <= center_lat <= 10.4230 and 105.6408 <= center_lng <= 105.6455:
        campus_buildings.append(b)
        area_lat = (max(lats) - min(lats)) * 111111
        area_lng = (max(lngs) - min(lngs)) * 111111 * 0.9816  # cos(10.42)
        safe_name = (b['name'] or b['type']).encode('ascii', 'replace').decode('ascii')
        print(f"  OSM #{b['osm_id']}: {safe_name}")
        print(f"    Center: ({center_lat:.6f}, {center_lng:.6f})")
        print(f"    Size: ~{area_lat:.0f}m x {area_lng:.0f}m")
        print(f"    Vertices: {len(b['coords'])}")
        print()

print(f"\n=== {len(campus_buildings)} campus buildings ===\n")

# Output as Python code
print("BUILDING_POLYGONS = [")
for b in campus_buildings:
    name = b['name'] or b['type']
    print(f"    # {name} (OSM #{b['osm_id']})")
    coords_str = ", ".join(f"[{c[0]}, {c[1]}]" for c in b['coords'])
    print(f"    [{coords_str}],")
print("]")

# Save to JSON too
with open("osm_buildings.json", "w") as f:
    json.dump(campus_buildings, f, indent=2, ensure_ascii=False)
print("\nSaved to osm_buildings.json")
