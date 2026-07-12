"""
Management command: expand_graph
Run: python manage.py expand_graph
"""
import math
import sys
import io
from django.core.management.base import BaseCommand
from locations.models import RouteNode, RouteEdge


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371000 * 2 * math.asin(math.sqrt(a))


def ascii_safe(s):
    if s is None:
        return 'NULL'
    return str(s).encode('ascii', 'replace').decode()


def get_or_create_node(lat, lng, name=None, tolerance=8.0):
    for node in RouteNode.objects.all():
        if haversine(lat, lng, node.latitude, node.longitude) < tolerance:
            if name and not node.name:
                node.name = name
                node.save()
            return node, False
    node = RouteNode.objects.create(latitude=lat, longitude=lng, name=name)
    return node, True


def add_edge(node_a, node_b):
    dist = haversine(node_a.latitude, node_a.longitude, node_b.latitude, node_b.longitude)
    _, c1 = RouteEdge.objects.get_or_create(
        node_a=node_a, node_b=node_b,
        defaults={'distance': dist, 'is_active': True}
    )
    _, c2 = RouteEdge.objects.get_or_create(
        node_a=node_b, node_b=node_a,
        defaults={'distance': dist, 'is_active': True}
    )
    return c1 or c2, dist


class Command(BaseCommand):
    help = 'Expand campus graph: add missing RouteNode and RouteEdge'

    def handle(self, *args, **options):
        # Fix stdout encoding on Windows
        if hasattr(sys.stdout, 'buffer'):
            sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

        print('=== EXPAND GRAPH - DTHU CAMPUS ===')
        nodes_created = 0
        edges_created = 0

        # ============================================================
        # NODE DEFINITIONS
        # Each entry: (lat, lng, ascii_name)
        # ============================================================
        NODE_DEFS = [
            # Cong chinh
            (10.419847, 105.643041, 'Cong chinh'),
            (10.419680, 105.643041, 'Nga tu Cong chinh'),
            # Nha B block
            (10.420717, 105.642506, 'Nha B1'),
            (10.420904, 105.642823, 'Nha B2'),
            (10.421105, 105.643024, 'Nha B3'),
            (10.421303, 105.643228, 'Nha B4'),
            (10.421485, 105.643474, 'Nha B5'),
            # Nha A block
            (10.420419, 105.643402, 'Nha A1'),
            (10.419833, 105.643778, 'Nha A2'),
            (10.419691, 105.643799, 'Nha A3'),
            # Nha H block
            (10.420601, 105.643611, 'Nha H1'),
            (10.419686, 105.644293, 'Nha H2'),
            # Giang duong
            (10.419465, 105.643593, 'Giang duong 1'),
            # Khu phuong nam
            (10.418921, 105.644955, 'Truong mau giao'),
            # Nha xe Cong C
            (10.421073, 105.642450, 'Nha xe Cong C'),
            # Hieu bo
            (10.420409, 105.642938, 'Hieu bo'),
            # Nga tu trung tam
            (10.419550, 105.644800, 'Nga tu khu T'),
            (10.419100, 105.644200, 'Nga tu phia nam'),
            (10.421800, 105.642800, 'Nga tu phia bac'),
            # Truc doc chinh
            (10.420800, 105.643200, 'Truc doc 1'),
            (10.420300, 105.643400, 'Truc doc 2'),
            (10.419900, 105.643600, 'Truc doc 3'),
        ]

        print('\n--- Creating/checking nodes ---')
        for lat, lng, name in NODE_DEFS:
            node, created = get_or_create_node(lat, lng, name=name, tolerance=8.0)
            if created:
                nodes_created += 1
                print(f'  [NEW] Node {node.id}: {ascii_safe(name)} ({lat}, {lng})')
            else:
                print(f'  [OK]  Node {node.id}: {ascii_safe(name)} -> matched node {node.id}')

        # Reload all nodes
        all_nodes = {n.id: n for n in RouteNode.objects.all()}

        def N(nid):
            return all_nodes.get(nid)

        # ============================================================
        # AUTO-CONNECT NEW NODES (DISABLED)
        # ============================================================
        print('\n--- Auto-connect new nodes is disabled ---')

        # ============================================================
        # MISSING EDGES between existing nodes (id <= 55)
        # Based on actual campus road layout analysis
        # ============================================================
        print('\n--- Adding missing edges between existing nodes ---')

        MISSING_EDGES = [
            # Axis A-B corridor
            (2, 45), (21, 2), (21, 45), (46, 2), (12, 46),
            # H-block connections
            (47, 48), (48, 45),
            # Library area
            (50, 51), (51, 52), (52, 55),
            # Soccer / experiment area
            (55, 19), (19, 20), (19, 21),
            # South path A7-A9
            (21, 22), (22, 8), (8, 24), (24, 23), (23, 9), (9, 22),
            # T-block cluster
            (25, 26), (26, 27), (25, 20), (27, 23),
            # Experiment zone
            (53, 54), (54, 55), (53, 20),
            # Dang ky lao dong
            (32, 28), (32, 52), (28, 29), (29, 33), (33, 7), (7, 28),
            # North corridor
            (30, 35), (35, 34), (34, 31), (39, 30),
            # Cong C area
            (36, 15), (37, 39), (37, 17), (39, 16),
            # Main spine
            (1, 11), (11, 5), (11, 12), (12, 1),
            # B-block spine
            (43, 47), (47, 12), (44, 41), (44, 43), (49, 43), (49, 50),
            # H1 connections
            (46, 50), (46, 48),
        ]

        for a_id, b_id in MISSING_EDGES:
            na = N(a_id)
            nb = N(b_id)
            if not na or not nb:
                print(f'  [SKIP] Node {a_id} or {b_id} not found')
                continue
            created, dist = add_edge(na, nb)
            if created:
                edges_created += 1
                print(f'  [NEW] Edge: {a_id}({ascii_safe(na.name)}) <-> {b_id}({ascii_safe(nb.name)}) = {dist:.1f}m')

        # ============================================================
        # CONNECTIVITY CHECK
        # ============================================================
        from routes.pathfinder import build_graph

        print('\n=== CONNECTIVITY CHECK ===')
        nodes_dict, graph = build_graph()
        total_nodes = len(nodes_dict)
        total_adj = sum(len(v) for v in graph.values())
        isolated = [nid for nid, neighbors in graph.items() if len(neighbors) == 0]

        all_ids = list(nodes_dict.keys())
        visited = set()
        queue = [all_ids[0]]
        while queue:
            curr = queue.pop()
            if curr in visited: continue
            visited.add(curr)
            for e in graph.get(curr, []):
                queue.append(e['to'])
        unreachable = sorted(set(nodes_dict.keys()) - visited)

        # Connected components
        remaining = set(all_ids)
        components = []
        while remaining:
            start = next(iter(remaining))
            comp = set()
            q = [start]
            while q:
                curr = q.pop()
                if curr in comp: continue
                comp.add(curr)
                for e in graph.get(curr, []):
                    if e['to'] in remaining: q.append(e['to'])
            components.append(sorted(comp))
            remaining -= comp

        print(f'Total nodes: {total_nodes}')
        print(f'Total edge pairs (adj/2): {total_adj // 2}')
        print(f'Isolated nodes (0 edges): {isolated}')
        print(f'Reachable from node {all_ids[0]}: {len(visited)}/{total_nodes}')
        print(f'Unreachable nodes: {unreachable}')
        print(f'Connected components: {len(components)}')
        if len(components) > 1:
            for i, c in enumerate(components):
                print(f'  Component {i+1} ({len(c)} nodes): {c}')

        print(f'\n=== DONE ===')
        print(f'Nodes created: {nodes_created}')
        print(f'Edges created (pairs): {edges_created}')
