from rest_framework import serializers
from history.models import SearchHistory, GPSHistory

class SearchHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = SearchHistory
        fields = '__all__'
        read_only_fields = ('id', 'user', 'created_at')

class GPSHistorySerializer(serializers.ModelSerializer):
    class Meta:
        model = GPSHistory
        fields = '__all__'
        read_only_fields = ('id', 'user', 'created_at')
