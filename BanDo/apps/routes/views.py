from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from routes.models import Route, RoutePoint
from routes.serializers import RouteSerializer
from routes.pathfinder import (
    find_nearest_node, build_graph,
    run_dijkstra, run_a_star,
    generate_text_diagram, haversine_distance,
    compute_remaining_distance, snap_to_road_graph
)
from history.models import SearchHistory


class RouteViewSet(viewsets.ReadOnlyModelViewSet):
    """List and retrieve saved routes."""
    serializer_class = RouteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Route.objects.filter(user=self.request.user).select_related('user')


def _build_route_result(algorithm_label, path, geom, dist, visited, exec_time,
                        nodes_dict, start_lat, start_lng):
    """
    Build a standardised route result dict.
    Prepends the raw GPS position as the very first geometry point so the
    polyline always starts exactly at the user marker with no visual gap.
    """
    clean_geom = []
    for pt in geom:
        if not clean_geom or pt != clean_geom[-1]:
            clean_geom.append(pt)
    if clean_geom and (clean_geom[0][0] != start_lat or clean_geom[0][1] != start_lng):
        clean_geom = [[start_lat, start_lng]] + clean_geom

    return {
        'algorithm': algorithm_label,
        'complexity': 'O((V+E)logV)' if 'Dijkstra' in algorithm_label else 'O(E logV) with heuristic',
        'path_nodes': path,
        'geometry': clean_geom,
        'distance_m': round(dist, 2),
        'distance_km': round(dist / 1000, 3),
        'duration_s': round(dist / 1.2, 1),
        'visited_nodes': visited,
        'exec_time_ms': round(exec_time, 4),
        'text_diagram': generate_text_diagram(path, nodes_dict),
        'path_names': [nodes_dict[n][2] for n in path],
    }


class CalculateRouteView(APIView):
    """
    Core pathfinding API endpoint.
    Snaps raw coordinates to the nearest road network segments (Map Matching / Snap-to-Road)
    before running the Dijkstra/A* routing algorithm.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = request.data
        try:
            start_lat = float(data.get('start_lat'))
            start_lng = float(data.get('start_lng'))
            end_lat   = float(data.get('end_lat'))
            end_lng   = float(data.get('end_lng'))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid coordinates.'}, status=status.HTTP_400_BAD_REQUEST)

        algorithm  = data.get('algorithm', 'both')
        start_name = data.get('start_name', f'{start_lat:.4f},{start_lng:.4f}')
        end_name   = data.get('end_name',   f'{end_lat:.4f},{end_lng:.4f}')

        # 1. Snap start and end to active campus walkway edges
        snap_start_lat, snap_start_lng, start_node_id, geom_to_start = snap_to_road_graph(start_lat, start_lng)
        snap_end_lat, snap_end_lng, end_node_id, geom_to_end = snap_to_road_graph(end_lat, end_lng)

        if not start_node_id or not end_node_id:
            return Response({'error': 'Could not find nearby graph nodes.'},
                            status=status.HTTP_404_NOT_FOUND)

        # Pre-calculate snapping overhead distances
        dist_to_start = 0.0
        for i in range(len(geom_to_start) - 1):
            dist_to_start += haversine_distance(geom_to_start[i][0], geom_to_start[i][1], geom_to_start[i+1][0], geom_to_start[i+1][1])

        dist_to_end = 0.0
        for i in range(len(geom_to_end) - 1):
            dist_to_end += haversine_distance(geom_to_end[i][0], geom_to_end[i][1], geom_to_end[i+1][0], geom_to_end[i+1][1])

        # If snapped to same edge node
        if start_node_id == end_node_id:
            distance = haversine_distance(snap_start_lat, snap_start_lng, snap_end_lat, snap_end_lng)
            direct_result = {
                'algorithm': 'A* (A-Star)',
                'complexity': 'O(E logV) with heuristic',
                'path_nodes': [start_node_id],
                'geometry': [[start_lat, start_lng], [snap_start_lat, snap_start_lng], [snap_end_lat, snap_end_lng]],
                'distance_m': round(distance, 2),
                'distance_km': round(distance / 1000, 3),
                'duration_s': round(distance / 1.2, 1),
                'visited_nodes': 1,
                'exec_time_ms': 0.1,
                'text_diagram': '[Kết nối trực tiếp đường đi]',
                'path_names': ['Lộ trình đi thẳng'],
            }
            result = {
                'start': {'lat': start_lat, 'lng': start_lng, 'name': start_name, 'nearest_node': start_node_id},
                'end':   {'lat': end_lat,   'lng': end_lng,   'name': end_name,   'nearest_node': end_node_id},
                'graph_size': {'nodes': 1, 'edges': 1},
                'primary': direct_result,
                'dijkstra': direct_result,
                'a_star': direct_result,
            }
            return Response(result, status=status.HTTP_200_OK)

        nodes_dict, graph = build_graph()

        if start_node_id not in nodes_dict or end_node_id not in nodes_dict:
            return Response({'error': 'Node not found in graph.'},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        result = {
            'start': {'lat': start_lat, 'lng': start_lng, 'name': start_name, 'nearest_node': start_node_id},
            'end':   {'lat': end_lat,   'lng': end_lng,   'name': end_name,   'nearest_node': end_node_id},
            'graph_size': {'nodes': len(nodes_dict), 'edges': sum(len(v) for v in graph.values()) // 2},
        }

        dijkstra_result = None
        a_star_result   = None

        # Build full geometry: user -> snap_start -> start_node -> graph route -> end_node -> snap_end -> destination
        # Note: geom_to_start starts at snapped user and ends at start_node_id
        # geom_to_end starts at snapped target and ends at end_node_id (needs reverse from end_node_id to snapped target)
        geom_from_end = list(reversed(geom_to_end))

        if algorithm in ('dijkstra', 'both'):
            d_path, d_geom, d_dist, d_visited, d_time = run_dijkstra(graph, start_node_id, end_node_id)
            if d_path:
                full_d_geom = geom_to_start + d_geom + geom_from_end
                full_d_dist = dist_to_start + d_dist + dist_to_end
                dijkstra_result = _build_route_result(
                    'Dijkstra', d_path, full_d_geom, full_d_dist, d_visited, d_time,
                    nodes_dict, start_lat, start_lng)

        if algorithm in ('a_star', 'both'):
            a_path, a_geom, a_dist, a_visited, a_time = run_a_star(graph, nodes_dict, start_node_id, end_node_id)
            if a_path:
                full_a_geom = geom_to_start + a_geom + geom_from_end
                full_a_dist = dist_to_start + a_dist + dist_to_end
                a_star_result = _build_route_result(
                    'A* (A-Star)', a_path, full_a_geom, full_a_dist, a_visited, a_time,
                    nodes_dict, start_lat, start_lng)

        primary = dijkstra_result or a_star_result
        if not primary:
            return Response({'error': 'No path found between these two locations.'},
                            status=status.HTTP_404_NOT_FOUND)

        result['dijkstra'] = dijkstra_result
        result['a_star']   = a_star_result
        result['primary']  = primary

        if dijkstra_result and a_star_result:
            result['comparison'] = {
                'dijkstra_visited': dijkstra_result['visited_nodes'],
                'a_star_visited':   a_star_result['visited_nodes'],
                'dijkstra_time_ms': dijkstra_result['exec_time_ms'],
                'a_star_time_ms':   a_star_result['exec_time_ms'],
                'efficiency_gain':  round(
                    (1 - a_star_result['visited_nodes'] / max(dijkstra_result['visited_nodes'], 1)) * 100, 1
                ),
                'same_distance': abs(dijkstra_result['distance_m'] - a_star_result['distance_m']) < 0.1,
            }

        try:
            user = request.user if request.user.is_authenticated else None
            SearchHistory.objects.create(
                user=user, query=f"{start_name} -> {end_name}",
                latitude=start_lat, longitude=start_lng)
        except Exception:
            pass

        try:
            if request.user.is_authenticated:
                route = Route.objects.create(
                    user=request.user, start_name=start_name[:255], end_name=end_name[:255],
                    start_latitude=start_lat, start_longitude=start_lng,
                    end_latitude=end_lat, end_longitude=end_lng,
                    distance=primary['distance_m'], duration=primary['duration_s'],
                    algorithm='dijkstra' if dijkstra_result else 'a_star',
                    geometry=primary['geometry'])
                for seq, pt in enumerate(primary['geometry']):
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        RoutePoint.objects.create(
                            route=route, latitude=pt[0], longitude=pt[1], sequence=seq)
        except Exception:
            pass

        return Response(result, status=status.HTTP_200_OK)


class RecalculateRouteView(APIView):
    """
    Live rerouting endpoint with snap-to-road support.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = request.data
        try:
            user_lat = float(data.get('user_lat'))
            user_lng = float(data.get('user_lng'))
            end_lat  = float(data.get('end_lat'))
            end_lng  = float(data.get('end_lng'))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid coordinates.'}, status=status.HTTP_400_BAD_REQUEST)

        end_name = data.get('end_name', f'{end_lat:.4f},{end_lng:.4f}')

        # Snap coordinates to road segments
        snap_user_lat, snap_user_lng, start_node_id, geom_to_start = snap_to_road_graph(user_lat, user_lng)
        snap_end_lat, snap_end_lng, end_node_id, geom_to_end = snap_to_road_graph(end_lat, end_lng)

        if not start_node_id or not end_node_id:
            return Response({'error': 'No nearby nodes found.'}, status=status.HTTP_404_NOT_FOUND)

        dist_to_start = 0.0
        for i in range(len(geom_to_start) - 1):
            dist_to_start += haversine_distance(geom_to_start[i][0], geom_to_start[i][1], geom_to_start[i+1][0], geom_to_start[i+1][1])

        dist_to_end = 0.0
        for i in range(len(geom_to_end) - 1):
            dist_to_end += haversine_distance(geom_to_end[i][0], geom_to_end[i][1], geom_to_end[i+1][0], geom_to_end[i+1][1])

        if start_node_id == end_node_id:
            distance = haversine_distance(snap_user_lat, snap_user_lng, snap_end_lat, snap_end_lng)
            clean_geom = [[user_lat, user_lng], [snap_user_lat, snap_user_lng], [snap_end_lat, snap_end_lng]]
            return Response({
                'geometry':    clean_geom,
                'distance_m':  round(distance, 2),
                'distance_km': round(distance / 1000, 3),
                'duration_s':  round(distance / 1.2, 1),
                'end_name':    end_name,
            }, status=status.HTTP_200_OK)

        nodes_dict, graph = build_graph()
        a_path, a_geom, a_dist, _, _ = run_a_star(graph, nodes_dict, start_node_id, end_node_id)

        if not a_path:
            return Response({'error': 'No path found.'}, status=status.HTTP_404_NOT_FOUND)

        geom_from_end = list(reversed(geom_to_end))
        full_a_geom = geom_to_start + a_geom + geom_from_end
        full_a_dist = dist_to_start + a_dist + dist_to_end

        clean_geom = []
        for pt in full_a_geom:
            if not clean_geom or pt != clean_geom[-1]:
                clean_geom.append(pt)
        if clean_geom and (clean_geom[0][0] != user_lat or clean_geom[0][1] != user_lng):
            clean_geom = [[user_lat, user_lng]] + clean_geom

        return Response({
            'geometry':    clean_geom,
            'distance_m':  round(full_a_dist, 2),
            'distance_km': round(full_a_dist / 1000, 3),
            'duration_s':  round(full_a_dist / 1.2, 1),
            'end_name':    end_name,
        }, status=status.HTTP_200_OK)
