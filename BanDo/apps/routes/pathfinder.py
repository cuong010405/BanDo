import math
import heapq
import time
from locations.models import RouteNode, RouteEdge

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees) in meters.
    """
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371000
    return c * r

def _perp_distance(point, line_start, line_end):
    """Perpendicular distance from point to line segment (in degrees, OK for small areas)."""
    x0, y0 = point
    x1, y1 = line_start
    x2, y2 = line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x0 - x1, y0 - y1)
    t = ((x0 - x1) * dx + (y0 - y1) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    return math.hypot(x0 - (x1 + t * dx), y0 - (y1 + t * dy))

def douglas_peucker(points, epsilon=0.000012):
    """Ramer-Douglas-Peucker algorithm to simplify polyline. epsilon ~1.3m in degrees."""
    if len(points) < 3:
        return points
    max_dist = 0.0
    max_idx = 0
    for i in range(1, len(points) - 1):
        d = _perp_distance(points[i], points[0], points[-1])
        if d > max_dist:
            max_dist = d
            max_idx = i
    if max_dist > epsilon:
        left  = douglas_peucker(points[:max_idx + 1], epsilon)
        right = douglas_peucker(points[max_idx:], epsilon)
        return left[:-1] + right
    return [points[0], points[-1]]

def find_nearest_node(lat, lng):
    """
    Find the closest RouteNode in the database to a given latitude and longitude.
    """
    nodes = RouteNode.objects.all()
    if not nodes.exists():
        return None
    
    best_node = None
    min_dist = float('inf')
    
    for node in nodes:
        dist = haversine_distance(lat, lng, node.latitude, node.longitude)
        if dist < min_dist:
            min_dist = dist
            best_node = node
            
    return best_node

def snap_to_road_graph(lat, lng):
    """
    Finds the closest point on any RouteEdge's detailed geometry points (Multi-segment).
    Returns:
        snapped_lat, snapped_lng: float coordinates snapped onto the road
        nearest_node_id: the ID of the nearest RouteNode to start routing from
        edge_geom_to_node: list of [lat, lng] points from the snapped position to that nearest RouteNode
    """
    nodes = RouteNode.objects.all()
    if not nodes.exists():
        return lat, lng, None, []

    edges = RouteEdge.objects.filter(is_active=True).select_related('node_a', 'node_b')
    if not edges.exists():
        # Fallback to nearest node
        best_node = None
        min_dist = float('inf')
        for node in nodes:
            d = haversine_distance(lat, lng, node.latitude, node.longitude)
            if d < min_dist:
                min_dist = d
                best_node = node
        if best_node:
            return float(best_node.latitude), float(best_node.longitude), best_node.id, []
        return lat, lng, None, []

    best_edge = None
    best_snap_lat = lat
    best_snap_lng = lng
    min_dist = float('inf')
    best_segment_pts = []
    best_segment_idx = 0

    for edge in edges:
        pts = edge.points
        if not pts:
            # If no points, create a segment between node_a and node_b
            pts = [
                [float(edge.node_a.latitude), float(edge.node_a.longitude)],
                [float(edge.node_b.latitude), float(edge.node_b.longitude)]
            ]
        else:
            # Make sure endpoints are floats
            pts = [[float(pt[0]), float(pt[1])] for pt in pts]
            # Ensure the endpoints are connected to the nodes
            first_pt = [float(edge.node_a.latitude), float(edge.node_a.longitude)]
            last_pt = [float(edge.node_b.latitude), float(edge.node_b.longitude)]
            if haversine_distance(pts[0][0], pts[0][1], first_pt[0], first_pt[1]) > 1:
                pts = [first_pt] + pts
            if haversine_distance(pts[-1][0], pts[-1][1], last_pt[0], last_pt[1]) > 1:
                pts = pts + [last_pt]

        # Find closest point on this multi-segment line
        for i in range(len(pts) - 1):
            A = pts[i]
            B = pts[i + 1]
            dx = B[1] - A[1]
            dy = B[0] - A[0]
            len_sq = dx * dx + dy * dy
            if len_sq > 0:
                t = ((lng - A[1]) * dx + (lat - A[0]) * dy) / len_sq
                t = max(0.0, min(1.0, t))
                snap_lat = A[0] + t * dy
                snap_lng = A[1] + t * dx
            else:
                snap_lat, snap_lng = A[0], A[1]

            d = haversine_distance(lat, lng, snap_lat, snap_lng)
            if d < min_dist:
                min_dist = d
                best_snap_lat = snap_lat
                best_snap_lng = snap_lng
                best_edge = edge
                best_segment_pts = pts
                best_segment_idx = i

    if not best_edge:
        # Fallback to nearest node
        best_node = None
        min_dist = float('inf')
        for node in nodes:
            d = haversine_distance(lat, lng, node.latitude, node.longitude)
            if d < min_dist:
                min_dist = d
                best_node = node
        if best_node:
            return float(best_node.latitude), float(best_node.longitude), best_node.id, []
        return lat, lng, None, []

    # Path from snapped position to node_a:
    pts_to_a = [[best_snap_lat, best_snap_lng]] + list(reversed(best_segment_pts[:best_segment_idx + 1]))
    # Path from snapped position to node_b:
    pts_to_b = [[best_snap_lat, best_snap_lng]] + best_segment_pts[best_segment_idx + 1:]

    dist_to_a = 0.0
    for i in range(len(pts_to_a) - 1):
        dist_to_a += haversine_distance(pts_to_a[i][0], pts_to_a[i][1], pts_to_a[i+1][0], pts_to_a[i+1][1])

    dist_to_b = 0.0
    for i in range(len(pts_to_b) - 1):
        dist_to_b += haversine_distance(pts_to_b[i][0], pts_to_b[i][1], pts_to_b[i+1][0], pts_to_b[i+1][1])

    if dist_to_a < dist_to_b:
        return best_snap_lat, best_snap_lng, best_edge.node_a_id, pts_to_a
    else:
        return best_snap_lat, best_snap_lng, best_edge.node_b_id, pts_to_b

def build_graph():
    """
    Builds the adjacency list representation of the graph from RouteNode and RouteEdge database objects.
    De-duplicates bidirectional database records for maximum pathfinding performance.
    """
    nodes = RouteNode.objects.all()
    edges = RouteEdge.objects.filter(is_active=True)
    
    nodes_dict = {
        node.id: (float(node.latitude), float(node.longitude), node.name or f"Nút {node.id}")
        for node in nodes
    }
    
    graph = {node_id: [] for node_id in nodes_dict.keys()}
    
    for edge in edges:
        # Check if nodes exist in dict to prevent KeyError
        if edge.node_a_id in graph and edge.node_b_id in graph:
            # Check and insert primary direction (A -> B)
            if not any(item['to'] == edge.node_b_id for item in graph[edge.node_a_id]):
                graph[edge.node_a_id].append({
                    'to': edge.node_b_id,
                    'weight': edge.distance,
                    'points': edge.points
                })
            
            # Check and insert reverse direction (B -> A)
            if not any(item['to'] == edge.node_a_id for item in graph[edge.node_b_id]):
                graph[edge.node_b_id].append({
                    'to': edge.node_a_id,
                    'weight': edge.distance,
                    'points': list(reversed(edge.points)) if edge.points else []
                })
            
    return nodes_dict, graph

def run_dijkstra(graph, start_id, target_id):
    """
    Executes Dijkstra's algorithm.
    Returns: (path_node_ids, path_geometry, distance, visited_count, exec_time_ms)
    """
    start_time = time.perf_counter()
    
    # pq stores tuple: (cost, current_node, path_so_far, geometry_so_far)
    # cost: distance in meters
    pq = [(0.0, start_id, [start_id], [])]
    visited = set()
    visited_count = 0
    
    distances = {node_id: float('inf') for node_id in graph.keys()}
    distances[start_id] = 0.0
    
    best_path = []
    best_geometry = []
    total_dist = 0.0
    
    while pq:
        dist, curr, path, geom = heapq.heappop(pq)
        
        if curr in visited:
            continue
            
        visited.add(curr)
        visited_count += 1
        
        if curr == target_id:
            best_path = path
            best_geometry = geom
            total_dist = dist
            break
            
        for edge in graph.get(curr, []):
            neighbor = edge['to']
            weight = edge['weight']
            edge_pts = edge['points']
            
            new_dist = dist + weight
            if new_dist < distances[neighbor]:
                distances[neighbor] = new_dist
                # Append points of current edge to geometry
                new_geom = geom + edge_pts
                heapq.heappush(pq, (new_dist, neighbor, path + [neighbor], new_geom))
                
    exec_time = (time.perf_counter() - start_time) * 1000.0
    simplified = douglas_peucker(best_geometry) if len(best_geometry) >= 3 else best_geometry
    return best_path, simplified, total_dist, visited_count, exec_time

def run_a_star(graph, nodes_dict, start_id, target_id):
    """
    Executes A* (A-Star) algorithm using Haversine distance heuristic.
    Returns: (path_node_ids, path_geometry, distance, visited_count, exec_time_ms)
    """
    start_time = time.perf_counter()
    
    # Retrieve target node coords for heuristic
    target_lat, target_lng, _ = nodes_dict[target_id]
    
    def heuristic(node_id):
        # Haversine distance from this node to target node
        lat, lng, _ = nodes_dict[node_id]
        return haversine_distance(lat, lng, target_lat, target_lng)

    # pq stores tuple: (f_score, g_score, current_node, path_so_far, geometry_so_far)
    # f_score = g_score + heuristic
    start_h = heuristic(start_id)
    pq = [(start_h, 0.0, start_id, [start_id], [])]
    
    visited = set()
    visited_count = 0
    
    g_scores = {node_id: float('inf') for node_id in graph.keys()}
    g_scores[start_id] = 0.0
    
    best_path = []
    best_geometry = []
    total_dist = 0.0
    
    while pq:
        f_score, g_score, curr, path, geom = heapq.heappop(pq)
        
        if curr in visited:
            continue
            
        visited.add(curr)
        visited_count += 1
        
        if curr == target_id:
            best_path = path
            best_geometry = geom
            total_dist = g_score
            break
            
        for edge in graph.get(curr, []):
            neighbor = edge['to']
            weight = edge['weight']
            edge_pts = edge['points']
            
            new_g = g_score + weight
            if new_g < g_scores[neighbor]:
                g_scores[neighbor] = new_g
                new_f = new_g + heuristic(neighbor)
                new_geom = geom + edge_pts
                heapq.heappush(pq, (new_f, new_g, neighbor, path + [neighbor], new_geom))
                
    exec_time = (time.perf_counter() - start_time) * 1000.0
    simplified = douglas_peucker(best_geometry) if len(best_geometry) >= 3 else best_geometry
    return best_path, simplified, total_dist, visited_count, exec_time

def generate_text_diagram(path, nodes_dict):
    """
    Generates a textual ASCII schema representation of the traversed nodes.
    Example: "[Cổng B] ===> [Nhà B1] ===> [Thư viện]"
    """
    if not path:
        return "Không có đường đi."
    
    names = []
    for node_id in path:
        _, _, name = nodes_dict[node_id]
        names.append(f"[{name}]")
        
    return " ➔ ".join(names)

def compute_remaining_distance(geometry, user_lat, user_lng):
    """
    Given a route geometry [[lat,lng],...] and the user's current position,
    returns the estimated remaining walking distance in meters from the
    nearest point on the route to the destination.
    """
    if not geometry or len(geometry) < 2:
        return 0.0

    best_dist = float('inf')
    best_idx = 0

    for i in range(len(geometry) - 1):
        A = geometry[i]
        B = geometry[i + 1]
        # Find closest point on segment A-B
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

    # Sum remaining segment lengths from best_idx+1 to end
    remaining = 0.0
    # Distance from user to end of segment best_idx
    remaining += haversine_distance(user_lat, user_lng,
                                    geometry[best_idx + 1][0], geometry[best_idx + 1][1])
    for i in range(best_idx + 1, len(geometry) - 1):
        remaining += haversine_distance(
            geometry[i][0], geometry[i][1],
            geometry[i + 1][0], geometry[i + 1][1]
        )
    return remaining
