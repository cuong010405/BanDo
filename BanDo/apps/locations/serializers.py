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

class RouteEdgeSerializer(serializers.ModelSerializer):
    node_a_info = RouteNodeSerializer(source='node_a', read_only=True)
    node_b_info = RouteNodeSerializer(source='node_b', read_only=True)

    class Meta:
        model = RouteEdge
        fields = ('id', 'node_a', 'node_a_info', 'node_b', 'node_b_info', 'distance', 'points', 'is_active')
