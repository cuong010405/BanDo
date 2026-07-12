from rest_framework import viewsets, permissions, status
from rest_framework.views import APIView
from rest_framework.response import Response
from routes.models import Route, RoutePoint
from routes.serializers import RouteSerializer
from routes.pathfinder import (
    find_nearest_node, build_graph,
    run_dijkstra, run_a_star,
    generate_text_diagram, haversine_distance,
    compute_remaining_distance
)
from history.models import SearchHistory


class RouteViewSet(viewsets.ReadOnlyModelViewSet):
    """List and retrieve saved routes."""
    serializer_class = RouteSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Route.objects.filter(user=self.request.user).select_related('user')


def _build_result(label, path, geometry, distance, visited, exec_time, nodes_dict,
                  start_lat, start_lng, end_lat, end_lng):
    """
    Chuẩn hóa kết quả một lần chạy thuật toán.
    geometry đã bao gồm toàn bộ waypoints từ edge.points (reconstruct trong pathfinder).
    Prepend [start_user] và append [end_user] để polyline khớp marker người dùng.
    """
    # Nối tọa độ thực của user vào đầu và cuối
    full_geom = [[start_lat, start_lng]] + (geometry or []) + [[end_lat, end_lng]]

    # Loại bỏ điểm trùng liên tiếp (so sánh epsilon nhỏ để tránh float rounding)
    def _approx_eq(a, b, eps=1e-9):
        return abs(a[0] - b[0]) < eps and abs(a[1] - b[1]) < eps

    clean = []
    for pt in full_geom:
        if not clean or not _approx_eq(pt, clean[-1]):
            clean.append(pt)

    return {
        'algorithm': label,
        'complexity': 'O((V+E)logV)' if 'Dijkstra' in label else 'O(E logV) with heuristic',
        'path_nodes': path,
        'geometry': clean,
        'distance_m': round(distance, 2),
        'distance_km': round(distance / 1000, 3),
        'duration_s': round(distance / 1.2, 1),
        'visited_nodes': visited,
        'exec_time_ms': round(exec_time, 4),
        'text_diagram': generate_text_diagram(path, nodes_dict),
        'path_names': [nodes_dict[n][2] for n in path if n in nodes_dict],
    }


class CalculateRouteView(APIView):
    """
    API tính đường ngắn nhất giữa 2 điểm.
    Dùng Dijkstra (chuẩn) hoặc A* hoặc cả hai.
    Geometry = tọa độ của các node trên path → polyline sạch, liên tục, không đứt.
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
            return Response({'error': 'Tọa độ không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        algorithm  = data.get('algorithm', 'both')
        start_name = data.get('start_name', f'{start_lat:.4f},{start_lng:.4f}')
        end_name   = data.get('end_name',   f'{end_lat:.4f},{end_lng:.4f}')

        # 1. Tìm node gần nhất với điểm bắt đầu và kết thúc
        start_node = find_nearest_node(start_lat, start_lng)
        end_node   = find_nearest_node(end_lat, end_lng)

        if not start_node or not end_node:
            return Response(
                {'error': 'Không tìm thấy node nào trong bản đồ. Vui lòng thêm dữ liệu node/edge.'},
                status=status.HTTP_404_NOT_FOUND
            )

        # 2. Nếu 2 điểm cùng node → đường thẳng trực tiếp
        if start_node.id == end_node.id:
            distance = haversine_distance(start_lat, start_lng, end_lat, end_lng)
            direct = {
                'algorithm': 'Dijkstra',
                'complexity': 'O((V+E)logV)',
                'path_nodes': [start_node.id],
                'geometry': [[start_lat, start_lng], [end_lat, end_lng]],
                'distance_m': round(distance, 2),
                'distance_km': round(distance / 1000, 3),
                'duration_s': round(distance / 1.2, 1),
                'visited_nodes': 1,
                'exec_time_ms': 0.0,
                'text_diagram': f'[{start_node.name or "Start"}] ➔ [Đích]',
                'path_names': [start_node.name or 'Start'],
            }
            return Response({
                'start': {'lat': start_lat, 'lng': start_lng, 'name': start_name, 'nearest_node': start_node.id},
                'end':   {'lat': end_lat,   'lng': end_lng,   'name': end_name,   'nearest_node': end_node.id},
                'graph_size': {'nodes': 1, 'edges': 0},
                'primary': direct, 'dijkstra': direct, 'a_star': direct,
            }, status=status.HTTP_200_OK)

        # 3. Xây graph
        nodes_dict, graph = build_graph()

        if start_node.id not in nodes_dict or end_node.id not in nodes_dict:
            return Response(
                {'error': 'Node không tồn tại trong graph.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

        result = {
            'start': {'lat': start_lat, 'lng': start_lng, 'name': start_name, 'nearest_node': start_node.id},
            'end':   {'lat': end_lat,   'lng': end_lng,   'name': end_name,   'nearest_node': end_node.id},
            'graph_size': {
                'nodes': len(nodes_dict),
                'edges': sum(len(v) for v in graph.values()) // 2,
            },
        }

        dijkstra_result = None
        a_star_result   = None

        # 4. Chạy Dijkstra
        if algorithm in ('dijkstra', 'both'):
            d_path, d_geom, d_dist, d_visited, d_time = run_dijkstra(
                graph, nodes_dict, start_node.id, end_node.id
            )
            if d_path:
                dijkstra_result = _build_result(
                    'Dijkstra', d_path, d_geom, d_dist, d_visited, d_time,
                    nodes_dict, start_lat, start_lng, end_lat, end_lng
                )

        # 5. Chạy A*
        if algorithm in ('a_star', 'both'):
            a_path, a_geom, a_dist, a_visited, a_time = run_a_star(
                graph, nodes_dict, start_node.id, end_node.id
            )
            if a_path:
                a_star_result = _build_result(
                    'A* (A-Star)', a_path, a_geom, a_dist, a_visited, a_time,
                    nodes_dict, start_lat, start_lng, end_lat, end_lng
                )

        # Dijkstra là primary (đảm bảo tối ưu), fallback sang A*
        primary = dijkstra_result or a_star_result
        if not primary:
            return Response(
                {'error': 'Không tìm thấy đường đi.'},
                status=status.HTTP_404_NOT_FOUND
            )

        result['dijkstra'] = dijkstra_result
        result['a_star']   = a_star_result
        result['primary']  = primary

        # So sánh 2 thuật toán
        if dijkstra_result and a_star_result:
            result['comparison'] = {
                'dijkstra_visited':  dijkstra_result['visited_nodes'],
                'a_star_visited':    a_star_result['visited_nodes'],
                'dijkstra_time_ms':  dijkstra_result['exec_time_ms'],
                'a_star_time_ms':    a_star_result['exec_time_ms'],
                'efficiency_gain':   round(
                    (1 - a_star_result['visited_nodes'] / max(dijkstra_result['visited_nodes'], 1)) * 100, 1
                ),
                'same_distance': abs(dijkstra_result['distance_m'] - a_star_result['distance_m']) < 0.1,
            }

        # Lưu lịch sử tìm kiếm
        try:
            user = request.user if request.user.is_authenticated else None
            SearchHistory.objects.create(
                user=user, query=f"{start_name} -> {end_name}",
                latitude=start_lat, longitude=start_lng
            )
        except Exception:
            pass

        # Lưu route (nếu đã đăng nhập)
        try:
            if request.user.is_authenticated:
                route = Route.objects.create(
                    user=request.user,
                    start_name=start_name[:255], end_name=end_name[:255],
                    start_latitude=start_lat, start_longitude=start_lng,
                    end_latitude=end_lat, end_longitude=end_lng,
                    distance=primary['distance_m'], duration=primary['duration_s'],
                    algorithm='dijkstra' if dijkstra_result else 'a_star',
                    geometry=primary['geometry']
                )
                for seq, pt in enumerate(primary['geometry']):
                    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
                        RoutePoint.objects.create(
                            route=route, latitude=pt[0], longitude=pt[1], sequence=seq
                        )
        except Exception:
            pass

        return Response(result, status=status.HTTP_200_OK)


class RecalculateRouteView(APIView):
    """
    Live rerouting: tính lại đường từ vị trí hiện tại người dùng đến đích.
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
            return Response({'error': 'Tọa độ không hợp lệ.'}, status=status.HTTP_400_BAD_REQUEST)

        end_name = data.get('end_name', f'{end_lat:.4f},{end_lng:.4f}')

        start_node = find_nearest_node(user_lat, user_lng)
        end_node   = find_nearest_node(end_lat, end_lng)

        if not start_node or not end_node:
            return Response({'error': 'Không tìm thấy node gần đó.'}, status=status.HTTP_404_NOT_FOUND)

        if start_node.id == end_node.id:
            distance = haversine_distance(user_lat, user_lng, end_lat, end_lng)
            return Response({
                'geometry':    [[user_lat, user_lng], [end_lat, end_lng]],
                'distance_m':  round(distance, 2),
                'distance_km': round(distance / 1000, 3),
                'duration_s':  round(distance / 1.2, 1),
                'end_name':    end_name,
            }, status=status.HTTP_200_OK)

        nodes_dict, graph = build_graph()

        d_path, d_geom, d_dist, _, _ = run_dijkstra(graph, nodes_dict, start_node.id, end_node.id)

        if not d_path:
            return Response({'error': 'Không tìm thấy đường đi.'}, status=status.HTTP_404_NOT_FOUND)

        # Thêm tọa độ người dùng và đích thực vào geometry
        full_geom = [[user_lat, user_lng]] + d_geom + [[end_lat, end_lng]]
        clean = []
        for pt in full_geom:
            if not clean or pt != clean[-1]:
                clean.append(pt)

        return Response({
            'geometry':    clean,
            'distance_m':  round(d_dist, 2),
            'distance_km': round(d_dist / 1000, 3),
            'duration_s':  round(d_dist / 1.2, 1),
            'end_name':    end_name,
        }, status=status.HTTP_200_OK)


