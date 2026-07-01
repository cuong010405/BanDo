from django.db import models
from django.conf import settings

class Notification(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name="notifications",
        verbose_name="Người nhận (Trống nếu gửi tất cả)"
    )
    title = models.CharField(max_length=255, verbose_name="Tiêu đề")
    message = models.TextField(verbose_name="Nội dung thông báo")
    is_read = models.BooleanField(default=False, verbose_name="Đã đọc")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Thông báo"
        verbose_name_plural = "Thông báo"

    def __str__(self):
        dest = self.user.username if self.user else "Tất cả mọi người"
        status = "Đã đọc" if self.is_read else "Chưa đọc"
        return f"{self.title} -> {dest} ({status})"
