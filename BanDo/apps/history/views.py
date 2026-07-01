from rest_framework import viewsets, permissions
from history.models import SearchHistory, GPSHistory
from history.serializers import SearchHistorySerializer, GPSHistorySerializer

class SearchHistoryViewSet(viewsets.ModelViewSet):
    queryset = SearchHistory.objects.all()
    serializer_class = SearchHistorySerializer
    permission_classes = [permissions.AllowAny]

    def get_queryset(self):
        if self.request.user.is_authenticated:
            return SearchHistory.objects.filter(user=self.request.user)
        return SearchHistory.objects.filter(user__isnull=True)

    def perform_create(self, serializer):
        user = self.request.user if self.request.user.is_authenticated else None
        serializer.save(user=user)

class GPSHistoryViewSet(viewsets.ModelViewSet):
    queryset = GPSHistory.objects.all()
    serializer_class = GPSHistorySerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return GPSHistory.objects.filter(user=self.request.user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)
