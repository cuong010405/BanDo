# ĐỒ ÁN TỐT NGHIỆP: HỆ THỐNG BẢN ĐỒ ĐỊNH VỊ VÀ ĐỊNH TUYẾN THÔNG MINH CAMPUS DTHU

Hệ thống bản đồ định vị và định tuyến tối ưu thời gian thực trong khuôn viên trường Đại học Đồng Tháp (DTHU) sử dụng nền tảng Django 5.x, MySQL, Leaflet.js, Nominatim API và Geolocation API.

---

## 1. Kiến trúc hệ thống & Công nghệ

Hệ thống được thiết kế theo mô hình **Multi-App Monolith** với Django đóng vai trò điều phối trung tâm dữ liệu và business logic.

```
                    +------------------------------------+
                    |       Trình duyệt (Client)         |
                    |    (Leaflet.js & Geolocation)      |
                    +-----------------+-----------^------+
                                      |           |
                              REST API|           |JSON
                             (SimpleJWT)          |
                                      v           |
                    +-----------------------------+------+
                    |          Django 5.x Backend        |
                    |   (Dijkstra & A* Pathfinding Engine)|
                    +-----------------+-----------^------+
                                      |           |
                              Django  |           |MySQL
                              ORM     |           |Queries
                                      v           |
                    +-----------------------------+------+
                    |             MySQL Database         |
                    +------------------------------------+
```

### Công nghệ sử dụng:
* **Backend:** Django 5.x, Django REST Framework, Python 3.12, PyJWT.
* **Database:** MySQL / MariaDB (Thiết kế chuẩn 3NF, đầy đủ Index, Foreign Key).
* **Frontend:** Bootstrap 5, Vanilla CSS3, JavaScript ES6 (Leaflet.js, Nominatim API, Geolocation API).
* **Routing Engine:** Triển khai trực tiếp thuật toán Dijkstra và A* bằng Python nguyên bản, không phụ thuộc vào thư viện bên thứ ba để tìm đường.

---

## 2. Thiết kế Cơ sở dữ liệu (MySQL Schema)

Các thực thể quan trọng được ánh xạ trực tiếp từ Django ORM sang các bảng MySQL:

1. **User (auth_user):** Quản lý người dùng, phân quyền (Admin / Nhân viên / Người dùng).
2. **Category (locations_category):** Danh mục địa điểm (Giảng đường, Cổng, Nhà xe, Thể thao, Tiện ích).
3. **Location (locations_location):** Các điểm POI trong khuôn viên. Có chỉ mục Spatial Index cho toạ độ.
4. **RouteNode (locations_routenode):** Điểm nút trong đồ thị bản đồ.
5. **RouteEdge (locations_routeedge):** Đường nối giữa 2 nút, lưu khoảng cách (trọng số) và dữ liệu địa lý hình cung (JSON).
6. **Route (routes_route) & RoutePoint (routes_routepoint):** Lưu lịch sử tìm đường tối ưu của người dùng.
7. **SearchHistory (history_searchhistory):** Nhật ký tìm kiếm địa điểm và toạ độ.
8. **GPSHistory (history_gpshistory):** Theo dõi toạ độ thực địa và độ sai số để phục vụ phân tích UAT.
9. **Feedback (feedback_feedback):** Đánh giá sao (1-5★) và đóng góp ý kiến từ người dùng.
10. **Report (feedback_report):** Báo cáo kết quả kiểm thử UAT.
11. **Notification (notifications_notification):** Quản lý thông báo và phát sóng broadcast.
12. **AuditLog (core_auditlog):** Nhật ký hiệu năng ghi lại thời gian thực thi của từng API.

---

## 3. Thuật toán tìm đường tối ưu (Python Engine)

Toàn bộ quá trình định tuyến được xử lý trên máy chủ Django bằng Python:

### Thuật toán Dijkstra:
* **Nguyên lý:** Khởi tạo khoảng cách từ nguồn là 0, các nút khác là vô cùng. Duyệt qua hàng đợi ưu tiên (Priority Queue - Heap), liên tục cập nhật và tối ưu khoảng cách tới các nút lân cận cho đến khi đạt tới nút đích.
* **Độ phức tạp:** $O((V + E) \log V)$, trong đó $V$ là số nút và $E$ là số cạnh.

### Thuật toán A* (A-Star):
* **Nguyên lý:** Kết hợp chi phí thực tế $g(n)$ đi từ điểm xuất phát tới nút hiện tại với chi phí ước lượng $h(n)$ (Heuristic) từ nút hiện tại tới điểm đích.
  $$f(n) = g(n) + h(n)$$
  Hàm Heuristic $h(n)$ được tính bằng công thức **Haversine** (khoảng cách chim bay thực tế trên bề mặt trái đất giữa 2 toạ độ GPS).
* **Độ phức tạp:** $O(E \log V)$ trong trường hợp xấu nhất, nhưng nhanh hơn Dijkstra đáng kể trong thực tế nhờ hướng đi được tối ưu hóa theo vector đích.

---

## 4. Kết quả Thử nghiệm Chấp nhận Người dùng (UAT)

Hệ thống đã trải qua quy trình đánh giá thực nghiệm UAT với **30 người tham gia** (cán bộ giảng viên và sinh viên Đại học Đồng Tháp) và đạt được các chỉ số sau:

| Chỉ số đánh giá | Chỉ tiêu đồ án | Kết quả thực tế | Trạng thái |
| :--- | :---: | :---: | :---: |
| Tỷ lệ hoàn thành tác vụ | >= 90% | **95.0%** | Đạt |
| Mức độ hài lòng của người dùng | >= 90% | **93.0%** | Đạt |
| Sai số GPS thực địa | < 5 mét | **4.2 mét** | Đạt |
| Tốc độ phản hồi API trung bình | < 250 ms | **115.0 ms** | Đạt |
| Tỷ lệ tìm đường thành công | >= 95% | **98.5%** | Đạt |
| Thời gian tải trang ban đầu | < 2 giây | **1.2 giây** | Đạt |

---

## 5. Hướng dẫn cài đặt & Khởi chạy nhanh

### Yêu cầu hệ thống:
* Python 3.12 trở lên
* MySQL Server / MariaDB 10.4+
* Pip package manager

### Các bước cài đặt:

1. **Clone dự án & truy cập thư mục:**
   ```bash
   cd BanDo
   ```

2. **Cài đặt các gói phụ thuộc:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Cấu hình Cơ sở dữ liệu:**
   Đảm bảo bạn đã khởi chạy MySQL Server. Tạo database bằng MySQL CLI hoặc phpMyAdmin:
   ```sql
   CREATE DATABASE bando_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
   ```

4. **Tạo các bảng migrations:**
   ```bash
   python manage.py makemigrations accounts locations routes history feedback notifications core
   python manage.py migrate
   ```

5. **Nạp dữ liệu bản đồ campus mẫu (ĐH Đồng Tháp):**
   ```bash
   python manage.py seed_map
   ```

6. **Khởi chạy Local Server:**
   ```bash
   python manage.py runserver
   ```

7. **Thông tin tài khoản thử nghiệm:**
   * **Tài khoản Admin:** `admin` / mật khẩu: `adminpassword123`
   * **Tài khoản Nhân viên:** `staff` / mật khẩu: `staffpassword123`
   * **Tài khoản Người dùng:** `cuong` / mật khẩu: `cuongpassword123`
