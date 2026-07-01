from django.shortcuts import render, redirect, get_object_or_404
from django.contrib.auth import login, logout, authenticate
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.db.models import Avg, Count
from django.core.paginator import Paginator
from django.utils.text import slugify

from accounts.models import User
from locations.models import Category, Location, RouteNode, RouteEdge
from routes.models import Route
from history.models import SearchHistory, GPSHistory
from feedback.models import Feedback, Report
from notifications.models import Notification
from core.models import AuditLog

# ================= CLIENT VIEWS =================

def giao_dien_chinh(request):
    """Main client map interface."""
    categories = Category.objects.all()
    locations = Location.objects.filter(is_active=True).select_related('category')
    nodes = RouteNode.objects.all()
    edges = RouteEdge.objects.filter(is_active=True).select_related('node_a', 'node_b')
    
    # Fetch active notifications for authenticated user
    user_notifications = []
    if request.user.is_authenticated:
        from django.db.models import Q
        user_notifications = Notification.objects.filter(
            Q(user=request.user) | Q(user__isnull=True)
        )[:5]

    # Fetch last UAT metrics to display
    uat_report = Report.objects.first()

    context = {
        'categories': categories,
        'locations': locations,
        'nodes': nodes,
        'edges': edges,
        'notifications': user_notifications,
        'uat_report': uat_report,
    }
    return render(request, 'client/main.html', context)


def client_login(request):
    """Handle client session login."""
    if request.user.is_authenticated:
        return redirect('client:giao_dien_chinh')
        
    if request.method == 'POST':
        u = request.POST.get('username')
        p = request.POST.get('password')
        user = authenticate(request, username=u, password=p)
        if user is not None:
            login(request, user)
            messages.success(request, f"Chào mừng trở lại, {user.username}!")
            if user.is_staff_member:
                return redirect('dashboard:overview')
            return redirect('client:giao_dien_chinh')
        else:
            messages.error(request, "Tên đăng nhập hoặc mật khẩu không chính xác.")
            
    return render(request, 'client/login.html')


def client_register(request):
    """Handle client registration."""
    if request.user.is_authenticated:
        return redirect('client:giao_dien_chinh')
        
    if request.method == 'POST':
        u = request.POST.get('username')
        e = request.POST.get('email')
        p = request.POST.get('password')
        phone = request.POST.get('phone')
        fn = request.POST.get('first_name')
        ln = request.POST.get('last_name')
        
        if User.objects.filter(username=u).exists():
            messages.error(request, "Tên đăng nhập đã tồn tại.")
        else:
            user = User.objects.create_user(
                username=u, email=e, password=p, phone=phone,
                first_name=fn, last_name=ln, role='user'
            )
            login(request, user)
            messages.success(request, "Đăng ký tài khoản thành công!")
            return redirect('client:giao_dien_chinh')
            
    return render(request, 'client/register.html')


def client_logout(request):
    """Log out user from current session."""
    logout(request)
    messages.info(request, "Bạn đã đăng xuất khỏi hệ thống.")
    return redirect('client:giao_dien_chinh')


# ================= ADMIN DASHBOARD VIEWS =================

def is_staff_check(user):
    return user.is_authenticated and (user.is_staff or user.role in ['admin', 'staff'])


def overview(request):
    """Dashboard homepage with system overview metrics and charts."""
    if not is_staff_check(request.user):
        messages.error(request, "Bạn không có quyền truy cập trang quản trị.")
        return redirect('client:login')

    # Basic Counts
    total_users = User.objects.count()
    total_locations = Location.objects.count()
    total_feedbacks = Feedback.objects.count()
    total_routes = Route.objects.count()

    # Performance metrics from AuditLog middleware
    avg_latency = AuditLog.objects.aggregate(Avg('execution_time'))['execution_time__avg'] or 0.0
    avg_latency_ms = round(avg_latency * 1000, 1)

    # GPS metrics from GPSHistory
    avg_gps_accuracy = GPSHistory.objects.aggregate(Avg('accuracy'))['accuracy__avg'] or 4.5
    avg_gps_accuracy = round(avg_gps_accuracy, 1)

    # Fetch last UAT Report
    uat_report = Report.objects.first()

    # Recent Audit Log Activity
    recent_activities = AuditLog.objects.select_related('user')[:10]

    # Feedbacks rating count for chart
    rating_data = Feedback.objects.values('rating').annotate(count=Count('id')).order_by('rating')
    ratings = [0] * 5  # Index 0-4 for 1-5 stars
    for item in rating_data:
        r = item['rating']
        if 1 <= r <= 5:
            ratings[r-1] = item['count']

    # Weekly calculated route count
    routes_over_time = Route.objects.extra(select={'day': "date(created_at)"}).values('day').annotate(count=Count('id')).order_by('-day')[:7]

    context = {
        'total_users': total_users,
        'total_locations': total_locations,
        'total_feedbacks': total_feedbacks,
        'total_routes': total_routes,
        'avg_latency_ms': avg_latency_ms,
        'avg_gps_accuracy': avg_gps_accuracy,
        'recent_activities': recent_activities,
        'ratings': ratings,
        'routes_over_time': list(reversed(routes_over_time)),
        'uat_report': uat_report,
    }
    return render(request, 'dashboard/index.html', context)


def locations(request):
    """CRUD interface for Categories and Locations with Leaflet marker edit support."""
    if not is_staff_check(request.user):
        messages.error(request, "Bạn không có quyền truy cập trang quản trị.")
        return redirect('client:login')

    categories = Category.objects.all()

    # Handle Category Creation / Location Creation
    if request.method == 'POST':
        form_type = request.POST.get('form_type')
        
        if form_type == 'category':
            name = request.POST.get('name')
            icon = request.POST.get('icon', 'fa-location-dot')
            desc = request.POST.get('description')
            Category.objects.create(name=name, slug=slugify(name), icon=icon, description=desc)
            messages.success(request, f"Đã thêm danh mục: {name}")
            
        elif form_type == 'location':
            loc_id = request.POST.get('id')
            name = request.POST.get('name')
            cat_id = request.POST.get('category')
            address = request.POST.get('address')
            lat = request.POST.get('latitude')
            lng = request.POST.get('longitude')
            desc = request.POST.get('description')
            img = request.FILES.get('image')
            active = request.POST.get('is_active') == 'on'

            category = get_object_or_404(Category, id=cat_id)

            if loc_id: # Edit
                location = get_object_or_404(Location, id=loc_id)
                location.name = name
                location.category = category
                location.address = address
                location.latitude = lat
                location.longitude = lng
                location.description = desc
                location.is_active = active
                if img:
                    location.image = img
                location.save()
                messages.success(request, f"Đã cập nhật địa điểm: {name}")
            else: # Create
                Location.objects.create(
                    name=name, category=category, address=address,
                    latitude=lat, longitude=lng, description=desc,
                    image=img, is_active=active
                )
                messages.success(request, f"Đã thêm địa điểm mới: {name}")
        return redirect('dashboard:locations')

    # Query locations
    loc_queryset = Location.objects.all().select_related('category')
    search_q = request.GET.get('q')
    cat_filter = request.GET.get('category')

    if search_q:
        loc_queryset = loc_queryset.filter(name__icontains=search_q) | loc_queryset.filter(address__icontains=search_q)
    if cat_filter:
        loc_queryset = loc_queryset.filter(category_id=cat_filter)

    # Pagination
    paginator = Paginator(loc_queryset, 10)
    page_num = request.GET.get('page')
    page_obj = paginator.get_page(page_num)

    # Send full locations as JSON for editor map markers loading
    all_locations = Location.objects.filter(is_active=True)

    context = {
        'categories': categories,
        'page_obj': page_obj,
        'search_query': search_q or '',
        'category_filter': int(cat_filter) if cat_filter else '',
        'all_locations': all_locations,
    }
    return render(request, 'dashboard/locations.html', context)


def delete_location(request, location_id):
    """Delete a location."""
    if not is_staff_check(request.user):
        return redirect('client:login')
    loc = get_object_or_404(Location, id=location_id)
    name = loc.name
    loc.delete()
    messages.warning(request, f"Đã xoá địa điểm: {name}")
    return redirect('dashboard:locations')


def users(request):
    """Manage user accounts and roles."""
    if not is_staff_check(request.user):
        return redirect('client:login')

    users_list = User.objects.all()
    
    # Optional search
    search_q = request.GET.get('q')
    if search_q:
        users_list = users_list.filter(username__icontains=search_q) | users_list.filter(email__icontains=search_q)

    # Query last GPS histories & search histories
    paginator = Paginator(users_list, 10)
    page_num = request.GET.get('page')
    page_obj = paginator.get_page(page_num)

    context = {
        'page_obj': page_obj,
        'search_query': search_q or '',
    }
    return render(request, 'dashboard/users.html', context)


def toggle_user(request, user_id):
    """Toggle user active status."""
    if not is_staff_check(request.user):
        return redirect('client:login')
    user = get_object_or_404(User, id=user_id)
    if user.is_superuser:
        messages.error(request, "Không thể khoá tài khoản Superuser.")
    else:
        user.is_active = not user.is_active
        user.save()
        status_str = "kích hoạt" if user.is_active else "khoá"
        messages.info(request, f"Tài khoản {user.username} đã bị {status_str}.")
    return redirect('dashboard:users')


def feedbacks(request):
    """View rating statistics and respond to feedback submissions."""
    if not is_staff_check(request.user):
        return redirect('client:login')

    feedbacks_list = Feedback.objects.select_related('user').all()
    avg_rating = Feedback.objects.aggregate(Avg('rating'))['rating__avg'] or 5.0
    avg_rating = round(avg_rating, 1)

    paginator = Paginator(feedbacks_list, 10)
    page_num = request.GET.get('page')
    page_obj = paginator.get_page(page_num)

    context = {
        'page_obj': page_obj,
        'avg_rating': avg_rating,
    }
    return render(request, 'dashboard/feedbacks.html', context)


def reply_feedback(request, feedback_id):
    """Submit admin response reply to a user feedback."""
    if not is_staff_check(request.user):
        return redirect('client:login')
    
    if request.method == 'POST':
        fb = get_object_or_404(Feedback, id=feedback_id)
        reply = request.POST.get('response')
        fb.response = reply
        fb.save()
        messages.success(request, f"Đã phản hồi góp ý của {fb.user.username}.")
    return redirect('dashboard:feedbacks')


def routes(request):
    """Overview of the campus graph nodes/edges and route calculations history."""
    if not is_staff_check(request.user):
        return redirect('client:login')

    # Basic stats
    node_count = RouteNode.objects.count()
    edge_count = RouteEdge.objects.count()

    route_history = Route.objects.select_related('user').all()
    paginator = Paginator(route_history, 10)
    page_num = request.GET.get('page')
    page_obj = paginator.get_page(page_num)

    # Collect nodes and edges to view on map overlay
    nodes = RouteNode.objects.all()
    edges = RouteEdge.objects.select_related('node_a', 'node_b').all()

    context = {
        'node_count': node_count,
        'edge_count': edge_count,
        'page_obj': page_obj,
        'nodes': nodes,
        'edges': edges,
    }
    return render(request, 'dashboard/routes.html', context)


def notifications(request):
    """Create and broadcast notifications."""
    if not is_staff_check(request.user):
        return redirect('client:login')

    if request.method == 'POST':
        title = request.POST.get('title')
        msg = request.POST.get('message')
        user_id = request.POST.get('user')  # Blank means broadcast to all

        target_user = None
        if user_id:
            target_user = get_object_or_404(User, id=user_id)

        Notification.objects.create(
            user=target_user,
            title=title,
            message=msg
        )
        messages.success(request, f"Đã gửi thông báo: {title}")
        return redirect('dashboard:notifications')

    notifications_list = Notification.objects.select_related('user').all()
    all_users = User.objects.filter(is_active=True)

    paginator = Paginator(notifications_list, 10)
    page_num = request.GET.get('page')
    page_obj = paginator.get_page(page_num)

    context = {
        'page_obj': page_obj,
        'all_users': all_users,
    }
    return render(request, 'dashboard/notifications.html', context)
