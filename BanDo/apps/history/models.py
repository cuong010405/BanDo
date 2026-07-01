from django.db import models
from django.conf import settings

class SearchHistory(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="search_histories",
        verbose_name="Người tìm kiếm"
    )
    query = models.CharField(max_length=255, verbose_name="Từ khoá tìm kiếm")
    latitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True, verbose_name="Vĩ độ kết quả")
    longitude = models.DecimalField(max_digits=9, decimal_places=6, blank=True, null=True, verbose_name="Kinh độ kết quả")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Lịch sử tìm kiếm"
        verbose_name_plural = "Lịch sử tìm kiếm"

    def __str__(self):
        user_str = self.user.username if self.user else "Vãng lai"
        return f"{user_str}: '{self.query}' vào lúc {self.created_at}"

class GPSHistory(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="gps_histories",
        verbose_name="Người dùng"
    )
    latitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Vĩ độ")
    longitude = models.DecimalField(max_digits=9, decimal_places=6, verbose_name="Kinh độ")
    accuracy = models.FloatField(verbose_name="Độ chính xác (mét)")
    speed = models.FloatField(blank=True, null=True, verbose_name="Vận tốc (m/s)")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Lịch sử GPS"
        verbose_name_plural = "Lịch sử GPS"
        indexes = [
            models.Index(fields=['user', 'created_at']),
        ]

    def __str__(self):
        return f"{self.user.username} | {self.latitude:.6f}, {self.longitude:.6f} | sai số: {self.accuracy:.1f}m | {self.created_at}"
