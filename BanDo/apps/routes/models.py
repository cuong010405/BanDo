from django.db import models
from django.conf import settings

class Route(models.Model):
    ALGORITHM_CHOICES = (
        ('dijkstra', 'Dijkstra'),
        ('a_star', 'A* (A-Star)'),
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="routes",
        verbose_name="Người dùng"
    )
    start_name = models.CharField(max_length=255, verbose_name="Điểm xuất phát")
    end_name = models.CharField(max_length=255, verbose_name="Điểm đến")
    start_latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ xuất phát")
    start_longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ xuất phát")
    end_latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ đích")
    end_longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ đích")
    distance = models.FloatField(verbose_name="Tổng khoảng cách (m)")
    duration = models.FloatField(verbose_name="Tổng thời gian (s)")
    algorithm = models.CharField(max_length=20, choices=ALGORITHM_CHOICES, default='dijkstra', verbose_name="Thuật toán")
    geometry = models.JSONField(default=list, blank=True, verbose_name="Danh sách toạ độ vẽ")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Tuyến đường lưu trữ"
        verbose_name_plural = "Tuyến đường lưu trữ"
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.start_name} -> {self.end_name} ({self.distance:.1f}m - {self.get_algorithm_display()})"

class RoutePoint(models.Model):
    route = models.ForeignKey(Route, on_delete=models.CASCADE, related_name="route_points", verbose_name="Tuyến đường")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ")
    longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ")
    sequence = models.PositiveIntegerField(verbose_name="Thứ tự điểm")

    class Meta:
        verbose_name = "Điểm trên tuyến"
        verbose_name_plural = "Các điểm trên tuyến"
        ordering = ['sequence']

    def __str__(self):
        return f"{self.route.id} | #{self.sequence} ({self.latitude:.6f}, {self.longitude:.6f})"
