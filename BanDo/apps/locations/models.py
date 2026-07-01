from django.db import models

class Category(models.Model):
    name = models.CharField(max_length=100, unique=True, verbose_name="Tên danh mục")
    slug = models.SlugField(max_length=100, unique=True, verbose_name="Slug")
    icon = models.CharField(max_length=50, default="fa-location-dot", verbose_name="Icon FontAwesome")
    description = models.TextField(blank=True, null=True, verbose_name="Mô tả")

    class Meta:
        verbose_name = "Danh mục địa điểm"
        verbose_name_plural = "Danh mục địa điểm"

    def __str__(self):
        return self.name

class Location(models.Model):
    name = models.CharField(max_length=255, verbose_name="Tên địa điểm")
    category = models.ForeignKey(Category, on_delete=models.CASCADE, related_name="locations", verbose_name="Danh mục")
    address = models.CharField(max_length=500, blank=True, null=True, verbose_name="Địa chỉ")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ")
    longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ")
    description = models.TextField(blank=True, null=True, verbose_name="Mô tả")
    image = models.ImageField(upload_to="locations/", blank=True, null=True, verbose_name="Hình ảnh")
    is_active = models.BooleanField(default=True, verbose_name="Hoạt động")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Địa điểm"
        verbose_name_plural = "Địa điểm"
        indexes = [
            models.Index(fields=['latitude', 'longitude']),
            models.Index(fields=['category']),
        ]

    def __str__(self):
        return self.name

class RouteNode(models.Model):
    latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ")
    longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ")
    name = models.CharField(max_length=255, blank=True, null=True, verbose_name="Tên nút (nếu có)")

    class Meta:
        verbose_name = "Nút đồ thị"
        verbose_name_plural = "Các nút đồ thị"
        indexes = [
            models.Index(fields=['latitude', 'longitude']),
        ]

    def __str__(self):
        return self.name or f"Nút ({self.latitude:.6f}, {self.longitude:.6f})"

class RouteEdge(models.Model):
    node_a = models.ForeignKey(RouteNode, on_delete=models.CASCADE, related_name="edges_from", verbose_name="Nút xuất phát")
    node_b = models.ForeignKey(RouteNode, on_delete=models.CASCADE, related_name="edges_to", verbose_name="Nút đích")
    distance = models.FloatField(verbose_name="Khoảng cách (mét)")
    # points: list of lists representing path segments [[lat1, lng1], [lat2, lng2], ...]
    points = models.JSONField(default=list, blank=True, verbose_name="Đoạn đường chi tiết")
    is_active = models.BooleanField(default=True, verbose_name="Hoạt động")

    class Meta:
        verbose_name = "Cạnh đồ thị"
        verbose_name_plural = "Các cạnh đồ thị"
        unique_together = ('node_a', 'node_b')

    def __str__(self):
        return f"{self.node_a} <-> {self.node_b} ({self.distance:.1f}m)"
