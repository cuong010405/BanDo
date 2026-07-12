from django.db import models
from django.contrib.auth.models import AbstractUser

class User(AbstractUser):
    ROLE_CHOICES = (
        ('admin', 'Admin'),
        ('staff', 'Nhân viên'),
        ('user', 'Người dùng'),
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='user')
    phone = models.CharField(max_length=15, blank=True, null=True)
    avatar = models.ImageField(upload_to='avatars/', blank=True, null=True)

    class Meta:
        ordering = ['username']

    @property
    def is_admin(self):
        return self.role == 'admin' or self.is_superuser

    @property
    def is_staff_member(self):
        return self.role in ['admin', 'staff'] or self.is_staff

    def __str__(self):
        return f"{self.username} ({self.get_role_display()})"
