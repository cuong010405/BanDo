from rest_framework import serializers
from routes.models import Route, RoutePoint

class RoutePointSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoutePoint
        fields = ('latitude', 'longitude', 'sequence')

class RouteSerializer(serializers.ModelSerializer):
    route_points = RoutePointSerializer(many=True, read_only=True)

    class Meta:
        model = Route
        fields = (
            'id', 'user', 'start_name', 'end_name', 
            'start_latitude', 'start_longitude', 'end_latitude', 'end_longitude', 
            'distance', 'duration', 'algorithm', 'geometry', 'route_points', 'created_at'
        )
        read_only_fields = ('id', 'user', 'created_at')
