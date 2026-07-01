from django.urls import path
from dashboard import views

app_name = 'client'

urlpatterns = [
    path('', views.giao_dien_chinh, name='giao_dien_chinh'),
    path('login/', views.client_login, name='login'),
    path('register/', views.client_register, name='register'),
    path('logout/', views.client_logout, name='logout'),
]
