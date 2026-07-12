"""
Script: purge_c2_nodes.py
Xóa trực tiếp tất cả node nằm bên trong và trong vùng 5m buffer quanh tòa nhà C2.
Điều này đảm bảo C2 hoàn toàn sạch bóng các node đè lên hoặc sát mép.

Chạy: python purge_c2_nodes.py
"""
import os
import sys
import math
import django

# Setup Django
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'BanDo.settings')
django.setup()

from locations.models import RouteNode, RouteEdge

# ============================================================
# C2 POLYGON (từ pathfinder.py - đây là nguồn sự thật)
# ============================================================
C2_POLYGON = [
    [10.42218, 105.64143],
    [10.42218, 105.64155],
    [10.42206, 105.64155],
    [10.42206, 105.64143],
]
BUFFER_METERS = 5.0  # Increase to 5 meters to completely clear any close/touching nodes


def point_in_polygon(lat, lng, poly):
    """Ray-casting algorithm."""
    n = len(poly)
    inside = False
    p1x, p1y = poly[0][0], poly[0][1]
    for i in range(n + 1):
        p2x, p2y = poly[i % n][0], poly[i % n][1]
        if lng > min(p1y, p2y):
            if lng <= max(p1y, p2y):
                if lat <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (lng - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or lat <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


def point_to_segment_dist_m(lat, lng, p1, p2):
    """Distance from point to segment in meters."""
    cos_lat = math.cos(math.radians(10.42))
    px = lng * 111111.0 * cos_lat
    py = lat * 111111.0
    ax = p1[1] * 111111.0 * cos_lat
    ay = p1[0] * 111111.0
    bx = p2[1] * 111111.0 * cos_lat
    by = p2[0] * 111111.0
    dx, dy = bx - ax, by - ay
    if dx == 0 and dy == 0:
        return math.sqrt((px - ax)**2 + (py - ay)**2)
    t = max(0.0, min(1.0, ((px - ax)*dx + (py - ay)*dy) / (dx*dx + dy*dy)))
    return math.sqrt((px - ax - t*dx)**2 + (py - ay - t*dy)**2)


def dist_to_polygon_m(lat, lng, poly):
    """Min distance from point to polygon boundary (0 if inside)."""
    if point_in_polygon(lat, lng, poly):
        return 0.0
    n = len(poly)
    return min(
        point_to_segment_dist_m(lat, lng, poly[i], poly[(i+1) % n])
        for i in range(n)
    )


# ============================================================
# MAIN: Query all → Filter → Delete
# ============================================================
print("=== PURGE C2 NODES ===")
print(f"C2 polygon: {C2_POLYGON}")
print(f"Buffer size: {BUFFER_METERS}m")
print()

# Query all nodes in the database to be absolutely certain we don't miss any due to bounding boxes
all_nodes = RouteNode.objects.all()
print(f"Total nodes in database: {all_nodes.count()}")

nodes_to_delete = []
for node in all_nodes:
    lat, lng = float(node.latitude), float(node.longitude)
    dist = dist_to_polygon_m(lat, lng, C2_POLYGON)
    if dist <= BUFFER_METERS:
        nodes_to_delete.append(node)
        inside = "INSIDE" if dist == 0 else f"BUFFER dist={dist:.2f}m"
        print(f"  -> DELETE Node #{node.id} at ({lat:.6f}, {lng:.6f}) [{inside}]")

print()
print(f"Nodes to delete: {len(nodes_to_delete)}")

if not nodes_to_delete:
    print("No nodes found within 5m of C2!")
    sys.exit(0)

# Delete related edges
node_ids = [n.id for n in nodes_to_delete]
edge_count = RouteEdge.objects.filter(node_a_id__in=node_ids).count() + \
             RouteEdge.objects.filter(node_b_id__in=node_ids).count()
RouteEdge.objects.filter(node_a_id__in=node_ids).delete()
RouteEdge.objects.filter(node_b_id__in=node_ids).delete()
print(f"Deleted {edge_count} related edges (bidirectional).")

# Delete nodes
RouteNode.objects.filter(id__in=node_ids).delete()
print(f"Deleted {len(nodes_to_delete)} nodes.")

print()
print(f"=== DONE === Remaining nodes: {RouteNode.objects.count()}, edges: {RouteEdge.objects.count()}")
