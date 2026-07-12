from rest_framework import serializers
from locations.models import Category, Location, RouteNode, RouteEdge

class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = '__all__'

class LocationSerializer(serializers.ModelSerializer):
    category_info = CategorySerializer(source='category', read_only=True)

    class Meta:
        model = Location
        fields = ('id', 'name', 'category', 'category_info', 'address', 'latitude', 'longitude', 'description', 'image', 'is_active', 'created_at', 'updated_at')

class RouteNodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RouteNode
        fields = '__all__'

    def validate(self, attrs):
        latitude = attrs.get('latitude')
        longitude = attrs.get('longitude')
        if latitude is not None and longitude is not None:
            from routes.pathfinder import point_in_polygon, BUILDING_POLYGONS, is_point_in_campus
            lat_f = float(latitude)
            lng_f = float(longitude)
            if not is_point_in_campus(lat_f, lng_f):
                raise serializers.ValidationError("Nút phải nằm trong khuôn viên trường (Campus).")
            for poly in BUILDING_POLYGONS:
                if point_in_polygon(lat_f, lng_f, poly):
                    raise serializers.ValidationError("Nút không thể nằm trong tòa nhà")
        return attrs

class RouteEdgeSerializer(serializers.ModelSerializer):
    node_a_info = RouteNodeSerializer(source='node_a', read_only=True)
    node_b_info = RouteNodeSerializer(source='node_b', read_only=True)

    class Meta:
        model = RouteEdge
        fields = ('id', 'node_a', 'node_a_info', 'node_b', 'node_b_info', 'distance', 'points', 'is_active')

    def validate(self, attrs):
        node_a = attrs.get('node_a')
        node_b = attrs.get('node_b')
        if node_a and node_b:
            from routes.pathfinder import is_edge_valid
            lat_a, lng_a = float(node_a.latitude), float(node_a.longitude)
            lat_b, lng_b = float(node_b.latitude), float(node_b.longitude)
            if not is_edge_valid(lat_a, lng_a, lat_b, lng_b):
                raise serializers.ValidationError("Không thể tạo cạnh vì cạnh đi xuyên qua tòa nhà hoặc vượt ra ngoài khuôn viên trường.")
        return attrs

