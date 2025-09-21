from django.shortcuts import render
from django.http import HttpResponse, JsonResponse
from django.views.decorators.http import require_POST
from django.views.decorators.csrf import csrf_exempt
from django.core.mail import EmailMessage
from django.conf import settings
import json

# Create your views here.
def GiaoDienChinh(request):
    return render(request, 'app/GiaoDienChinh.html')

@csrf_exempt
@require_POST
def api_contact(request):
    try:
        data = json.loads(request.body.decode('utf-8'))
    except Exception:
        return JsonResponse({'ok': False, 'error': 'Dữ liệu không hợp lệ'}, status=400)

    name = (data.get('name') or '').strip()
    email = (data.get('email') or '').strip()
    phone = (data.get('phone') or '').strip()
    msg = (data.get('message') or '').strip()

    if not name or not msg:
        return JsonResponse({'ok': False, 'error': 'Thiếu Họ tên hoặc Nội dung'}, status=400)

    subject = f'Thông tin liên hệ từ {name}'
    lines = [f'Họ tên: {name}']
    if email:
        lines.append(f'Email: {email}')
    if phone:
        lines.append(f'SĐT: {phone}')
    lines.append('')
    lines.append('Nội dung:')
    lines.append(msg)
    body = '\n'.join(lines)

    to_email = getattr(settings, 'CONTACT_TO_EMAIL', None) or 'cuonghiqpqp147@gmail.com'
    from_email = getattr(settings, 'DEFAULT_FROM_EMAIL', None) or getattr(settings, 'EMAIL_HOST_USER', None) or 'no-reply@example.com'

    try:
        mail = EmailMessage(
            subject=subject,
            body=body,
            from_email=from_email,
            to=[to_email],
            reply_to=[email] if email else None
        )
        mail.send(fail_silently=False)
        return JsonResponse({'ok': True})
    except Exception:
        return JsonResponse({'ok': False, 'error': 'Không gửi được email. Kiểm tra cấu hình SMTP.'}, status=500)