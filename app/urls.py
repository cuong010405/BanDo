from django.contrib import admin
from django.urls import path
from . import  views
urlpatterns = [
    path('', views.GiaoDienChinh, name='GiaoDienChinh'),
    path('api/contact', views.api_contact, name='api_contact'),
]