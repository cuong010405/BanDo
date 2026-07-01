from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from routes.models import Route, RoutePoint
from routes.serializers import RouteSerializer
from routes.pathfinder import (
    find_nearest_node, build_graph,
    run_dijkstra, run_a_star,
    generate_text_diagram, haversine_distance
)
from history.models import SearchHistory


class RouteViewSet(viewsets.ReadOnlyModelViewSet):
    """List and retrieve saved routes."""
    serializer_class = RouteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Route.objects.filter(user=self.request.user).select_related('user')


class CalculateRouteView(APIView):
    """
    Core pathfinding API endpoint.
    Accepts start/end lat-lng, runs Dijkstra and A* on the campus graph,
    returns paths, metrics, and algorithm comparison.
    """
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        data = request.data
        try:
            start_lat = float(data.get('start_lat'))
            start_lng = float(data.get('start_lng'))
            end_lat = float(data.get('end_lat'))
            end_lng = float(data.get('end_lng'))
        except (TypeError, ValueError):
            return Response({'error': 'Invalid coordinates.'}, status=status.HTTP_400_BAD_REQUEST)

        algorithm = data.get('algorithm', 'both')  # 'dijkstra', 'a_star', or 'both'
        start_name = data.get('start_name', f'{start_lat:.4f},{start_lng:.4f}')
        end_name = data.get('end_name', f'{end_lat:.4f},{end_lng:.4f}')

        # Find nearest nodes to start and end
        start_node = find_nearest_node(start_lat, start_lng)
        end_node = find_nearest_node(end_lat, end_lng)

        if not start_node or not end_node:
            return Response({'error': 'Could not find nearby graph nodes. Please add RouteNodes to the map.'}, status=status.HTTP_404_NOT_FOUND)

        if start_node.id == end_node.id:
            return Response({'error': 'Start and end are the same location.'}, status=status.HTTP_400_BAD_REQUEST)

        # Build graph once
        nodes_dict, graph = build_graph()

        if start_node.id not in nodes_dict or end_node.id not in nodes_dict:
            return Response({'error': 'Node not found in graph.'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        result = {
            'start': {'lat': start_lat, 'lng': start_lng, 'name': start_name, 'nearest_node': start_node.id},
            'end': {'lat': end_lat, 'lng': end_lng, 'name': end_name, 'nearest_node': end_node.id},
            'graph_size': {'nodes': len(nodes_dict), 'edges': sum(len(v) for v in graph.values()) // 2},
        }

        dijkstra_result = None
        a_star_result = None

        # Run Dijkstra
        if algorithm in ('dijkstra', 'both'):
            d_path, d_geom, d_dist, d_visited, d_time = run_dijkstra(graph, start_node.id, end_node.id)
            if d_path:
                dijkstra_result = {
                    'algorithm': 'Dijkstra',
                    'complexity': 'O((V + E) log V)',
                    'path_nodes': d_path,
                    'geometry': d_geom,
                    'distance_m': round(d_dist, 2),
                    'distance_km': round(d_dist / 1000, 3),
                    'duration_s': round(d_dist / 1.2, 1),  # Walking ~1.2 m/s
                    'visited_nodes': d_visited,
                    'exec_time_ms': round(d_time, 4),
                    'text_diagram': generate_text_diagram(d_path, nodes_dict),
                    'path_names': [nodes_dict[n][2] for n in d_path],
                }

        # Run A*
        if algorithm in ('a_star', 'both'):
            a_path, a_geom, a_dist, a_visited, a_time = run_a_star(graph, nodes_dict, start_node.id, end_node.id)
            if a_path:
                a_star_result = {
                    'algorithm': 'A* (A-Star)',
                    'complexity': 'O(E log V) with heuristic',
                    'path_nodes': a_path,
                    'geometry': a_geom,
                    'distance_m': round(a_dist, 2),
                    'distance_km': round(a_dist / 1000, 3),
                    'duration_s': round(a_dist / 1.2, 1),
                    'visited_nodes': a_visited,
                    'exec_time_ms': round(a_time, 4),
                    'text_diagram': generate_text_diagram(a_path, nodes_dict),
                    'path_names': [nodes_dict[n][2] for n in a_path],
                }

        # Use Dijkstra as primary result if both run; fall back to A*
        primary = dijkstra_result or a_star_result
        if not primary:
            return Response({'error': 'No path found between these two locations.'}, status=status.HTTP_404_NOT_FOUND)

        result['dijkstra'] = dijkstra_result
        result['a_star'] = a_star_result
        result['primary'] = primary

        # Algorithm comparison table (only if both were run)
        if dijkstra_result and a_star_result:
            result['comparison'] = {
                'dijkstra_visited': dijkstra_result['visited_nodes'],
                'a_star_visited': a_star_result['visited_nodes'],
                'dijkstra_time_ms': dijkstra_result['exec_time_ms'],
                'a_star_time_ms': a_star_result['exec_time_ms'],
                'efficiency_gain': round(
                    (1 - a_star_result['visited_nodes'] / max(dijkstra_result['visited_nodes'], 1)) * 100, 1
                ),
                'same_distance': abs(dijkstra_result['distance_m'] - a_star_result['distance_m']) < 0.1,
            }

        # Save to SearchHistory (non-blocking)
        try:
            user = request.user if request.user.is_authenticated else None
            SearchHistory.objects.create(
                user=user,
                query=f"{start_name} -> {end_name}",
                latitude=start_lat,
                longitude=start_lng
            )
        except Exception:
            pass

        # Save route to DB (non-blocking)
        try:
            if request.user.is_authenticated:
                route = Route.objects.create(
                    user=request.user,
                    start_name=start_name[:255],
                    end_name=end_name[:255],
                    start_latitude=start_lat,
                    start_longitude=start_lng,
                    end_latitude=end_lat,
                    end_longitude=end_lng,
                    distance=primary['distance_m'],
                    duration=primary['duration_s'],
                    algorithm='dijkstra' if dijkstra_result else 'a_star',
                    geometry=primary['geometry']
                )
                for seq, pt in enumerate(primary['geometry']):
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        RoutePoint.objects.create(
                            route=route,
                            latitude=pt[0],
                            longitude=pt[1],
                            sequence=seq
                        )
        except Exception:
            pass

        return Response(result, status=status.HTTP_200_OK)
