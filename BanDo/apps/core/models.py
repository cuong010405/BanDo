from django.db import models
from django.conf import settings

class AuditLog(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='audit_logs'
    )
    action = models.CharField(max_length=255)
    ip_address = models.CharField(max_length=45, blank=True, null=True)
    path = models.CharField(max_length=1000, blank=True, null=True)
    method = models.CharField(max_length=10, blank=True, null=True)
    response_code = models.IntegerField(blank=True, null=True)
    execution_time = models.FloatField(help_text="Execution time in seconds", default=0.0)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['created_at']),
            models.Index(fields=['user']),
        ]

    def __str__(self):
        user_str = self.user.username if self.user else "Vãng lai"
        return f"{user_str} | {self.method} {self.path} | status: {self.response_code} | {self.execution_time:.3f}s"
