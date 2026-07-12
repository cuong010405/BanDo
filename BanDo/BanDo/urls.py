"""
URL configuration for BanDo project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic.base import RedirectView
from rest_framework import routers
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.accounts.views import RegisterView, UserProfileView, UserViewSet
from apps.locations.views import CategoryViewSet, LocationViewSet, RouteNodeViewSet, RouteEdgeViewSet
from apps.routes.views import RouteViewSet, CalculateRouteView, RecalculateRouteView
from apps.history.views import SearchHistoryViewSet, GPSHistoryViewSet
from apps.feedback.views import FeedbackViewSet, ReportViewSet
from apps.notifications.views import NotificationViewSet

# API Router
router = routers.DefaultRouter()
router.register(r'users', UserViewSet, basename='user')
router.register(r'categories', CategoryViewSet, basename='category')
router.register(r'locations', LocationViewSet, basename='location')
router.register(r'route-nodes', RouteNodeViewSet, basename='route-node')
router.register(r'route-edges', RouteEdgeViewSet, basename='route-edge')
router.register(r'routes', RouteViewSet, basename='route')
router.register(r'history/search', SearchHistoryViewSet, basename='history-search')
router.register(r'history/gps', GPSHistoryViewSet, basename='history-gps')
router.register(r'feedbacks', FeedbackViewSet, basename='feedback')
router.register(r'reports', ReportViewSet, basename='report')
router.register(r'notifications', NotificationViewSet, basename='notification')

urlpatterns = [
    # Favicon redirect
    path('favicon.ico', RedirectView.as_view(url='/static/favicon.ico')),
    
    # Standard admin
    path('admin/', admin.site.urls),
    
    # Custom Dashboard URLs (server-rendered templates)
    path('dashboard/', include('dashboard.urls')),
    
    # Client main views (served by dashboard or main views)
    path('', include('dashboard.client_urls')),

    # DRF API Router URLs
    path('api/', include(router.urls)),
    
    # JWT & Custom Authentication REST endpoints
    path('api/auth/register', RegisterView.as_view(), name='auth-register'),
    path('api/auth/login', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('api/auth/refresh', TokenRefreshView.as_view(), name='token_refresh'),
    path('api/auth/profile', UserProfileView.as_view(), name='auth-profile'),
    
    # Pathfinding API endpoints
    path('api/routes/calculate', CalculateRouteView.as_view(), name='api-route-calculate'),
    path('api/routes/recalculate', RecalculateRouteView.as_view(), name='api-route-recalculate'),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

