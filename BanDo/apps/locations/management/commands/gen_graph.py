"""
Management command: gen_graph
Delete ALL existing RouteNode/RouteEdge and generate a dense campus graph.

ALGORITHM (Shapely-based, accurate metric geometry):
  1. Import accurate OSM building + sports area polygons from pathfinder (single source of truth).
  2. Convert every polygon to a local metric (x, y) coordinate system.
  3. Buffer each polygon outward by BUFFER_M meters using Shapely.buffer().
  4. Generate a uniform grid of candidate nodes.
  5. Keep only nodes that are:
       - Inside campus boundary
       - NOT inside any buffered obstacle (Point.within check)
  6. Generate ring nodes by sampling along the exterior of each buffered obstacle.
  7. Connect nodes with edges only when:
       - Distance ≤ max_dist_m
       - LineString does NOT intersect any buffered obstacle (Shapely exact check)
  8. Report connectivity.
"""
import math
from django.core.management.base import BaseCommand
from locations.models import RouteNode, RouteEdge

from shapely.geometry import Polygon as SPolygon, Point, LineString, MultiPolygon
from shapely.ops import unary_union

# Single source of truth: accurate OSM polygons for buildings + sports areas
from routes.pathfinder import BUILDING_POLYGONS

# ============================================================
# CAMPUS BOUNDARY POLYGON
# ============================================================
CAMPUS_POLYGON = [
    [10.422321, 105.640886],
    [10.422350, 105.641800],
    [10.422300, 105.642200],
    [10.422100, 105.642600],
    [10.421800, 105.643000],
    [10.421800, 105.643500],
    [10.421700, 105.644000],
    [10.421600, 105.644300],
    [10.421200, 105.644500],
    [10.420900, 105.645100],
    [10.420200, 105.645200],
    [10.419500, 105.645200],
    [10.419000, 105.645100],
    [10.418800, 105.644900],
    [10.418700, 105.644500],
    [10.418800, 105.644000],
    [10.419000, 105.643500],
    [10.419200, 105.643200],
    [10.419400, 105.642800],
    [10.419700, 105.642400],
    [10.420100, 105.642100],
    [10.420400, 105.641900],
    [10.420800, 105.641600],
    [10.421100, 105.641400],
    [10.421400, 105.641200],
    [10.421700, 105.641000],
    [10.422000, 105.640900],
    [10.422321, 105.640886],
]

# ============================================================
# LOCAL METRIC COORDINATE SYSTEM
# Converts lat/lng ↔ local (x_m, y_m) in metres.
# Using campus center as reference to minimise distortion.
# ============================================================
_REF_LAT = 10.420
_REF_LNG = 105.643
_LAT_TO_M = 111111.0
_LNG_TO_M = 111111.0 * math.cos(math.radians(_REF_LAT))


def _to_m(lat, lng):
    """(lat, lng) → local (x_m, y_m) in metres."""
    return ((lng - _REF_LNG) * _LNG_TO_M, (lat - _REF_LAT) * _LAT_TO_M)


def _from_m(x_m, y_m):
    """Local (x_m, y_m) → (lat, lng)."""
    return (y_m / _LAT_TO_M + _REF_LAT, x_m / _LNG_TO_M + _REF_LNG)


def _raw_to_shapely(raw_poly, buffer_m=0.0):
    """
    Convert [[lat, lng], ...] polygon to a Shapely polygon in local metres.
    Optionally buffer by buffer_m metres.
    Returns None if polygon is invalid or degenerate.
    """
    pts = [_to_m(lat, lng) for lat, lng in raw_poly]
    # Remove closing duplicate
    if len(pts) > 1 and pts[0] == pts[-1]:
        pts = pts[:-1]
    if len(pts) < 3:
        return None
    sp = SPolygon(pts)
    if not sp.is_valid:
        sp = sp.buffer(0)   # fix self-intersections
    if sp.is_empty:
        return None
    if buffer_m > 0:
        sp = sp.buffer(buffer_m, resolution=16)
    return sp


# ============================================================
# CAMPUS BOUNDARY — ray-casting (fast, only used for boundary)
# ============================================================
def _point_in_campus(lat, lng):
    poly = CAMPUS_POLYGON
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


# ============================================================
# HAVERSINE DISTANCE
# ============================================================
def _haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


# ============================================================
# COMMAND
# ============================================================
class Command(BaseCommand):
    help = "Rebuild campus graph: Shapely-based buffering + grid + ring nodes + exact intersection checks"

    def add_arguments(self, parser):
        parser.add_argument('--confirm', action='store_true',
                            help='Must pass to actually delete and regenerate')
        parser.add_argument('--step', type=float, default=5.0,
                            help='Grid spacing in metres (default 5.0)')
        parser.add_argument('--buffer', type=float, default=2.0,
                            help='Buffer around obstacles in metres (default 2.0)')

    def handle(self, *args, **options):
        if not options['confirm']:
            self.stdout.write(self.style.WARNING('Add --confirm to delete and regenerate graph.'))
            return

        step     = options['step']
        buffer_m = options['buffer']

        # ── STEP 1: Delete existing graph ────────────────────────
        self.stdout.write('=== STEP 1: DELETE EXISTING GRAPH ===')
        old_edges = RouteEdge.objects.count()
        old_nodes = RouteNode.objects.count()
        RouteEdge.objects.all().delete()
        RouteNode.objects.all().delete()
        self.stdout.write(f'  Deleted {old_edges} edges, {old_nodes} nodes.')

        # ── STEP 2: Build Shapely buffered obstacles ──────────────
        self.stdout.write(f'=== STEP 2: BUILD SHAPELY OBSTACLES (buffer={buffer_m}m) ===')
        buffered_shapes = []
        for raw_poly in BUILDING_POLYGONS:
            sp = _raw_to_shapely(raw_poly, buffer_m=buffer_m)
            if sp is not None:
                buffered_shapes.append(sp)

        self.stdout.write(f'  {len(BUILDING_POLYGONS)} polygons -> {len(buffered_shapes)} valid buffered shapes.')

        # Merge into one geometry for fast containment queries
        merged_obs = unary_union(buffered_shapes) if buffered_shapes else None

        # ── STEP 3: Generate candidate nodes ─────────────────────
        self.stdout.write('=== STEP 3: GENERATE NODE POOL ===')

        lats_cp = [pt[0] for pt in CAMPUS_POLYGON]
        lngs_cp = [pt[1] for pt in CAMPUS_POLYGON]
        min_lat, max_lat = min(lats_cp), max(lats_cp)
        min_lng, max_lng = min(lngs_cp), max(lngs_cp)

        lat_step = step / _LAT_TO_M
        lng_step = step / _LNG_TO_M

        candidate_keys = set()
        candidate_list = []   # [(lat, lng), ...]

        def try_add(lat, lng):
            """Accept node only if inside campus AND outside all buffered obstacles."""
            if not _point_in_campus(lat, lng):
                return
            x_m, y_m = _to_m(lat, lng)
            pt = Point(x_m, y_m)
            if merged_obs is not None and merged_obs.contains(pt):
                return
            key = (round(lat, 6), round(lng, 6))
            if key not in candidate_keys:
                candidate_keys.add(key)
                candidate_list.append(key)

        # A. Uniform grid
        curr_lat = min_lat
        grid_count = 0
        while curr_lat <= max_lat:
            curr_lng = min_lng
            while curr_lng <= max_lng:
                try_add(curr_lat, curr_lng)
                grid_count += 1
                curr_lng += lng_step
            curr_lat += lat_step

        self.stdout.write(f'  Grid cells checked : {grid_count}')
        self.stdout.write(f'  Grid nodes kept    : {len(candidate_list)}')

        # B. Ring nodes — sampled along the exterior of each buffered obstacle
        #    These nodes trace around buildings so the pathfinder can hug them.
        ring_before = len(candidate_list)
        for obs_shape in buffered_shapes:
            # Use exterior of the buffered polygon
            exterior = obs_shape.exterior
            total_len_m = exterior.length          # length in local metres
            n_samples   = max(6, int(total_len_m / step))
            for k in range(n_samples):
                pt_m = exterior.interpolate(k / n_samples, normalized=True)
                lat, lng = _from_m(pt_m.x, pt_m.y)
                if not _point_in_campus(lat, lng):
                    continue
                # Ring node must be outside every OTHER buffered obstacle
                pt_s = Point(pt_m.x, pt_m.y)
                if merged_obs is not None and merged_obs.contains(pt_s):
                    continue
                key = (round(lat, 6), round(lng, 6))
                if key not in candidate_keys:
                    candidate_keys.add(key)
                    candidate_list.append(key)

        ring_added = len(candidate_list) - ring_before
        self.stdout.write(f'  Ring nodes added   : {ring_added}')
        self.stdout.write(f'  Total unique nodes : {len(candidate_list)}')

        # ── STEP 4: Save nodes ────────────────────────────────────
        self.stdout.write('=== STEP 4: SAVE NODES ===')
        RouteNode.objects.bulk_create(
            [RouteNode(latitude=lat, longitude=lng) for lat, lng in candidate_list],
            batch_size=2000
        )
        self.stdout.write(f'  Saved {RouteNode.objects.count()} nodes.')

        # Reload with DB-assigned IDs
        node_rows   = list(RouteNode.objects.values_list('id', 'latitude', 'longitude'))
        node_coords = [(row[0], float(row[1]), float(row[2])) for row in node_rows]

        # ── STEP 5: Build edges ───────────────────────────────────
        max_dist_m = step * 1.7 + 0.5   # diagonal + small buffer
        max_d_lat  = max_dist_m / _LAT_TO_M
        max_d_lng  = max_dist_m / _LNG_TO_M

        self.stdout.write(f'  Connecting nodes within {max_dist_m:.1f}m with Shapely intersection checks...')

        edges_data   = []
        checked      = 0
        skipped_dist = 0
        skipped_bldg = 0

        # Pre-compute local-metric coords for all nodes
        node_m = [(nid, _to_m(lat, lng), lat, lng)
                  for nid, lat, lng in node_coords]

        for i in range(len(node_m)):
            nid_a, (xa, ya), lat_a, lng_a = node_m[i]
            for j in range(i + 1, len(node_m)):
                nid_b, (xb, yb), lat_b, lng_b = node_m[j]

                # Fast bounding-box pre-filter (degree space)
                if abs(lat_a - lat_b) > max_d_lat or abs(lng_a - lng_b) > max_d_lng:
                    continue

                checked += 1
                dist = _haversine(lat_a, lng_a, lat_b, lng_b)
                if dist > max_dist_m:
                    skipped_dist += 1
                    continue

                # Shapely exact check: does this line segment CROSS (go through) any buffered obstacle?
                # Use crosses() not intersects() — intersects blocks even boundary-touching lines,
                # which would disconnect ring nodes that legitimately connect along a building edge.
                if merged_obs is not None:
                    line = LineString([(xa, ya), (xb, yb)])
                    if line.crosses(merged_obs):
                        skipped_bldg += 1
                        continue

                edges_data.append((nid_a, nid_b, dist))

        self.stdout.write(f'  Pairs checked       : {checked}')
        self.stdout.write(f'  Skipped (distance)  : {skipped_dist}')
        self.stdout.write(f'  Skipped (obstacle)  : {skipped_bldg}')
        self.stdout.write(f'  Valid edges (uni-dir): {len(edges_data)}')

        # ── STEP 6: Save edges ────────────────────────────────────
        self.stdout.write('=== STEP 6: SAVE EDGES ===')
        node_obj_map = {n.id: n for n in RouteNode.objects.all()}

        bulk_edges = []
        for nid_a, nid_b, dist in edges_data:
            na = node_obj_map.get(nid_a)
            nb = node_obj_map.get(nid_b)
            if na and nb:
                la, lna = float(na.latitude), float(na.longitude)
                lb, lnb = float(nb.latitude), float(nb.longitude)
                bulk_edges.append(RouteEdge(node_a=na, node_b=nb, distance=dist,
                                            points=[[la, lna], [lb, lnb]], is_active=True))
                bulk_edges.append(RouteEdge(node_a=nb, node_b=na, distance=dist,
                                            points=[[lb, lnb], [la, lna]], is_active=True))

        RouteEdge.objects.bulk_create(bulk_edges, batch_size=5000)
        self.stdout.write(f'  Saved {RouteEdge.objects.count()} edges (bidirectional).')

        # ── STEP 7: Connectivity report + PRUNE isolated components ─
        self.stdout.write('=== STEP 7: CONNECTIVITY REPORT + PRUNING ===')
        adj = {}
        for nid_a, nid_b, _ in edges_data:
            adj.setdefault(nid_a, []).append(nid_b)
            adj.setdefault(nid_b, []).append(nid_a)

        visited    = set()
        components = []
        for nid, _, _, _ in node_m:
            if nid not in visited:
                comp  = []
                stack = [nid]
                while stack:
                    curr = stack.pop()
                    if curr in visited:
                        continue
                    visited.add(curr)
                    comp.append(curr)
                    for nb in adj.get(curr, []):
                        if nb not in visited:
                            stack.append(nb)
                components.append(comp)

        isolated    = sum(1 for c in components if len(c) == 1)
        sizes       = sorted((len(c) for c in components), reverse=True)
        n_comp_pre  = len(components)

        self.stdout.write(f'  Pre-prune nodes     : {RouteNode.objects.count()}')
        self.stdout.write(f'  Pre-prune edges     : {RouteEdge.objects.count()}')
        self.stdout.write(f'  Components          : {n_comp_pre}')
        self.stdout.write(f'  Largest comp        : {sizes[0] if sizes else 0} nodes')
        self.stdout.write(f'  Isolated nodes      : {isolated}')

        if n_comp_pre > 1:
            # Keep only the largest component
            self.stdout.write(f'  Pruning {n_comp_pre - 1} minor components...')
            largest_comp = set(max(components, key=len))
            # Delete nodes not in the largest component (CASCADE removes their edges)
            pruned_ids = [nid for nid, _, _, _ in node_m if nid not in largest_comp]
            if pruned_ids:
                # Delete edges first (to avoid FK issues), then nodes
                RouteEdge.objects.filter(node_a_id__in=pruned_ids).delete()
                RouteEdge.objects.filter(node_b_id__in=pruned_ids).delete()
                RouteNode.objects.filter(id__in=pruned_ids).delete()
            self.stdout.write(f'  Pruned {len(pruned_ids)} nodes and their edges.')

        total_nodes = RouteNode.objects.count()
        total_edges = RouteEdge.objects.count()

        self.stdout.write(f'  Final nodes   : {total_nodes}')
        self.stdout.write(f'  Final edges   : {total_edges}  (bidirectional)')

        if n_comp_pre == 1:
            self.stdout.write(self.style.SUCCESS('  [OK] Graph is FULLY CONNECTED (no pruning needed).'))
        else:
            self.stdout.write(self.style.SUCCESS(
                f'  [OK] Graph pruned to 1 component ({total_nodes} nodes).'))

        self.stdout.write(self.style.SUCCESS(
            f'\n=== DONE === {total_nodes} nodes, {total_edges} edges.'))

