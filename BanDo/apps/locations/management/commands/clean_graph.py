
import math
from django.core.management.base import BaseCommand
from locations.models import RouteNode, RouteEdge


def haversine(lat1, lon1, lat2, lon2):
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon, dlat = lon2 - lon1, lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


def sample_path(path_coords, step_m=6.0):
    """Sinh node đều đặn dọc theo path, giữ điểm đầu và cuối."""
    result = []
    for i in range(len(path_coords) - 1):
        p1, p2 = path_coords[i], path_coords[i + 1]
        dist = haversine(p1[0], p1[1], p2[0], p2[1])
        if dist < 0.5:
            result.append((round(p1[0], 7), round(p1[1], 7)))
            continue
        n = max(1, int(round(dist / step_m)))
        for k in range(n):
            t = k / n
            result.append((round(p1[0] + t * (p2[0] - p1[0]), 7),
                            round(p1[1] + t * (p2[1] - p1[1]), 7)))
    last = path_coords[-1]
    result.append((round(last[0], 7), round(last[1], 7)))
    return result


# ============================================================
# CAMPUS POLYGON — Đa giác khuôn viên ĐHĐT (tight boundary)
# Chỉ chấp nhận node nằm BÊN TRONG polygon này
# ============================================================
CAMPUS_POLYGON = [
    [10.422321, 105.640886],  # NW góc tây bắc (hồ bơi)
    [10.422350, 105.641800],  # Bắc
    [10.422300, 105.642200],  # Bắc-đông
    [10.422100, 105.642600],  # Đông bắc
    [10.421800, 105.643000],  # Đông bắc
    [10.421800, 105.643500],  # Đông bắc
    [10.421700, 105.644000],  # Đông bắc
    [10.421600, 105.644300],  # Đông
    [10.421200, 105.644500],  # Đông
    [10.420900, 105.645100],  # Đông nam
    [10.420200, 105.645200],  # Nam đông
    [10.419500, 105.645200],  # Nam
    [10.419000, 105.645100],  # Nam
    [10.418800, 105.644900],  # Nam tây
    [10.418700, 105.644500],  # Nam tây
    [10.418800, 105.644000],  # Tây nam
    [10.419000, 105.643500],  # Tây nam
    [10.419200, 105.643200],  # Tây
    [10.419400, 105.642800],  # Tây
    [10.419700, 105.642400],  # Tây bắc
    [10.420100, 105.642100],  # Tây bắc
    [10.420400, 105.641900],  # Tây bắc
    [10.420800, 105.641600],  # Tây bắc
    [10.421100, 105.641400],  # Tây bắc
    [10.421400, 105.641200],  # Tây bắc
    [10.421700, 105.641000],  # Tây bắc
    [10.422000, 105.640900],  # Tây bắc
    [10.422321, 105.640886],  # Về góc NW
]


def point_in_polygon_campus(lat, lng):
    """Ray-casting: kiểm tra điểm có nằm trong CAMPUS_POLYGON không."""
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
# INTERNAL CAMPUS WALKWAYS — Only paths inside the campus
# Tất cả các con đường NỘI BỘ thực tế, không có đường bao ngoài
# ============================================================
INTERNAL_PATHS = [

    # ================================================================
    # [A] TRỤC ĐƯỜNG CHÍNH TỪ CỔNG B ĐI VÀO TRUNG TÂM
    # Cổng B → Hiệu bộ → Nhà A1 → GD1
    # ================================================================
    [
        [10.420380, 105.642530],  # Cổng B (ngưỡng cổng nội bộ)
        [10.420260, 105.642650],
        [10.420150, 105.642820],  # Trước Hiệu bộ
        [10.420070, 105.643000],
        [10.419950, 105.643180],
        [10.419800, 105.643350],
        [10.419660, 105.643570],  # Giao lộ A1 - GD1
        [10.419510, 105.643410],  # Giảng đường 1
    ],

    # ================================================================
    # [B] TỪ CỔNG B ĐI LÊN PHÍA BẮC — VÀO KHU B
    # Cổng B → Nhà xe Cổng C → Nhà B2 → B3 → B4 → B5
    # ================================================================
    [
        [10.420380, 105.642530],  # Cổng B
        [10.420550, 105.642700],
        [10.420750, 105.642900],  # Giao lộ B1-B2
        [10.420860, 105.643050],
        [10.420970, 105.643200],  # Giao lộ B2-B3
        [10.421100, 105.643350],
        [10.421240, 105.643470],  # Giao lộ B3-B4
        [10.421360, 105.643620],  # Nhà xe cổng B
        [10.421450, 105.643850],  # Vòng xe
    ],

    # ================================================================
    # [C] TRỤC DỌC KHU B — TỪ TRƯỚC NHÀ THDĐN → HẾT KHU B
    # Nhà thi đấu → B1 → B2 → ... bên trái đường trục
    # ================================================================
    [
        [10.421128, 105.642079],  # Cổng C / giao lộ nhà thi đấu đa năng
        [10.421200, 105.642200],
        [10.421260, 105.642290],  # Nhà thi đấu đa năng
        [10.421350, 105.642430],
        [10.421400, 105.642560],
        [10.421400, 105.642870],  # Giao lộ sân pickleball
    ],

    # ================================================================
    # [D] SÂN PICKLEBALL + SÂN BÓNG RỔ
    # ================================================================
    [
        [10.421400, 105.642870],  # Junction
        [10.421500, 105.642620],  # Sân pickleball
    ],
    [
        [10.421400, 105.642870],  # Junction
        [10.421700, 105.642920],  # Sân bóng rổ
    ],

    # ================================================================
    # [E] CỔNG C → VÀO NHÀ C1
    # ================================================================
    [
        [10.420988, 105.641884],  # Cổng C (vào campus)
        [10.421128, 105.642079],  # Giao lộ THDĐN
        [10.421470, 105.641750],  # Góc hướng C1
        [10.421712, 105.641854],  # Nhà C1
        [10.421850, 105.642100],  # Phía bắc C1
    ],

    # ================================================================
    # [F] C1 → C2 → HỒ BƠI (đường nội bộ khu thể thao)
    # ================================================================
    [
        [10.421850, 105.642100],  # Bắc C1
        [10.421760, 105.642540],  # Giao
        [10.421590, 105.642360],  # Hướng C2
        [10.422170, 105.641800],  # Bắc
        [10.422120, 105.641500],  # Nhà C2
    ],
    [
        [10.421470, 105.641750],  # Cổng C hướng hồ bơi
        [10.422010, 105.641260],  # Trước hồ bơi
        [10.422321, 105.640886],  # Hồ bơi (điểm cực)
    ],

    # ================================================================
    # [G] TRỤC TRUNG TÂM — HIỆU BỘ → THƯ VIỆN → KTX
    # ================================================================
    [
        [10.420750, 105.642900],  # Giao lộ B
        [10.420480, 105.643200],  # Trước hiệu bộ
        [10.420340, 105.643590],  # Giao lộ H1
        [10.420260, 105.643650],
        [10.420070, 105.643590],  # GD1 - H1
        [10.420020, 105.643600],  # GD1
    ],

    # ================================================================
    # [H] TRỤC ĐI TỪ A1 ĐẾN KHU A (A2, A3, A4, H2)
    # ================================================================
    [
        [10.419660, 105.643570],  # Giao lộ A1
        [10.419290, 105.644040],  # Giao lộ A7 / H2 / A9
        [10.419030, 105.643870],  # Nhà A7
    ],
    [
        [10.419290, 105.644040],  # Giao lộ
        [10.419340, 105.644590],  # A9 hướng nam
        [10.419760, 105.644800],  # T3
        [10.419530, 105.645060],  # T2
        [10.419180, 105.645060],  # T1
    ],
    [
        [10.419340, 105.644590],  # A9
        [10.419270, 105.644830],  # A8
    ],

    # ================================================================
    # [I] KHU A4 / NHÀKHÁT VỌNG / SÂN SOCCER
    # ================================================================
    [
        [10.420020, 105.644000],  # Giao lộ A4
        [10.420100, 105.643890],  # Hướng H1
        [10.420240, 105.643900],  # Giao lộ H1-A4
        [10.420330, 105.643970],  # Nhà A4
    ],
    [
        [10.420240, 105.643900],  # Giao lộ
        [10.420270, 105.643650],  # Dọc H1
        [10.420870, 105.643090],  # Trước thư viện / giao lộ B3
    ],
    [
        [10.420240, 105.643900],  # Giao lộ
        [10.420620, 105.643930],  # Hướng nhà xe
        [10.420940, 105.644070],  # Giao lộ nhà xe
        [10.421170, 105.643890],  # Nhà xe cổng B
        [10.421360, 105.643620],  # Nối trục B
    ],
    [
        [10.420620, 105.643930],  # Giao lộ
        [10.420340, 105.643590],  # Nối lại giao lộ GD1
    ],
    [
        [10.420940, 105.644070],  # Nhà xe hướng nam
        [10.420980, 105.644630],  # Sân soccer
    ],

    # ================================================================
    # [J] KHU THÍ NGHIỆM + ĐĂK KÍ LAO ĐỘNG
    # ================================================================
    [
        [10.420620, 105.643930],  # Giao lộ
        [10.420600, 105.644990],  # Khu thí nghiệm
        [10.420790, 105.644990],  # Thí nghiệm cuối
    ],
    [
        [10.421360, 105.643620],  # Nhà xe trục B
        [10.421540, 105.643630],  # Hướng KTX
        [10.421550, 105.643880],  # Nối nhà xe
    ],
    [
        [10.421540, 105.643630],  # Nhánh KTX
        [10.421580, 105.644240],  # Đăng ký lao động
        [10.421570, 105.644100],  # KTX
    ],

    # ================================================================
    # [K] THƯ VIỆN → NHÀ XE → KTX (nhánh phụ)
    # ================================================================
    [
        [10.420870, 105.643090],  # Trước thư viện
        [10.420950, 105.643640],  # Thư viện
        [10.421060, 105.643770],  # Thư viện vào
    ],
    [
        [10.421060, 105.643770],  # Thư viện
        [10.421170, 105.643890],  # Nhà xe
    ],

    # ================================================================
    # [L] KTX ĐI QUA B5 → B4 → B3 → B2 → B1
    # Trục ngang phía đông khu B
    # ================================================================
    [
        [10.421570, 105.644100],  # KTX
        [10.421540, 105.643630],  # Giao lộ
        [10.421820, 105.643360],  # Góc B5 phía đông
        [10.421240, 105.642700],  # Hướng giữa B3-B4
        [10.420900, 105.642320],  # Hướng B1 đông
        [10.421128, 105.642079],  # Cổng C
    ],

    # ================================================================
    # [M] CỔNG CHÍNH → TRỤC DỌC NỘI BỘ
    # ================================================================
    [
        [10.419847, 105.643041],  # Cổng chính
        [10.420000, 105.643200],
        [10.420060, 105.643400],
        [10.420240, 105.643900],  # Giao lộ H1
    ],
    [
        [10.419847, 105.643041],  # Cổng chính
        [10.419660, 105.643570],  # Giao lộ A1
    ],

    # ================================================================
    # [N] GD1 → TRỤC NGANG PHÍA NAM
    # ================================================================
    [
        [10.420020, 105.643600],  # GD1 / H2
        [10.420020, 105.644390],  # Nhà Khát vọng phía nam
        [10.420140, 105.644640],  # Nhà Khát vọng
    ],
    [
        [10.420020, 105.644390],  # Giao lộ trục ngang
        [10.420020, 105.644000],  # Về A4
    ],

]


class Command(BaseCommand):
    help = "Xóa sạch graph cũ và tạo lại đồ thị đường đi NỘI BỘ khuôn viên ĐHĐT"

    def add_arguments(self, parser):
        parser.add_argument(
            '--confirm',
            action='store_true',
            help='Xác nhận xóa và tạo lại graph'
        )

    def handle(self, *args, **options):
        if not options['confirm']:
            self.stdout.write(self.style.WARNING(
                "Thêm --confirm để xác nhận xóa toàn bộ graph và tạo lại."
            ))
            return

        # ── 1. Xóa sạch ───────────────────────────────────────────
        self.stdout.write("=== XÓA GRAPH CŨ ===")
        edge_count = RouteEdge.objects.count()
        node_count = RouteNode.objects.count()
        RouteEdge.objects.all().delete()
        RouteNode.objects.all().delete()
        self.stdout.write(f"Đã xóa {edge_count} edges và {node_count} nodes.")

        # ── 2. Sinh nodes từ INTERNAL_PATHS ───────────────────────
        self.stdout.write("=== TẠO NODES NỘI BỘ ===")

        MERGE_DIST_M = 5.0   # Khoảng cách tối thiểu để merge 2 node

        all_nodes = {}  # (lat7, lng7) → RouteNode object
        nodes_created = 0
        nodes_skipped_outside = 0

        def get_or_create_node(lat, lng):
            nonlocal nodes_created, nodes_skipped_outside

            # Kiểm tra campus boundary
            if not point_in_polygon_campus(lat, lng):
                nodes_skipped_outside += 1
                return None

            # Tìm node gần nhất trong bán kính MERGE_DIST_M
            best = None
            best_dist = MERGE_DIST_M
            for (plat, plng), node in all_nodes.items():
                d = haversine(lat, lng, plat, plng)
                if d < best_dist:
                    best_dist = d
                    best = node

            if best:
                return best

            # Tạo node mới
            key = (round(lat, 7), round(lng, 7))
            node = RouteNode.objects.create(latitude=lat, longitude=lng)
            all_nodes[key] = node
            nodes_created += 1
            return node

        # ── 3. Tạo edges ──────────────────────────────────────────
        edges_created = 0

        for path_def in INTERNAL_PATHS:
            sampled = sample_path(path_def, step_m=6.0)
            path_nodes = []
            for (lat, lng) in sampled:
                n = get_or_create_node(lat, lng)
                if n is not None:
                    path_nodes.append(n)

            # Nối edge tuần tự dọc path
            for i in range(len(path_nodes) - 1):
                na = path_nodes[i]
                nb = path_nodes[i + 1]
                if na.id == nb.id:
                    continue
                dist = haversine(
                    float(na.latitude), float(na.longitude),
                    float(nb.latitude), float(nb.longitude)
                )
                # Tránh tạo edge quá dài (bất thường)
                if dist > 60:
                    self.stdout.write(self.style.WARNING(
                        f"  [SKIP] Edge quá dài {dist:.1f}m: {na.id} → {nb.id}"
                    ))
                    continue
                _, c1 = RouteEdge.objects.get_or_create(
                    node_a=na, node_b=nb,
                    defaults={'distance': dist, 'points': [], 'is_active': True}
                )
                _, c2 = RouteEdge.objects.get_or_create(
                    node_a=nb, node_b=na,
                    defaults={'distance': dist, 'points': [], 'is_active': True}
                )
                if c1:
                    edges_created += 1
                if c2:
                    edges_created += 1

        # ── 4. Kiểm tra connectivity ──────────────────────────────
        self.stdout.write("=== KIỂM TRA KẾT QUẢ ===")
        total_nodes = RouteNode.objects.count()
        total_edges = RouteEdge.objects.count()

        # BFS connectivity
        all_node_ids = list(RouteNode.objects.values_list('id', flat=True))
        adj = {nid: set() for nid in all_node_ids}
        for e in RouteEdge.objects.values('node_a_id', 'node_b_id'):
            adj[e['node_a_id']].add(e['node_b_id'])
            adj[e['node_b_id']].add(e['node_a_id'])

        if all_node_ids:
            visited = {all_node_ids[0]}
            queue = [all_node_ids[0]]
            while queue:
                curr = queue.pop(0)
                for nb in adj[curr]:
                    if nb not in visited:
                        visited.add(nb)
                        queue.append(nb)
            isolated = len(all_node_ids) - len(visited)
        else:
            isolated = 0

        self.stdout.write(f"  Tổng nodes: {total_nodes}")
        self.stdout.write(f"  Tổng edges: {total_edges}")
        self.stdout.write(f"  Nodes bị bỏ qua (ngoài campus): {nodes_skipped_outside}")
        self.stdout.write(f"  Nodes bị cô lập: {isolated}")

        if isolated == 0:
            self.stdout.write(self.style.SUCCESS("  ✓ Đồ thị LIÊN THÔNG hoàn toàn!"))
        else:
            self.stdout.write(self.style.WARNING(
                f"  ⚠ Có {isolated} node bị cô lập. Kiểm tra lại INTERNAL_PATHS."
            ))

        self.stdout.write(self.style.SUCCESS(
            f"\n=== HOÀN THÀNH === {total_nodes} nodes, {total_edges} edges."
        ))
