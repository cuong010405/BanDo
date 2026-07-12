"""
Management command: rebuild_graph
Usage: python manage.py rebuild_graph

Xóa sạch toàn bộ RouteNode và RouteEdge, sau đó rebuild lại từ dữ liệu
custom_visual_paths chuẩn của campus DTHU.
Đảm bảo graph đầy đủ, connected, và Dijkstra có thể tìm đường.
"""
import math
from django.core.management.base import BaseCommand
from locations.models import RouteNode, RouteEdge


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1)*math.cos(lat2)*math.sin(dlon/2)**2
    return 6371000 * 2 * math.asin(math.sqrt(a))


# ============================================================
# DỮ LIỆU ĐƯỜNG ĐI CAMPUS DTHU
# Mỗi path là một mảng [[lat,lng], ...] nối liên tiếp thành segments
# ============================================================
CUSTOM_VISUAL_PATHS = [
    # 1) b2 xuống nhà a1 xuống gd 1
    [[10.420755, 105.642961], [10.420067, 105.643586], [10.419661, 105.643571], [10.419514, 105.643411]],
    # 2) đoạn từ Cổng B lên thẳng nhà xe
    [[10.420353, 105.642506], [10.42136, 105.643647], [10.421451, 105.64389]],
    # 3) đoạn từ cổng b quẹo phải xuống gd 1 - T2 - A8
    [[10.420418, 105.642579], [10.419249, 105.643657], [10.41934, 105.644594], [10.419274, 105.644832]],
    # 4) hiệu bộ
    [[10.420152, 105.642826], [10.420484, 105.643205]],
    # cong c len c1
    [[10.420988, 105.641884], [10.421128, 105.642079], [10.421471, 105.641751], [10.421712, 105.641854]],
    # ho boi
    [[10.421471, 105.641751], [10.42201, 105.641261], [10.422321, 105.640886]],
    # từ gd 1 qua tòa h3
    [[10.420024, 105.643593], [10.420027, 105.644388], [10.420142, 105.644641]],
    # từ a4 qua h2
    [[10.420029, 105.644001], [10.41929, 105.644043]],
    # từ gd 1 qua a9
    [[10.419661, 105.643571], [10.41929, 105.644043], [10.418984, 105.644384]],
    # qua a7
    [[10.41929, 105.644043], [10.419032, 105.643874]],
    # A9 qua A3-A2-A1
    [[10.41934, 105.644594], [10.41976, 105.644797], [10.41953, 105.64506], [10.419185, 105.64506]],
    # ky tuc xa doc qua b5-b4-b3-b2-b1
    [[10.421573, 105.644101], [10.421539, 105.643631], [10.421824, 105.643356], [10.4209, 105.64232], [10.421128, 105.642079]],
    # đăng kí lao động
    [[10.421573, 105.644101], [10.421582, 105.64424]],
    # vong nhà xe
    [[10.421557, 105.643877], [10.421451, 105.64389], [10.42136, 105.643647]],
    # từ kí túc xá xuống nhà xe
    [[10.421451, 105.64389], [10.421197, 105.64389]],
    # qua c2
    [[10.4214, 105.642886], [10.421759, 105.642538], [10.42159, 105.64235], [10.422172, 105.641802], [10.42212, 105.641495]],
    # c1
    [[10.421851, 105.642105], [10.421712, 105.641854]],
    # fusan
    [[10.421128, 105.642079], [10.421258, 105.642284]],
    # qua san pick
    [[10.4214, 105.642886], [10.421511, 105.642616]],
    # qua san bóng rổ
    [[10.4214, 105.642886], [10.421696, 105.642917]],
    # 9 giữa b4 - b3
    [[10.4214, 105.642886], [10.421004, 105.643245]],
    # 9 giữa b3 - b2
    [[10.421241, 105.6427], [10.420853, 105.643059]],
    # qua A4
    [[10.420029, 105.644001], [10.420106, 105.643889], [10.420235, 105.643895], [10.420327, 105.643968]],
    # lòn vòng H1
    [[10.420235, 105.643895], [10.420267, 105.643646], [10.420869, 105.643093]],
    # vong ben nhà xe
    [[10.420235, 105.643895], [10.420615, 105.643925], [10.421167, 105.643439]],
    # cat cho ngoi sau H1
    [[10.420615, 105.643925], [10.420338, 105.64359]],
    # thu vien
    [[10.420948, 105.643639], [10.42106, 105.64377]],
    # nhà xe
    [[10.420615, 105.643925], [10.420932, 105.644067], [10.421197, 105.64389]],
    # khu thi nghiem
    [[10.420615, 105.643925], [10.420601, 105.644991], [10.420794, 105.644998]],
    # san bóng
    [[10.420932, 105.644067], [10.420978, 105.64463]],
    # Bridge connections to merge disconnected components
    [[10.420755, 105.642961], [10.420484, 105.643205]],  # Component 1 to 2
    [[10.42136, 105.643647], [10.421539, 105.643631]],   # Component 1 to 3
    [[10.420869, 105.643093], [10.421004, 105.643245]],  # Component 1 to 4
    [[10.421197, 105.64389], [10.42106, 105.64377]],     # Component 1 to 5
    # Extra connections for better coverage
    [[10.420353, 105.642506], [10.420755, 105.642961]],  # Cong B to B2 area
    [[10.420484, 105.643205], [10.420419, 105.643402]],  # To A1
    [[10.419514, 105.643411], [10.419465, 105.643593]],  # To Giang duong 1
    [[10.420024, 105.643593], [10.419661, 105.643571]],  # Bridge gd1 to main path
    [[10.420067, 105.643586], [10.420024, 105.643593]],  # H1 area
    [[10.420869, 105.643093], [10.420755, 105.642961]],  # Close loop
    [[10.421004, 105.643245], [10.42136, 105.643647]],   # B3 up to nha xe
    [[10.421167, 105.643439], [10.421197, 105.64389]],   # Close to nha xe
    [[10.420338, 105.64359], [10.420267, 105.643646]],   # Close H1 loop
    [[10.420948, 105.643639], [10.420869, 105.643093]],  # Library to B area
]


class Command(BaseCommand):
    help = 'Xóa sạch và rebuild toàn bộ RouteNode/RouteEdge graph từ custom_visual_paths'

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Xác nhận xóa sạch dữ liệu cũ và rebuild'
        )

    def handle(self, *args, **options):
        if not options['confirm']:
            self.stdout.write(
                'WARNING: Lenh nay se XOA SACH toan bo RouteNode va RouteEdge.\n'
                'Chay lai voi --confirm de xac nhan:\n'
                '  python manage.py rebuild_graph --confirm'
            )
            return

        self.stdout.write('=== REBUILD GRAPH - DTHU CAMPUS ===')

        # ---- BUOC 1: Xoa sach ----
        old_edges = RouteEdge.objects.count()
        old_nodes = RouteNode.objects.count()
        RouteEdge.objects.all().delete()
        RouteNode.objects.all().delete()
        self.stdout.write(
            f'Da xoa {old_edges} edges va {old_nodes} nodes cu.'
        )

        # ---- BƯỚC 2: Tạo nodes và edges từ paths ----
        # node_map: (round_lat, round_lng) -> RouteNode
        # Dùng rounding 6 chữ số thập phân (~0.1m) để merge nodes trùng nhau
        node_map = {}   # key = (lat6, lng6) -> RouteNode
        nodes_created = 0
        edges_created = 0
        TOLERANCE_DEG = 0.00005  # ~5m — merge nodes gần nhau

        def get_or_create_node_snapped(lat, lng):
            nonlocal nodes_created
            # Check if a nearby node exists (within tolerance)
            for (nlat, nlng), node in node_map.items():
                if abs(nlat - lat) < TOLERANCE_DEG and abs(nlng - lng) < TOLERANCE_DEG:
                    return node
            # Create new node
            node = RouteNode.objects.create(
                latitude=round(lat, 6),
                longitude=round(lng, 6),
                name=None
            )
            node_map[(round(lat, 6), round(lng, 6))] = node
            nodes_created += 1
            return node

        def create_edge_bidirectional(node_a, node_b, pts_ab):
            nonlocal edges_created
            if node_a.id == node_b.id:
                return
            dist = haversine(node_a.latitude, node_a.longitude,
                             node_b.latitude, node_b.longitude)
            pts_ba = list(reversed(pts_ab))

            _, c1 = RouteEdge.objects.get_or_create(
                node_a=node_a, node_b=node_b,
                defaults={'distance': dist, 'points': pts_ab, 'is_active': True}
            )
            _, c2 = RouteEdge.objects.get_or_create(
                node_a=node_b, node_b=node_a,
                defaults={'distance': dist, 'points': pts_ba, 'is_active': True}
            )
            if c1 or c2:
                edges_created += 1

        self.stdout.write('Dang tao nodes va edges tu custom_visual_paths...')

        for path in CUSTOM_VISUAL_PATHS:
            for i in range(len(path) - 1):
                p_a = path[i]
                p_b = path[i + 1]

                node_a = get_or_create_node_snapped(p_a[0], p_a[1])
                node_b = get_or_create_node_snapped(p_b[0], p_b[1])

                create_edge_bidirectional(node_a, node_b, [p_a, p_b])

        self.stdout.write(
            f'[OK] Tao xong {nodes_created} nodes va {edges_created} edges (bidirectional).'
        )

        # ---- BƯỚC 3: Kiểm tra connectivity ----
        self.stdout.write('\n=== KIEM TRA CONNECTIVITY ===')
        from routes.pathfinder import build_graph
        nodes_dict, graph = build_graph()
        total_nodes = len(nodes_dict)
        total_adj = sum(len(v) for v in graph.values())
        isolated = [nid for nid, neighbors in graph.items() if len(neighbors) == 0]

        all_ids = list(nodes_dict.keys())
        visited = set()
        queue = [all_ids[0]] if all_ids else []
        while queue:
            curr = queue.pop()
            if curr in visited:
                continue
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
                if curr in comp:
                    continue
                comp.add(curr)
                for e in graph.get(curr, []):
                    if e['to'] in remaining:
                        q.append(e['to'])
            components.append(sorted(comp))
            remaining -= comp

        self.stdout.write(f'  Nodes trong graph: {total_nodes}')
        self.stdout.write(f'  Canh bidirectional: {total_adj // 2}')
        self.stdout.write(f'  Nodes isolated (0 canh): {len(isolated)} -> {isolated[:10]}')
        self.stdout.write(f'  Reachable tu node dau: {len(visited)}/{total_nodes}')
        self.stdout.write(f'  Unreachable nodes: {len(unreachable)} -> {unreachable[:10]}')
        self.stdout.write(f'  Connected components: {len(components)}')

        if len(components) > 1:
            for i, c in enumerate(components):
                self.stdout.write(f'    Component {i+1} ({len(c)} nodes): {c}')

        if len(components) == 1 and len(unreachable) == 0:
            self.stdout.write(
                '[OK] Graph fully connected! Dijkstra se tim duoc duong giua moi cap node.'
            )
        else:
            self.stdout.write(
                f'[WARN] Graph co {len(components)} component(s) tach biet. '
                'Can them bridge edges de ket noi.'
            )

        self.stdout.write('\n=== REBUILD HOAN THANH ===')
