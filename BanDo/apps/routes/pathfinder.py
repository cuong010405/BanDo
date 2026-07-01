import math
import heapq
import time
from locations.models import RouteNode, RouteEdge

def haversine_distance(lat1, lon1, lat2, lon2):
    """
    Calculate the great circle distance between two points 
    on the earth (specified in decimal degrees) in meters.
    """
    # Convert decimal degrees to radians
    lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
    
    # Haversine formula
    dlon = lon2 - lon1
    dlat = lat2 - lat1
    a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    r = 6371000 # Radius of earth in meters
    return c * r

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
                
    exec_time = (time.perf_counter() - start_time) * 1000.0 # to milliseconds
    return best_path, best_geometry, total_dist, visited_count, exec_time

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
                
    exec_time = (time.perf_counter() - start_time) * 1000.0 # to milliseconds
    return best_path, best_geometry, total_dist, visited_count, exec_time

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
