import requests
import re
import webbrowser
import tempfile
import os

BASE_URL = "http://127.0.0.1:8001"

s = requests.Session()

# Bước 1: Lấy CSRF token
r = s.get(f"{BASE_URL}/admin/login/")
print(f"GET /admin/login/ -> {r.status_code}")

csrf = re.search(r'name="csrfmiddlewaretoken" value="([^"]+)"', r.text)
if not csrf:
    print("Khong tim thay CSRF token!")
    print(r.text[:300])
    exit(1)

tok = csrf.group(1)
print(f"CSRF: {tok[:20]}...")

# Bước 2: Login
r2 = s.post(
    f"{BASE_URL}/admin/login/",
    data={
        "csrfmiddlewaretoken": tok,
        "username": "admin",
        "password": "admin123",
        "next": "/admin/"
    },
    headers={"Referer": f"{BASE_URL}/admin/login/"},
    allow_redirects=False
)
print(f"POST login -> {r2.status_code}, Location: {r2.headers.get('Location', 'none')}")

sessionid = s.cookies.get("sessionid", "")
csrftoken = s.cookies.get("csrftoken", "")

if r2.status_code in (301, 302) and sessionid:
    print(f"DANG NHAP THANH CONG! sessionid={sessionid[:20]}...")

    # Bước 3: Tạo file HTML tự động redirect với cookie
    html = f"""<!DOCTYPE html>
<html>
<head><title>Auto Login Admin</title></head>
<body>
<script>
// Set cookies
document.cookie = "sessionid={sessionid}; path=/; domain=127.0.0.1";
document.cookie = "csrftoken={csrftoken}; path=/; domain=127.0.0.1";
// Redirect to admin
window.location.href = "{BASE_URL}/admin/";
</script>
<p>Dang chuyen huong den trang admin...</p>
</body>
</html>"""

    tmp_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "open_admin_auto.html")
    with open(tmp_path, "w", encoding="utf-8") as f:
        f.write(html)

    print(f"Mo file: {tmp_path}")
    webbrowser.open(f"file:///{tmp_path}")
    print("Da mo trinh duyet! Vui long xem trang admin.")
else:
    print(f"DANG NHAP THAT BAI - Status: {r2.status_code}")
    if r2.status_code == 200:
        # Có thể sai mật khẩu
        err = re.search(r'class="errornote">(.*?)</p>', r2.text, re.DOTALL)
        if err:
            print(f"Loi: {err.group(1).strip()}")
