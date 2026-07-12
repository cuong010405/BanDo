import math
import heapq
import time
from locations.models import RouteNode, RouteEdge


# ============================================================
# BUILDING FOOTPRINTS (Đa giác vật cản các tòa nhà)
# ============================================================

BUILDING_POLYGONS = [
    # Giang Duong 1 (OSM way 970059985)
    [[10.419632, 105.643588], [10.419547, 105.643666], [10.419533, 105.643651], [10.419432, 105.643743], [10.419332, 105.64363], [10.419519, 105.64346], [10.419632, 105.643588]],
    # Hieu bo (OSM way 970059990)
    [[10.42056, 105.643073], [10.420499, 105.643129], [10.420419, 105.64304], [10.420406, 105.643052], [10.420383, 105.643026], [10.420396, 105.643014], [10.420261, 105.642862], [10.420322, 105.642806], [10.42056, 105.643073]],
    # Ky tuc xa (OSM way 970059999)
    [[10.421694, 105.643622], [10.421736, 105.644098], [10.421624, 105.644108], [10.421582, 105.643632], [10.421694, 105.643622]],
    # Nha A1 (OSM way 970059984)
    [[10.420633, 105.643263], [10.420236, 105.643639], [10.420221, 105.643817], [10.420114, 105.643808], [10.420129, 105.643621], [10.420118, 105.643616], [10.420113, 105.643607], [10.420111, 105.643596], [10.420112, 105.643583], [10.420116, 105.643573], [10.420135, 105.643557], [10.420155, 105.643554], [10.420166, 105.643557], [10.420174, 105.643565], [10.420568, 105.643192], [10.420633, 105.643263]],
    # Nha A2 (OSM way 970059997)
    [[10.41989, 105.643624], [10.419802, 105.643631], [10.419825, 105.643941], [10.419913, 105.643935], [10.41989, 105.643624]],
    # Nha A3 (OSM way 970059979)
    [[10.41972, 105.643636], [10.419619, 105.643643], [10.419644, 105.643973], [10.419745, 105.643965], [10.41972, 105.643636]],
    # Nha A4 (OSM way 970059988)
    [[10.420537, 105.643972], [10.420529, 105.64406], [10.420128, 105.644025], [10.420136, 105.643937], [10.420537, 105.643972]],
    # Nha A7 (OSM way 970059989)
    [[10.419247, 105.643745], [10.418889, 105.644063], [10.418825, 105.643988], [10.419183, 105.643671], [10.419247, 105.643745]],
    # Nha A8 (OSM way 970059993)
    [[10.419058, 105.644785], [10.419062, 105.644889], [10.419509, 105.644871], [10.419505, 105.644767], [10.419058, 105.644785]],
    # Nha A9 (OSM way 970059996)
    [[10.418952, 105.644066], [10.419025, 105.644377], [10.419046, 105.644372], [10.419072, 105.644482], [10.419056, 105.644486], [10.419103, 105.644689], [10.419003, 105.644713], [10.418857, 105.644089], [10.418952, 105.644066]],
    # Nha B1 (OSM way 970059987)
    [[10.420914, 105.642412], [10.420597, 105.642691], [10.420533, 105.642617], [10.42085, 105.642337], [10.420914, 105.642412]],
    # Nha B2 (OSM way 970059995)
    [[10.421145, 105.642666], [10.420879, 105.642917], [10.420899, 105.642939], [10.420859, 105.642978], [10.420766, 105.642876], [10.421073, 105.642588], [10.421145, 105.642666]],
    # Nha B3 (OSM way 970060004)
    [[10.42135, 105.642854], [10.421038, 105.643145], [10.420965, 105.643063], [10.421276, 105.642773], [10.42135, 105.642854]],
    # Nha B4 (OSM way 970059983)
    [[10.421468, 105.642993], [10.421159, 105.643286], [10.421254, 105.643389], [10.421296, 105.643349], [10.421279, 105.643331], [10.421546, 105.643078], [10.421468, 105.642993]],
    # Nha B5 (OSM way 970059980)
    [[10.421663, 105.643233], [10.421351, 105.643527], [10.421424, 105.643607], [10.421735, 105.643314], [10.421663, 105.643233]],
    # Nha C1 (OSM way 970060000)
    [[10.421723, 105.641609], [10.421645, 105.641685], [10.421674, 105.641716], [10.421547, 105.641839], [10.421513, 105.641803], [10.42145, 105.641864], [10.421728, 105.64216], [10.421792, 105.642097], [10.421576, 105.641867], [10.421617, 105.641827], [10.421647, 105.641859], [10.421692, 105.641816], [10.421662, 105.641783], [10.421704, 105.641742], [10.421935, 105.641988], [10.42201, 105.641915], [10.421723, 105.641609]],
    # Nha C2 (OSM way 970059994)
    [[10.422024, 105.641335], [10.421947, 105.641407], [10.422194, 105.641679], [10.422271, 105.641608], [10.422024, 105.641335]],
    # Nha H1 (OSM way 970059986)
    [[10.420803, 105.643637], [10.42059, 105.643818], [10.420399, 105.643587], [10.420612, 105.643406], [10.420803, 105.643637]],
    # Nha H2 (OSM way 970059991)
    [[10.41984, 105.644067], [10.419726, 105.644071], [10.419729, 105.644156], [10.419618, 105.64416], [10.419616, 105.644082], [10.419501, 105.644086], [10.419514, 105.6445], [10.419575, 105.644498], [10.419575, 105.644514], [10.419627, 105.644513], [10.419619, 105.644252], [10.419741, 105.644248], [10.419749, 105.6445], [10.419801, 105.644499], [10.4198, 105.644465], [10.419852, 105.644464], [10.41984, 105.644067]],
    # Nha T2 (OSM way 970060001)
    [[10.419747, 105.644977], [10.418998, 105.64504], [10.419045, 105.645143], [10.419755, 105.645083], [10.419747, 105.644977]],
    # Nha thi dau da nang (OSM way 970060003)
    [[10.421268, 105.642037], [10.421585, 105.64237], [10.42134, 105.64261], [10.421024, 105.642278], [10.421268, 105.642037]],
    # Thu vien (OSM way 970060002)
    [[10.421074, 105.643624], [10.420917, 105.643771], [10.421052, 105.64392], [10.421209, 105.643773], [10.421074, 105.643624]],
    # Truong Mam non Hoa Hong (OSM way 970059982)
    [[10.418983, 105.644723], [10.418863, 105.644758], [10.418908, 105.64492], [10.418703, 105.644979], [10.4187, 105.645043], [10.418843, 105.645052], [10.418936, 105.645026], [10.418941, 105.645044], [10.419062, 105.64501], [10.418983, 105.644723]],
    # UBND Phuong 6 (OSM way 373171158)
    [[10.419631, 105.642264], [10.419536, 105.642145], [10.419348, 105.642298], [10.419442, 105.642418], [10.419631, 105.642264]],
    # San soccer / San bong da (OSM way 970059992: leisure=pitch)
    [[10.421322, 105.644165], [10.421286, 105.644732], [10.420429, 105.644676], [10.420465, 105.644110], [10.421322, 105.644165]],
    # San Pickleball (OSM way 970059981: leisure=pitch)
    [[10.421585, 105.642396], [10.421313, 105.642646], [10.421440, 105.642789], [10.421717, 105.642539], [10.421585, 105.642396]],
    # San Basketball (OSM way 970059998: leisure=pitch)
    [[10.421638, 105.642721], [10.421493, 105.642848], [10.421720, 105.643116], [10.421865, 105.642989], [10.421638, 105.642721]],
]


# ============================================================
# CAMPUS BOUNDS
# ============================================================

CAMPUS_BOUNDS = {
    'minLat': 10.4188,   # South boundary (above Trường mầm non)
    'maxLat': 10.4225,   # North boundary (Hồ bơi / C2)
    'minLng': 105.6408,  # West boundary (Hồ bơi – NOT Phạm Hữu Lầu ~105.637)
    'maxLng': 105.6453   # East boundary (T1/T2 – NOT Lê Văn Kiệt ~105.647)
}


def is_point_in_campus(lat, lng):
    """
    Kiểm tra xem toạ độ lat, lng có nằm trong khuôn viên trường (campus bounds) không.
    """
    return (CAMPUS_BOUNDS['minLat'] <= lat <= CAMPUS_BOUNDS['maxLat'] and
            CAMPUS_BOUNDS['minLng'] <= lng <= CAMPUS_BOUNDS['maxLng'])


# ============================================================
# GEOMETRY UTILITIES (Kiểm tra giao cắt đa giác vật cản)
# ============================================================

def point_in_polygon(x, y, poly):
    """
    Ray-casting algorithm để kiểm tra xem điểm (x, y) có nằm trong đa giác poly không.
    poly là danh sách các điểm [[lat, lng], ...]
    """
    n = len(poly)
    inside = False
    p1x, p1y = poly[0][0], poly[0][1]
    for i in range(n + 1):
        p2x, p2y = poly[i % n][0], poly[i % n][1]
        if y > min(p1y, p2y):
            if y <= max(p1y, p2y):
                if x <= max(p1x, p2x):
                    if p1y != p2y:
                        xinters = (y - p1y) * (p2x - p1x) / (p2y - p1y) + p1x
                    if p1x == p2x or x <= xinters:
                        inside = not inside
        p1x, p1y = p2x, p2y
    return inside


def line_intersection(p1, p2, p3, p4):
    """
    Trả về True nếu đoạn thẳng p1-p2 cắt đoạn thẳng p3-p4.
    Mỗi điểm là một tuple/list [lat, lng].
    """
    x1, y1 = p1[0], p1[1]
    x2, y2 = p2[0], p2[1]
    x3, y3 = p3[0], p3[1]
    x4, y4 = p4[0], p4[1]

    denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1)
    if denom == 0:
        return False  # Song song hoặc trùng nhau

    ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom
    ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom

    return 0 <= ua <= 1 and 0 <= ub <= 1


def is_edge_valid(lat_a, lng_a, lat_b, lng_b):
    """
    Kiểm tra một RouteEdge nối giữa A và B có cắt qua bất kỳ đa giác tòa nhà nào không
    và có nằm trong khuôn viên trường (Campus) không.
    """
    # 0. Kiểm tra nếu các điểm nằm ngoài khuôn viên trường
    if not is_point_in_campus(lat_a, lng_a) or not is_point_in_campus(lat_b, lng_b):
        return False

    p1 = [lat_a, lng_a]
    p2 = [lat_b, lng_b]

    for poly in BUILDING_POLYGONS:
        # 1. Nếu bất kỳ đầu mút nào nằm trọn trong tòa nhà → Cạnh INVALID
        if point_in_polygon(lat_a, lng_a, poly) or point_in_polygon(lat_b, lng_b, poly):
            return False

        # 2. Kiểm tra giao cắt với từng đoạn biên của đa giác tòa nhà
        n = len(poly)
        for i in range(n):
            p3 = poly[i]
            p4 = poly[(i + 1) % n]
            if line_intersection(p1, p2, p3, p4):
                return False

    return True


# ============================================================
# HAVERSINE DISTANCE
# ============================================================

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Tính khoảng cách (mét) giữa 2 toạ độ trên mặt cầu Trái Đất.
    """
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return c * 6371000  # mét


# ============================================================
# FIND NEAREST NODE (snap điểm GPS → node gần nhất)
# ============================================================

def find_nearest_node(lat, lng):
    """
    Tìm RouteNode gần nhất với toạ độ (lat, lng).
    Đảm bảo line segment từ (lat, lng) đến node không đi xuyên qua bất kỳ tòa nhà nào khác
    (ngoại trừ tòa nhà mà (lat, lng) đang đứng bên trong).
    """
    nodes = RouteNode.objects.all()
    if not nodes.exists():
        return None

    # Xác định xem điểm bắt đầu có nằm trong tòa nhà nào không
    own_poly_idx = None
    for idx, poly in enumerate(BUILDING_POLYGONS):
        if point_in_polygon(lat, lng, poly):
            own_poly_idx = idx
            break

    best_node = None
    min_dist = float('inf')

    for node in nodes:
        node_lat = float(node.latitude)
        node_lng = float(node.longitude)

        # Bỏ qua các node nằm trong lòng bất kỳ tòa nhà nào
        node_inside_building = False
        for poly in BUILDING_POLYGONS:
            if point_in_polygon(node_lat, node_lng, poly):
                node_inside_building = True
                break
        if node_inside_building:
            continue

        # Kiểm tra xem đường nối thẳng từ marker (lat, lng) đến node có cắt qua tòa nhà nào khác không
        crosses_other_building = False
        for idx, poly in enumerate(BUILDING_POLYGONS):
            if idx == own_poly_idx:
                continue # Được phép cắt qua biên của tòa nhà của chính nó để đi ra ngoài
            
            # Kiểm tra xem đoạn thẳng nối marker với node có cắt qua biên của poly không
            n = len(poly)
            for i in range(n):
                p3 = poly[i]
                p4 = poly[(i + 1) % n]
                if line_intersection([lat, lng], [node_lat, node_lng], p3, p4):
                    crosses_other_building = True
                    break
            if crosses_other_building:
                break
                
        if crosses_other_building:
            continue

        dist = haversine_distance(lat, lng, node_lat, node_lng)
        if dist < min_dist:
            min_dist = dist
            best_node = node

    # Fallback nếu mọi node đều bị chắn
    if not best_node:
        min_dist = float('inf')
        for node in nodes:
            node_lat = float(node.latitude)
            node_lng = float(node.longitude)
            
            # Vẫn bỏ qua node trong nhà
            node_inside_building = False
            for poly in BUILDING_POLYGONS:
                if point_in_polygon(node_lat, node_lng, poly):
                    node_inside_building = True
                    break
            if node_inside_building:
                continue
                
            dist = haversine_distance(lat, lng, node_lat, node_lng)
            if dist < min_dist:
                min_dist = dist
                best_node = node

    return best_node


# ============================================================
# BUILD GRAPH
# ============================================================

def build_graph():
    """
    Xây dựng đồ thị từ RouteNode và RouteEdge trong DB.
    - nodes_dict: { node_id: (lat, lng, name) }
    - graph (adjacency list): { node_id: [ {to, weight, points, reversed_points}, ... ] }
      + points: danh sách waypoints của edge theo chiều A→B
      + reversed_points: danh sách waypoints theo chiều B→A
    Chỉ cho phép Dijkstra/A* đi qua các cạnh hợp lệ (không cắt qua tòa nhà).
    """
    nodes = RouteNode.objects.all()
    edges = RouteEdge.objects.filter(is_active=True).select_related('node_a', 'node_b')

    nodes_dict = {
        node.id: (float(node.latitude), float(node.longitude), node.name or f"Nút {node.id}")
        for node in nodes
    }

    # graph: { from_id: { to_id: {weight, points} } }
    graph_raw = {node_id: {} for node_id in nodes_dict}

    for edge in edges:
        a_id = edge.node_a_id
        b_id = edge.node_b_id

        if a_id not in nodes_dict or b_id not in nodes_dict:
            continue

        a_lat, a_lng, _ = nodes_dict[a_id]
        b_lat, b_lng, _ = nodes_dict[b_id]

        # NOTE: Không validate is_edge_valid ở đây vì các edge trong DB (is_active=True)
        # đã được admin kiểm tra và xác nhận hợp lệ.
        # Validation is_edge_valid chỉ áp dụng khi TẠO MỚI edge qua API.

        # Dùng distance từ DB nếu có, fallback về haversine
        dist = float(edge.distance) if edge.distance else haversine_distance(a_lat, a_lng, b_lat, b_lng)

        # Lấy waypoints của edge (đã lưu trong DB). Nếu không có thì dùng 2 node endpoints
        pts = edge.points if isinstance(edge.points, list) and len(edge.points) >= 2 else [
            [a_lat, a_lng], [b_lat, b_lng]
        ]
        rev_pts = list(reversed(pts))  # Chiều ngược B→A

        # Hướng A→B
        if b_id not in graph_raw[a_id] or dist < graph_raw[a_id][b_id]['weight']:
            graph_raw[a_id][b_id] = {'weight': dist, 'points': pts}

        # Hướng B→A (đồ thị vô hướng)
        if a_id not in graph_raw[b_id] or dist < graph_raw[b_id][a_id]['weight']:
            graph_raw[b_id][a_id] = {'weight': dist, 'points': rev_pts}

    # Chuyển sang adjacency list
    adjacency = {
        nid: [
            {'to': neighbor, 'weight': info['weight'], 'points': info['points']}
            for neighbor, info in neighbors.items()
        ]
        for nid, neighbors in graph_raw.items()
    }

    return nodes_dict, adjacency


# ============================================================
# DIJKSTRA
# ============================================================

def run_dijkstra(graph, nodes_dict, start_id, target_id):
    """
    Thuật toán Dijkstra tìm đường ngắn nhất từ start_id đến target_id.
    Trả về geometry nối theo edge.points thực tế (không phải đường thẳng giữa các node).
    """
    start_time = time.perf_counter()

    dist = {node_id: float('inf') for node_id in graph}
    dist[start_id] = 0.0
    prev = {start_id: None}       # prev[node] = node trước đó
    prev_edge = {start_id: None}  # prev_edge[node] = edge info dẫn đến node này

    counter = 0
    pq = [(0.0, counter, start_id)]
    visited = set()
    visited_count = 0

    while pq:
        d, _, curr = heapq.heappop(pq)

        if curr in visited:
            continue
        visited.add(curr)
        visited_count += 1

        if curr == target_id:
            break

        for edge in graph.get(curr, []):
            neighbor = edge['to']
            alt = d + edge['weight']
            if alt < dist.get(neighbor, float('inf')):
                dist[neighbor] = alt
                prev[neighbor] = curr
                prev_edge[neighbor] = edge  # Lưu lại toàn bộ edge info (gồm 'points')
                counter += 1
                heapq.heappush(pq, (alt, counter, neighbor))

    exec_ms = (time.perf_counter() - start_time) * 1000.0

    if target_id not in prev:
        return [], [], 0.0, visited_count, exec_ms

    # --- Reconstruct path (node IDs) ---
    path = []
    node = target_id
    while node is not None:
        path.append(node)
        node = prev.get(node)
    path.reverse()

    # --- Reconstruct geometry theo edge.points ---
    # Ghép waypoints của từng edge segment, tránh trùng điểm nối
    geometry = []
    for i in range(len(path)):
        nid = path[i]
        if i == 0:
            # Điểm đầu tiên: chỉ thêm tọa độ node xuất phát
            lat, lng, _ = nodes_dict[nid]
            geometry.append([lat, lng])
        else:
            # Lấy waypoints của edge dẫn đến node này
            edge_info = prev_edge.get(nid)
            if edge_info and 'points' in edge_info and len(edge_info['points']) >= 2:
                pts = edge_info['points']
                # Bỏ điểm đầu (đã có ở iteration trước), thêm từ pts[1] trở đi
                for pt in pts[1:]:
                    geometry.append(pt)
            else:
                # Fallback: đường thẳng đến node
                lat, lng, _ = nodes_dict[nid]
                geometry.append([lat, lng])

    # Loại bỏ điểm trùng liên tiếp
    clean_geometry = []
    for pt in geometry:
        if not clean_geometry or pt != clean_geometry[-1]:
            clean_geometry.append(pt)

    return path, clean_geometry, dist[target_id], visited_count, exec_ms


# ============================================================
# A* (A-STAR)
# ============================================================

def run_a_star(graph, nodes_dict, start_id, target_id):
    """
    Thuật toán A* với heuristic Haversine.
    Trả về geometry nối theo edge.points thực tế (không phải đường thẳng giữa các node).
    """
    start_time = time.perf_counter()

    target_lat, target_lng, _ = nodes_dict[target_id]

    def heuristic(node_id):
        lat, lng, _ = nodes_dict[node_id]
        return haversine_distance(lat, lng, target_lat, target_lng)

    g_score = {node_id: float('inf') for node_id in graph}
    g_score[start_id] = 0.0
    prev = {start_id: None}       # prev[node] = node trước đó
    prev_edge = {start_id: None}  # prev_edge[node] = edge info dẫn đến node này

    counter = 0
    pq = [(heuristic(start_id), counter, start_id)]
    visited = set()
    visited_count = 0

    while pq:
        _, _, curr = heapq.heappop(pq)

        if curr in visited:
            continue
        visited.add(curr)
        visited_count += 1

        if curr == target_id:
            break

        for edge in graph.get(curr, []):
            neighbor = edge['to']
            new_g = g_score[curr] + edge['weight']
            if new_g < g_score.get(neighbor, float('inf')):
                g_score[neighbor] = new_g
                prev[neighbor] = curr
                prev_edge[neighbor] = edge  # Lưu lại edge info (gồm 'points')
                new_f = new_g + heuristic(neighbor)
                counter += 1
                heapq.heappush(pq, (new_f, counter, neighbor))

    exec_ms = (time.perf_counter() - start_time) * 1000.0

    if target_id not in prev:
        return [], [], 0.0, visited_count, exec_ms

    # --- Reconstruct path (node IDs) ---
    path = []
    node = target_id
    while node is not None:
        path.append(node)
        node = prev.get(node)
    path.reverse()

    # --- Reconstruct geometry theo edge.points ---
    geometry = []
    for i in range(len(path)):
        nid = path[i]
        if i == 0:
            lat, lng, _ = nodes_dict[nid]
            geometry.append([lat, lng])
        else:
            edge_info = prev_edge.get(nid)
            if edge_info and 'points' in edge_info and len(edge_info['points']) >= 2:
                pts = edge_info['points']
                for pt in pts[1:]:
                    geometry.append(pt)
            else:
                lat, lng, _ = nodes_dict[nid]
                geometry.append([lat, lng])

    # Loại bỏ điểm trùng liên tiếp
    clean_geometry = []
    for pt in geometry:
        if not clean_geometry or pt != clean_geometry[-1]:
            clean_geometry.append(pt)

    return path, clean_geometry, g_score[target_id], visited_count, exec_ms


# ============================================================
# TEXT DIAGRAM
# ============================================================

def generate_text_diagram(path, nodes_dict):
    if not path:
        return "Không có đường đi."
    names = [f"[{nodes_dict[nid][2]}]" for nid in path if nid in nodes_dict]
    return " ➔ ".join(names)


# ============================================================
# REMAINING DISTANCE
# ============================================================

def compute_remaining_distance(geometry, user_lat, user_lng):
    if not geometry or len(geometry) < 2:
        return 0.0

    best_dist = float('inf')
    best_idx = 0

    for i in range(len(geometry) - 1):
        A = geometry[i]
        B = geometry[i + 1]
        dx = B[1] - A[1]
        dy = B[0] - A[0]
        len_sq = dx * dx + dy * dy
        if len_sq > 0:
            t = ((user_lng - A[1]) * dx + (user_lat - A[0]) * dy) / len_sq
            t = max(0.0, min(1.0, t))
            snap_lat = A[0] + t * dy
            snap_lng = A[1] + t * dx
        else:
            snap_lat, snap_lng = A[0], A[1]

        d = haversine_distance(user_lat, user_lng, snap_lat, snap_lng)
        if d < best_dist:
            best_dist = d
            best_idx = i

    remaining = haversine_distance(
        user_lat, user_lng,
        geometry[best_idx + 1][0], geometry[best_idx + 1][1]
    )
    for i in range(best_idx + 1, len(geometry) - 1):
        remaining += haversine_distance(
            geometry[i][0], geometry[i][1],
            geometry[i + 1][0], geometry[i + 1][1]
        )
    return remaining


# ============================================================
# AUTOMATIC CAMPUS GRAPH GENERATION
# ============================================================

CAMPUS_BOUNDARY_POLY = [
    [10.422350, 105.640850],
    [10.422200, 105.641100],
    [10.422050, 105.641350],
    [10.421900, 105.641600],
    [10.421750, 105.641850],
    [10.421600, 105.642050],
    [10.421450, 105.642200],
    [10.421300, 105.642300],
    [10.421150, 105.642200],
    [10.421000, 105.642050],
    [10.420850, 105.641900],
    [10.420700, 105.641800],
    [10.420550, 105.641750],
    [10.420400, 105.641700],
    [10.420250, 105.641680],
    [10.420100, 105.641700],
    [10.419950, 105.641750],
    [10.419800, 105.641850],
    [10.419650, 105.642000],
    [10.419500, 105.642200],
    [10.419400, 105.642400],
    [10.419350, 105.642600],
    [10.419300, 105.642800],
    [10.419250, 105.643000],
    [10.419200, 105.643200],
    [10.419150, 105.643400],
    [10.419100, 105.643600],
    [10.419050, 105.643800],
    [10.419000, 105.644000],
    [10.418950, 105.644200],
    [10.418900, 105.644400],
    [10.418880, 105.644600],
    [10.418870, 105.644800],
    [10.418880, 105.645000],
    [10.418920, 105.645100],
    [10.419000, 105.645150],
    [10.419100, 105.645180],
    [10.419200, 105.645200],
    [10.419400, 105.645220],
    [10.419600, 105.645230],
    [10.419800, 105.645220],
    [10.420000, 105.645200],
    [10.420200, 105.645180],
    [10.420400, 105.645150],
    [10.420600, 105.645100],
    [10.420800, 105.645050],
    [10.421000, 105.645000],
    [10.421200, 105.644980],
    [10.421400, 105.644960],
    [10.421600, 105.644940],
    [10.421800, 105.644900],
    [10.422000, 105.644850],
    [10.422200, 105.644800],
    [10.422300, 105.644600],
    [10.422350, 105.644400],
    [10.422380, 105.644200],
    [10.422400, 105.644000],
    [10.422380, 105.643800],
    [10.422350, 105.643600],
    [10.422300, 105.643400],
    [10.422250, 105.643200],
    [10.422200, 105.643000],
    [10.422150, 105.642800],
    [10.422100, 105.642600],
    [10.422050, 105.642400],
    [10.422000, 105.642200],
    [10.422120, 105.641495],  # match path nodes
    [10.421712, 105.641854],
    [10.421471, 105.641751],
    [10.421258, 105.642284],
    [10.420988, 105.641884],
    [10.420800, 105.641000],
    [10.420700, 105.641100],
    [10.420600, 105.641250],
    [10.420500, 105.641400],
    [10.420400, 105.641550],
    [10.420350, 105.641700],
    [10.420300, 105.641850],
    [10.420250, 105.641680]
]

def auto_generate_graph_data(spacing_m=5.0):
    """
    Tự động sinh mạng lưới RouteNode và RouteEdge theo hình mẫu 100% bằng cách:
    - Sử dụng các đường đi thực tế WALKWAY_PATHS
    - Sample/nội suy các điểm dọc đường đi cách nhau spacing_m mét
    - Loại bỏ node nằm trong lòng các tòa nhà
    - Gộp các nút giao nhau quá gần (< 3.5m) để tạo ngã ba, ngã tư sạch
    - Tự động kết nối các nút liên tiếp dọc theo đường đi, và các nút gần nhau (< 6.5m) không đi qua building
    - Đảm bảo đồ thị liên thông hoàn toàn và không cô lập
    """
    from locations.management.commands.rebuild_nodes import WALKWAY_PATHS, sample_path

    # 1. Sample toàn bộ các path dọc lối đi
    sampled_paths = []
    for path in WALKWAY_PATHS:
        if isinstance(path, list) and len(path) > 0:
            if isinstance(path[0], list):
                sampled = sample_path(path, step_m=spacing_m)
                sampled_paths.append(sampled)
            else:
                sampled_paths.append([(path[0], path[1])])

    # 2. Thu thập điểm hợp lệ ngoài building
    raw_points = []
    for path in sampled_paths:
        for pt in path:
            raw_points.append(pt)

    valid_points = []
    for lat, lng in raw_points:
        inside = False
        for poly in BUILDING_POLYGONS:
            if point_in_polygon(lat, lng, poly):
                inside = True
                break
        if not inside:
            valid_points.append((lat, lng))

    # 3. Gộp các điểm giao nhau gần nhau (< 3.5m) để tạo các ngã ba, ngã tư
    MERGE_DIST = 3.5
    merged_points = []
    for lat, lng in valid_points:
        found = False
        for i, (mlat, mlng) in enumerate(merged_points):
            if haversine_distance(lat, lng, mlat, mlng) < MERGE_DIST:
                merged_points[i] = (
                    round((mlat + lat) / 2.0, 6),
                    round((mlng + lng) / 2.0, 6)
                )
                found = True
                break
        if not found:
            merged_points.append((round(lat, 6), round(lng, 6)))

    # Helper tìm node ID gần nhất
    def get_closest_node_idx(lat, lng):
        min_d = float('inf')
        best_idx = 0
        for idx, (mlat, mlng) in enumerate(merged_points):
            d = haversine_distance(lat, lng, mlat, mlng)
            if d < min_d:
                min_d = d
                best_idx = idx
        return best_idx

    # 4. Sinh các Cạnh
    edges_set = set()

    # Thêm các cạnh dọc theo thứ tự các đường đi đã sample
    for path in sampled_paths:
        for i in range(len(path) - 1):
            p1 = path[i]
            p2 = path[i + 1]
            in_b1 = any(point_in_polygon(p1[0], p1[1], poly) for poly in BUILDING_POLYGONS)
            in_b2 = any(point_in_polygon(p2[0], p2[1], poly) for poly in BUILDING_POLYGONS)
            if not in_b1 and not in_b2:
                u = get_closest_node_idx(p1[0], p1[1])
                v = get_closest_node_idx(p2[0], p2[1])
                if u != v and is_edge_valid(merged_points[u][0], merged_points[u][1], merged_points[v][0], merged_points[v][1]):
                    edges_set.add(tuple(sorted((u, v))))

    # Đồng thời kết nối các nút nằm gần nhau (< spacing_m * 1.3)
    max_d = spacing_m * 1.3
    num_nodes = len(merged_points)
    for i in range(num_nodes):
        lat_a, lng_a = merged_points[i]
        for j in range(i + 1, num_nodes):
            lat_b, lng_b = merged_points[j]
            d = haversine_distance(lat_a, lng_a, lat_b, lng_b)
            if d <= max_d:
                if is_edge_valid(lat_a, lng_a, lat_b, lng_b):
                    edges_set.add(tuple(sorted((i, j))))

    # 5. Kiểm tra liên thông và nối các thành phần rời rạc
    adj = {i: [] for i in range(num_nodes)}
    for u, v in edges_set:
        w = haversine_distance(merged_points[u][0], merged_points[u][1], merged_points[v][0], merged_points[v][1])
        adj[u].append((v, w))
        adj[v].append((u, w))

    visited = set()
    components = []
    for i in range(num_nodes):
        if i not in visited:
            comp = []
            queue = [i]
            comp_visited = {i}
            while queue:
                curr = queue.pop(0)
                comp.append(curr)
                visited.add(curr)
                for neighbor, _ in adj[curr]:
                    if neighbor not in comp_visited:
                        comp_visited.add(neighbor)
                        queue.append(neighbor)
            components.append(comp)

    if not components:
        return [], []

    components.sort(key=len, reverse=True)
    main_component = set(components[0])

    for comp in components[1:]:
        best_pair = None
        min_d = float('inf')
        for u in comp:
            lat_u, lng_u = merged_points[u]
            for v in main_component:
                lat_v, lng_v = merged_points[v]
                d = haversine_distance(lat_u, lng_u, lat_v, lng_v)
                if d < min_d and d < spacing_m * 3.0:
                    if is_edge_valid(lat_u, lng_u, lat_v, lng_v):
                        min_d = d
                        best_pair = (u, v)
        if best_pair:
            edges_set.add(tuple(sorted(best_pair)))
            main_component.update(comp)

    # Loại bỏ các node cô lập không thuộc main_component
    final_node_indices = sorted(list(main_component))
    index_map = {old_idx: new_idx for new_idx, old_idx in enumerate(final_node_indices)}

    final_nodes = [merged_points[idx] for idx in final_node_indices]
    final_edges = []
    for u, v in edges_set:
        if u in index_map and v in index_map:
            new_u = index_map[u]
            new_v = index_map[v]
            w = haversine_distance(final_nodes[new_u][0], final_nodes[new_u][1], final_nodes[new_v][0], final_nodes[new_v][1])
            final_edges.append((new_u, new_v, w))

    return final_nodes, final_edges


def generate_campus_graph(spacing_m=4.0, merge_dist=2.5, max_edge_dist=7.0):
    """
    Tạo mới hoàn toàn graph-campus: xóa cũ, sinh RouteNode + RouteEdge phủ kín toàn bộ campus.

    Thuật toán:
    1. Sample điểm dọc WALKWAY_PATHS với khoảng cách spacing_m.
    2. Thêm điểm bao quanh mỗi Building (building perimeter nodes).
    3. Gộp các điểm gần nhau (< merge_dist) để tránh trùng.
    4. Loại bỏ điểm nằm trong Building.
    5. Tạo edge giữa các điểm liên tiếp trên cùng path.
    6. Tạo edge giữa các điểm gần nhau (≤ max_edge_dist) nếu hợp lệ.
    7. Đảm bảo đồ thị liên thông.
    """
    from locations.management.commands.rebuild_nodes import WALKWAY_PATHS, sample_path

    # ── 1. Sample dọc WALKWAY_PATHS ──────────────────────────
    # WALKWAY_PATHS là flat list [lat, lng, lat, lng, ...] hoặc [[lat,lng], [lat,lng], ...]
    # Xử lý như một đường đi liên tục
    if len(WALKWAY_PATHS) > 0:
        if isinstance(WALKWAY_PATHS[0], list):
            # [[lat, lng], [lat, lng], ...] — list of points
            raw_points = sample_path(WALKWAY_PATHS, step_m=spacing_m)
        else:
            # Flat list [lat, lng, lat, lng, ...]
            pts = []
            for i in range(0, len(WALKWAY_PATHS) - 1, 2):
                pts.append((WALKWAY_PATHS[i], WALKWAY_PATHS[i + 1]))
            raw_points = sample_path(pts, step_m=spacing_m)
    else:
        raw_points = []

    # ── 2. Thêm building perimeter nodes ─────────────────────
    for poly in BUILDING_POLYGONS:
        n = len(poly)
        for i in range(n):
            lat1, lng1 = poly[i]
            lat2, lng2 = poly[(i + 1) % n]
            edge_len = haversine_distance(lat1, lng1, lat2, lng2)
            num_pts = max(2, int(round(edge_len / spacing_m)))
            for j in range(num_pts):
                t = j / num_pts
                lat = lat1 + t * (lat2 - lat1)
                lng = lng1 + t * (lng2 - lng1)
                # Offset ra ngoài ~2m để node nằm sát building nhưng không trùng
                if n >= 4:
                    dlat = lat2 - lat1
                    dlng = lng2 - lng1
                    norm = math.sqrt(dlat ** 2 + dlng ** 2) or 1e-9
                    # Hướng normal (vuông góc với cạnh)
                    offset = 0.00002  # ~2m
                    nlat = lat + dlng / norm * offset
                    nlng = lng - dlat / norm * offset
                    raw_points.append((round(nlat, 7), round(nlng, 7)))

    # ── 3. Loại bỏ điểm nằm trong Building ──────────────────
    valid_points = []
    for lat, lng in raw_points:
        inside = any(point_in_polygon(lat, lng, p) for p in BUILDING_POLYGONS)
        if not inside:
            valid_points.append((lat, lng))

    # ── 4. Gộp các điểm gần nhau ────────────────────────────
    merged = []
    for lat, lng in valid_points:
        found = False
        for i, (mlat, mlng) in enumerate(merged):
            if haversine_distance(lat, lng, mlat, mlng) < merge_dist:
                merged[i] = (
                    round((mlat + lat) / 2.0, 6),
                    round((mlng + lng) / 2.0, 6),
                )
                found = True
                break
        if not found:
            merged.append((round(lat, 6), round(lng, 6)))

    num_nodes = len(merged)
    if num_nodes < 2:
        return [], []

    # ── 5. Helper ────────────────────────────────────────────
    def closest_idx(lat, lng):
        best, best_d = 0, float("inf")
        for i, (a, b) in enumerate(merged):
            d = haversine_distance(lat, lng, a, b)
            if d < best_d:
                best_d = d
                best = i
        return best

    def edge_valid(i, j):
        if i == j:
            return False
        a, b = merged[i], merged[j]
        if not is_edge_valid(a[0], a[1], b[0], b[1]):
            return False
        return True

    # ── 6. Tạo edges dọc theo WALKWAY_PATHS ─────────────────
    edges_set = set()
    if len(WALKWAY_PATHS) > 0:
        if isinstance(WALKWAY_PATHS[0], list):
            sampled_path = sample_path(WALKWAY_PATHS, step_m=spacing_m)
        else:
            pts = []
            for i in range(0, len(WALKWAY_PATHS) - 1, 2):
                pts.append((WALKWAY_PATHS[i], WALKWAY_PATHS[i + 1]))
            sampled_path = sample_path(pts, step_m=spacing_m)

        for k in range(len(sampled_path) - 1):
            p1, p2 = sampled_path[k], sampled_path[k + 1]
            in1 = any(point_in_polygon(p1[0], p1[1], p) for p in BUILDING_POLYGONS)
            in2 = any(point_in_polygon(p2[0], p2[1], p) for p in BUILDING_POLYGONS)
            if not in1 and not in2:
                u, v = closest_idx(p1[0], p1[1]), closest_idx(p2[0], p2[1])
                if u != v and edge_valid(u, v):
                    edges_set.add(tuple(sorted((u, v))))

    # ── 7. Kết nối các node gần nhau (dùng KDTree) ───────────
    from scipy.spatial import KDTree
    coords_lnglat = [(b, a) for a, b in merged]  # KDTree uses (x, y) = (lng, lat)
    tree = KDTree(coords_lnglat)
    # Query pairs within max_edge_dist (convert meters to approx degrees: 1m ~ 0.00001 deg)
    approx_deg = max_edge_dist * 0.00001
    pairs = tree.query_pairs(r=approx_deg)
    for i, j in pairs:
        if edge_valid(i, j):
            edges_set.add(tuple(sorted((i, j))))

    # ── 8. Kiểm tra liên thông ───────────────────────────────
    adj = {i: set() for i in range(num_nodes)}
    for u, v in edges_set:
        adj[u].add(v)
        adj[v].add(u)

    visited = set()
    components = []
    for i in range(num_nodes):
        if i not in visited:
            comp = []
            stack = [i]
            while stack:
                c = stack.pop()
                if c in visited:
                    continue
                visited.add(c)
                comp.append(c)
                for nb in adj[c]:
                    if nb not in visited:
                        stack.append(nb)
            components.append(comp)

    if not components:
        return [], []

    components.sort(key=len, reverse=True)
    main_comp = set(components[0])

    for comp in components[1:]:
        best_pair, best_d = None, float("inf")
        for u in comp:
            for v in main_comp:
                d = haversine_distance(merged[u][0], merged[u][1], merged[v][0], merged[v][1])
                if d < best_d and d < spacing_m * 4 and edge_valid(u, v):
                    best_d = d
                    best_pair = (u, v)
        if best_pair:
            edges_set.add(tuple(sorted(best_pair)))
            adj[best_pair[0]].add(best_pair[1])
            adj[best_pair[1]].add(best_pair[0])
            main_comp.update(comp)

    # ── 9. Output ────────────────────────────────────────────
    idx_map = {old: new for new, old in enumerate(sorted(main_comp))}
    final_nodes = [merged[i] for i in sorted(main_comp)]
    final_edges = []
    for u, v in edges_set:
        if u in idx_map and v in idx_map:
            nu, nv = idx_map[u], idx_map[v]
            w = haversine_distance(
                final_nodes[nu][0], final_nodes[nu][1],
                final_nodes[nv][0], final_nodes[nv][1],
            )
            final_edges.append((nu, nv, w))

    return final_nodes, final_edges
