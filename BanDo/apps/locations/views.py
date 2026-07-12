from rest_framework import viewsets, permissions, filters
from locations.models import Category, Location, RouteNode, RouteEdge
from locations.serializers import CategorySerializer, LocationSerializer, RouteNodeSerializer, RouteEdgeSerializer
from routes.pathfinder import haversine_distance

class CategoryViewSet(viewsets.ModelViewSet):
    queryset = Category.objects.all()
    serializer_class = CategorySerializer
    permission_classes = [permissions.AllowAny]
    lookup_field = 'id'

class LocationViewSet(viewsets.ModelViewSet):
    queryset = Location.objects.all().select_related('category')
    serializer_class = LocationSerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        queryset = self.queryset
        # Custom filtering
        category_id = self.request.query_params.get('category')
        if category_id:
            queryset = queryset.filter(category_id=category_id)
            
        search_query = self.request.query_params.get('q')
        if search_query:
            queryset = queryset.filter(name__icontains=search_query) | queryset.filter(address__icontains=search_query)
            
        active_only = self.request.query_params.get('active')
        if active_only == 'true':
            queryset = queryset.filter(is_active=True)
            
        return queryset

class RouteNodeViewSet(viewsets.ModelViewSet):
    queryset = RouteNode.objects.all()
    serializer_class = RouteNodeSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def partial_update(self, request, *args, **kwargs):
        instance = self.get_object()
        old_lat = float(instance.latitude)
        old_lng = float(instance.longitude)

        response = super().partial_update(request, *args, **kwargs)

        if response.status_code == 200:
            new_lat = float(instance.latitude)
            new_lng = float(instance.longitude)

            if old_lat != new_lat or old_lng != new_lng:
                related_edges = RouteEdge.objects.filter(
                    models.Q(node_a=instance) | models.Q(node_b=instance)
                )
                for edge in related_edges:
                    pts = edge.points or []
                    if len(pts) >= 2:
                        new_pts = []
                        for p in pts:
                            if abs(p[0] - old_lat) < 1e-6 and abs(p[1] - old_lng) < 1e-6:
                                new_pts.append([new_lat, new_lng])
                            else:
                                new_pts.append(p)
                        edge.points = new_pts
                        edge.distance = haversine_distance(
                            float(edge.node_a.latitude), float(edge.node_a.longitude),
                            float(edge.node_b.latitude), float(edge.node_b.longitude)
                        )
                        edge.save(update_fields=['points', 'distance'])

        return response

from django.db import models
from rest_framework import status
from rest_framework.response import Response

class RouteEdgeViewSet(viewsets.ModelViewSet):
    queryset = RouteEdge.objects.all().select_related('node_a', 'node_b')
    serializer_class = RouteEdgeSerializer
    permission_classes = [permissions.AllowAny]
    pagination_class = None

    def create(self, request, *args, **kwargs):
        # Create primary edge
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        self.perform_create(serializer)
        headers = self.get_success_headers(serializer.data)
        
        # Create reverse edge bidirectionally
        node_a_id = serializer.validated_data['node_a'].id
        node_b_id = serializer.validated_data['node_b'].id
        distance = serializer.validated_data['distance']
        points = serializer.validated_data.get('points', [])
        
        rev_points = list(reversed(points)) if points else []
        
        RouteEdge.objects.get_or_create(
            node_a_id=node_b_id,
            node_b_id=node_a_id,
            defaults={
                'distance': distance,
                'points': rev_points,
                'is_active': True
            }
        )
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        node_a_id = instance.node_a_id
        node_b_id = instance.node_b_id
        
        # Delete both directions
        RouteEdge.objects.filter(
            (models.Q(node_a_id=node_a_id) & models.Q(node_b_id=node_b_id)) |
            (models.Q(node_a_id=node_b_id) & models.Q(node_b_id=node_a_id))
        ).delete()
        
        return Response(status=status.HTTP_204_NO_CONTENT)
