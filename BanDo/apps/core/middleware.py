import time
from core.models import AuditLog

class AuditLogMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        # Exclude static/media requests from cluttering audit log
        if request.path.startswith('/static/') or request.path.startswith('/media/') or request.path.startswith('/favicon.ico'):
            return self.get_response(request)

        # Record start time
        start_time = time.perf_counter()

        response = self.get_response(request)

        # Calculate duration
        duration = time.perf_counter() - start_time

        # Get IP address
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0]
        else:
            ip = request.META.get('REMOTE_ADDR')

        # Get authenticated user (if any)
        user = request.user if hasattr(request, 'user') and request.user.is_authenticated else None

        # Safe DB write (avoid crashing application on DB hiccups)
        try:
            # We limit string lengths to prevent DB overflow errors
            AuditLog.objects.create(
                user=user,
                action=f"{request.method} {request.path}",
                ip_address=ip[:45] if ip else None,
                path=request.path[:1000],
                method=request.method,
                response_code=response.status_code,
                execution_time=duration
            )
        except Exception as e:
            # Silently catch to avoid breaking core requests
            pass

        return response
