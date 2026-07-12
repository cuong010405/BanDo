from django.db import models
from django.conf import settings

class Feedback(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="feedbacks",
        verbose_name="Người dùng"
    )
    subject = models.CharField(max_length=255, verbose_name="Tiêu đề")
    message = models.TextField(verbose_name="Nội dung")
    rating = models.PositiveIntegerField(default=5, verbose_name="Đánh giá (1-5 sao)")
    response = models.TextField(blank=True, null=True, verbose_name="Phản hồi từ Admin")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Ý kiến phản hồi"
        verbose_name_plural = "Ý kiến phản hồi"

    def __str__(self):
        return f"{self.user.username} - {self.subject[:30]} ({self.rating}★)"

class Report(models.Model):
    title = models.CharField(max_length=255, verbose_name="Tiêu đề báo cáo")
    participants_count = models.IntegerField(default=30, verbose_name="Số người tham gia thử nghiệm (UAT)")
    completion_rate = models.FloatField(default=95.0, verbose_name="Tỷ lệ hoàn thành tác vụ (%)")
    satisfaction_rate = models.FloatField(default=93.0, verbose_name="Tỷ lệ hài lòng (%)")
    avg_gps_error = models.FloatField(default=4.2, verbose_name="Sai số GPS trung bình (mét)")
    avg_api_response_ms = models.FloatField(default=120.0, verbose_name="Phản hồi API trung bình (ms)")
    routing_success_rate = models.FloatField(default=98.5, verbose_name="Tỷ lệ tìm đường thành công (%)")
    avg_page_load_seconds = models.FloatField(default=1.1, verbose_name="Thời gian tải trang trung bình (s)")
    description = models.TextField(blank=True, null=True, verbose_name="Chi tiết & Phân tích")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        verbose_name = "Báo cáo thử nghiệm (UAT)"
        verbose_name_plural = "Báo cáo thử nghiệm (UAT)"

    def __str__(self):
        return self.title
