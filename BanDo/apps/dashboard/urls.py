from django.urls import path
from dashboard import views

app_name = 'dashboard'

urlpatterns = [
    path('', views.overview, name='overview'),
    path('locations/', views.locations, name='locations'),
    path('locations/delete/<int:location_id>/', views.delete_location, name='delete_location'),
    path('users/', views.users, name='users'),
    path('users/toggle/<int:user_id>/', views.toggle_user, name='toggle_user'),
    path('feedbacks/', views.feedbacks, name='feedbacks'),
    path('feedbacks/reply/<int:feedback_id>/', views.reply_feedback, name='reply_feedback'),
    path('routes/', views.routes, name='routes'),
    path('notifications/', views.notifications, name='notifications'),
]
