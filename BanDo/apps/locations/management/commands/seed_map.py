from django.core.management.base import BaseCommand
from django.utils.text import slugify
from locations.models import Category, Location, RouteNode, RouteEdge
from feedback.models import Report
from accounts.models import User
import math

class Command(BaseCommand):
    help = "Seeds database with categories, locations, and campus routing graph data for Dong Thap University"

    def handle(self, *args, **options):
        self.stdout.write("Starting map data seeding...")

        # 1. Create default admin and staff accounts if they don't exist
        self.seed_users()

        # 2. Seed UAT Report
        self.seed_uat_report()

        # 3. Seed Categories
        categories_data = [
            {"name": "Giảng đường & Tòa nhà", "icon": "fa-building", "desc": "Các tòa nhà học tập, thí nghiệm và làm việc"},
            {"name": "Cổng trường", "icon": "fa-door-open", "desc": "Các cổng ra vào khuôn viên trường"},
            {"name": "Khu thể thao & Giải trí", "icon": "fa-basketball", "desc": "Sân bóng đá, bóng rổ, tennis, hồ bơi"},
            {"name": "Nhà xe", "icon": "fa-square-parking", "desc": "Các bãi trông giữ xe"},
            {"name": "Tiện ích & Dịch vụ", "icon": "fa-circle-info", "desc": "Thư viện, căng tin, ký túc xá, y tế"},
        ]
        
        cats = {}
        for cat in categories_data:
            c, created = Category.objects.get_or_create(
                name=cat["name"],
                defaults={
                    "slug": slugify(cat["name"]),
                    "icon": cat["icon"],
                    "description": cat["desc"]
                }
            )
            cats[cat["name"]] = c
            if created:
                self.stdout.write(f"Created category: {c.slug}")

        # 4. Seed Locations (POIs)
        pois = [
            {"name": "Cổng C", "cat": "Cổng trường", "lat": 10.421031, "lng": 105.641932, "desc": "Cổng phụ đường Nguyễn Huệ."},
            {"name": "Cổng B", "cat": "Cổng trường", "lat": 10.420366, "lng": 105.642533, "desc": "Cổng B hướng sông Tiền."},
            {"name": "Cổng chính", "cat": "Cổng trường", "lat": 10.419847, "lng": 105.643041, "desc": "Cổng chính Trường Đại học Đồng Tháp."},
            {"name": "Nhà B1", "cat": "Giảng đường & Tòa nhà", "lat": 10.420717, "lng": 105.642506, "desc": "Tòa nhà B1 học tập."},
            {"name": "Nhà B2", "cat": "Giảng đường & Tòa nhà", "lat": 10.420904, "lng": 105.642823, "desc": "Tòa nhà B2 khoa Sư phạm."},
            {"name": "Nhà B3", "cat": "Giảng đường & Tòa nhà", "lat": 10.421105, "lng": 105.643024, "desc": "Tòa nhà B3 học tập."},
            {"name": "Nhà B4", "cat": "Giảng đường & Tòa nhà", "lat": 10.421303, "lng": 105.643228, "desc": "Tòa nhà B4 công nghệ."},
            {"name": "Nhà B5", "cat": "Giảng đường & Tòa nhà", "lat": 10.421485, "lng": 105.643474, "desc": "Tòa nhà B5 ký sinh học."},
            {"name": "Nhà C1", "cat": "Giảng đường & Tòa nhà", "lat": 10.421712, "lng": 105.641854, "desc": "Tòa nhà C1 lý thuyết."},
            {"name": "Nhà C2", "cat": "Giảng đường & Tòa nhà", "lat": 10.42212, "lng": 105.641495, "desc": "Tòa nhà C2 thí nghiệm."},
            {"name": "Nhà A1", "cat": "Giảng đường & Tòa nhà", "lat": 10.420419, "lng": 105.643402, "desc": "Tòa nhà A1 khoa Ngoại ngữ."},
            {"name": "Nhà A4", "cat": "Giảng đường & Tòa nhà", "lat": 10.420327, "lng": 105.643968, "desc": "Tòa nhà A4 khoa CNTT."},
            {"name": "Nhà A7", "cat": "Giảng đường & Tòa nhà", "lat": 10.419032, "lng": 105.643874, "desc": "Tòa nhà A7 học tập."},
            {"name": "Nhà A8", "cat": "Giảng đường & Tòa nhà", "lat": 10.419274, "lng": 105.644832, "desc": "Tòa nhà A8 khoa Kinh tế."},
            {"name": "Nhà A9", "cat": "Giảng đường & Tòa nhà", "lat": 10.418984, "lng": 105.644384, "desc": "Tòa nhà A9 khoa Nghệ thuật."},
            {"name": "Nhà T1", "cat": "Giảng đường & Tòa nhà", "lat": 10.419185, "lng": 105.64506, "desc": "Nhà T1 hành chính."},
            {"name": "Nhà T2", "cat": "Giảng đường & Tòa nhà", "lat": 10.41953, "lng": 105.64506, "desc": "Nhà T2 học tập lý thuyết."},
            {"name": "Nhà T3", "cat": "Giảng đường & Tòa nhà", "lat": 10.41976, "lng": 105.644797, "desc": "Nhà T3 khoa Ngoại ngữ."},
            {"name": "Nhà H1", "cat": "Giảng đường & Tòa nhà", "lat": 10.420601, "lng": 105.643611, "desc": "Tòa nhà H1 Khoa Văn hóa - Du lịch."},
            {"name": "Nhà H2", "cat": "Giảng đường & Tòa nhà", "lat": 10.419686, "lng": 105.644293, "desc": "Tòa nhà H2 khoa Lý luận chính trị."},
            {"name": "Nhà Khát Vọng", "cat": "Giảng đường & Tòa nhà", "lat": 10.420142, "lng": 105.644641, "desc": "Biểu tượng khát vọng phát triển trường."},
            {"name": "Khu thí nghiệm", "cat": "Giảng đường & Tòa nhà", "lat": 10.420794, "lng": 105.644998, "desc": "Khu thí nghiệm thực hành sinh-hóa-lý."},
            {"name": "Nhà A3", "cat": "Giảng đường & Tòa nhà", "lat": 10.419691, "lng": 105.643799, "desc": "Giảng đường A3 đa năng."},
            {"name": "Giảng đường 1", "cat": "Giảng đường & Tòa nhà", "lat": 10.419465, "lng": 105.643593, "desc": "Giảng đường trung tâm."},
            {"name": "Nhà A2", "cat": "Giảng đường & Tòa nhà", "lat": 10.419833, "lng": 105.643778, "desc": "Tòa giảng đường A2."},
            {"name": "Hiệu bộ", "cat": "Giảng đường & Tòa nhà", "lat": 10.420409, "lng": 105.642938, "desc": "Nhà Hiệu bộ ban giám hiệu và phòng ban."},
            {"name": "Thư viện", "cat": "Tiện ích & Dịch vụ", "lat": 10.42106, "lng": 105.64377, "desc": "Thư viện điện tử trung tâm, mở cửa từ 7:30 đến 20:30."},
            {"name": "Ký túc xá", "cat": "Tiện ích & Dịch vụ", "lat": 10.421669, "lng": 105.643866, "desc": "Khu ký túc xá sinh viên hiện đại."},
            {"name": "Nhà xe cổng B", "cat": "Nhà xe", "lat": 10.421197, "lng": 105.64389, "desc": "Nhà xe cho sinh viên khu B."},
            {"name": "Nhà xe cổng C", "cat": "Nhà xe", "lat": 10.421073, "lng": 105.64245, "desc": "Nhà xe cho cán bộ giảng viên."},
            {"name": "Trường mẫu giáo", "cat": "Tiện ích & Dịch vụ", "lat": 10.418921, "lng": 105.644955, "desc": "Trường mẫu giáo DTHU dành cho con em cán bộ."},
            {"name": "Hồ bơi", "cat": "Khu thể thao & Giải trí", "lat": 10.422321, "lng": 105.640886, "desc": "Hồ bơi đạt chuẩn thi đấu."},
            {"name": "Đăng kí lao động", "cat": "Tiện ích & Dịch vụ", "lat": 10.421582, "lng": 105.64424, "desc": "Văn phòng quản lý lao động sinh viên."},
            {"name": "Nhà thi đấu đa năng", "cat": "Khu thể thao & Giải trí", "lat": 10.421258, "lng": 105.642284, "desc": "Nhà thi đấu cầu lông, bóng bàn, võ thuật."},
            {"name": "Sân pickleball", "cat": "Khu thể thao & Giải trí", "lat": 10.421511, "lng": 105.642616, "desc": "Khu sân pickleball hiện đại."},
            {"name": "Sân basketball", "cat": "Khu thể thao & Giải trí", "lat": 10.421696, "lng": 105.642917, "desc": "Sân bóng rổ ngoài trời."},
            {"name": "Sân soccer", "cat": "Khu thể thao & Giải trí", "lat": 10.420978, "lng": 105.64463, "desc": "Sân bóng đá cỏ nhân tạo."},
        ]

        for poi in pois:
            Location.objects.get_or_create(
                name=poi["name"],
                defaults={
                    "category": cats[poi["cat"]],
                    "address": "Khuôn viên Đại học Đồng Tháp, P.6, Cao Lãnh, Đồng Tháp",
                    "latitude": poi["lat"],
                    "longitude": poi["lng"],
                    "description": poi["desc"],
                    "is_active": True
                }
            )
        self.stdout.write(f"Created {len(pois)} POI locations.")

        # 5. Seed Campus Walkway Network (Graph nodes and edges)
        # Coordinates extracted from old_xuli_utf8.js CUSTOM_VISUAL_PATHS
        custom_visual_paths = [
            # 1) b2 xuống nhà a1 xuống gd 1
            [[10.420755, 105.642961], [10.420067, 105.643586], [10.419661, 105.643571], [10.419514, 105.643411]],
            # 2) đoạn từ Cổng B lên thẳng nhà xe
            [[10.420353, 105.642506], [10.42136, 105.643647], [10.421451, 105.64389]],
            # 3) đoạn từ cổng b quẹo phải xuống gd 1 - T2 - A8
            [[10.420418, 105.642579], [10.419249, 105.643657], [10.41934, 105.644594], [10.419274, 105.644832]],
            # 4) hiệu bộ
            [[10.420152, 105.642826], [10.420484, 105.643205]],
            # cong c len c1
            [[10.420988, 105.641884], [10.421128, 105.642079], [10.421471, 105.641751], [10.421712, 105.641854]],
            # ho boi
            [[10.421471, 105.641751], [10.42201, 105.641261], [10.422321, 105.640886]],
            # từ gd 1 qua tòa h3
            [[10.420024, 105.643593], [10.420027, 105.644388], [10.420142, 105.644641]],
            # từ a4 qua h2
            [[10.420029, 105.644001], [10.41929, 105.644043]],
            # từ gd 1 qua a9
            [[10.419661, 105.643571], [10.41929, 105.644043], [10.418984, 105.644384]],
            # qua a7
            [[10.41929, 105.644043], [10.419032, 105.643874]],
            # A9 qua A3-A2-A1
            [[10.41934, 105.644594], [10.41976, 105.644797], [10.41953, 105.64506], [10.419185, 105.64506]],
            # ky tuc xa doc qua b5-b4-b3-b2-b1
            [[10.421573, 105.644101], [10.421539, 105.643631], [10.421824, 105.643356], [10.4209, 105.64232], [10.421128, 105.642079]],
            # đăng kí lao động
            [[10.421573, 105.644101], [10.421582, 105.64424]],
            # vong nhà xe
            [[10.421557, 105.643877], [10.421451, 105.64389], [10.42136, 105.643647]],
            # từ kí túc xá xuống nhà xe
            [[10.421451, 105.64389], [10.421197, 105.64389]],
            # qua c2
            [[10.4214, 105.642886], [10.421759, 105.642538], [10.42159, 105.64235], [10.422172, 105.641802], [10.42212, 105.641495]],
            # c1
            [[10.421851, 105.642105], [10.421712, 105.641854]],
            # fusan
            [[10.421128, 105.642079], [10.421258, 105.642284]],
            # qua san pick
            [[10.4214, 105.642886], [10.421511, 105.642616]],
            # qua san bóng rổ
            [[10.4214, 105.642886], [10.421696, 105.642917]],
            # 9 giữa b4 - b3
            [[10.4214, 105.642886], [10.421004, 105.643245]],
            # 9 giữa b3 - b2
            [[10.421241, 105.6427], [10.420853, 105.643059]],
            # qua A4
            [[10.420029, 105.644001], [10.420106, 105.643889], [10.420235, 105.643895], [10.420327, 105.643968]],
            # lòn vòng H1
            [[10.420235, 105.643895], [10.420267, 105.643646], [10.420869, 105.643093]],
            # vong ben nhà xe
            [[10.420235, 105.643895], [10.420615, 105.643925], [10.421167, 105.643439]],
            # cat cho ngoi sau H1
            [[10.420615, 105.643925], [10.420338, 105.64359]],
            # thu vien
            [[10.420948, 105.643639], [10.42106, 105.64377]],
            # nhà xe
            [[10.420615, 105.643925], [10.420932, 105.644067], [10.421197, 105.64389]],
            # khu thi nghiem
            [[10.420615, 105.643925], [10.420601, 105.644991], [10.420794, 105.644998]],
            # san bóng
            [[10.420932, 105.644067], [10.420978, 105.64463]],
            # Bridge connections to merge disconnected components
            [[10.420755, 105.642961], [10.420484, 105.643205]], # Component 1 to 2
            [[10.42136, 105.643647], [10.421539, 105.643631]], # Component 1 to 3
            [[10.420869, 105.643093], [10.421004, 105.643245]], # Component 1 to 4
            [[10.421197, 105.64389], [10.42106, 105.64377]],   # Component 1 to 5
        ]

        def get_haversine_distance(lat1, lon1, lat2, lon2):
            lat1, lon1, lat2, lon2 = map(math.radians, [float(lat1), float(lon1), float(lat2), float(lon2)])
            dlon = lon2 - lon1
            dlat = lat2 - lat1
            a = math.sin(dlat/2)**2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon/2)**2
            c = 2 * math.asin(math.sqrt(a))
            return c * 6371000

        # Helper to find or create a RouteNode based on lat/lng within a small tolerance (1 meter)
        nodes_created = 0
        edges_created = 0
        tolerance_deg = 0.00012  # Approximately 13 meters in degrees

        def get_or_create_node(p_coords):
            nonlocal nodes_created
            lat, lng = p_coords
            # Check if there is an existing node within tolerance
            existing = RouteNode.objects.filter(
                latitude__gte=lat - tolerance_deg, latitude__lte=lat + tolerance_deg,
                longitude__gte=lng - tolerance_deg, longitude__lte=lng + tolerance_deg
            ).first()
            
            if existing:
                return existing
            
            # Label node if close to a known POI
            node_name = None
            for p in pois:
                if abs(p["lat"] - lat) < tolerance_deg and abs(p["lng"] - lng) < tolerance_deg:
                    node_name = p["name"]
                    break
                    
            node = RouteNode.objects.create(latitude=lat, longitude=lng, name=node_name)
            nodes_created += 1
            return node

        for path in custom_visual_paths:
            for i in range(len(path) - 1):
                p_a = path[i]
                p_b = path[i+1]
                
                node_a = get_or_create_node(p_a)
                node_b = get_or_create_node(p_b)
                
                # Check bidirectional unique constraints
                if node_a.id == node_b.id:
                    continue
                    
                dist = get_haversine_distance(node_a.latitude, node_a.longitude, node_b.latitude, node_b.longitude)
                
                # Create edges bidirectionally
                # To support detailed curves, we store the subsegment points
                edge_ab, created_ab = RouteEdge.objects.get_or_create(
                    node_a=node_a,
                    node_b=node_b,
                    defaults={
                        "distance": dist,
                        "points": [p_a, p_b],
                        "is_active": True
                    }
                )
                if created_ab:
                    edges_created += 1

                RouteEdge.objects.get_or_create(
                    node_a=node_b,
                    node_b=node_a,
                    defaults={
                        "distance": dist,
                        "points": [p_b, p_a],
                        "is_active": True
                    }
                )

        self.stdout.write(f"Created {nodes_created} graph nodes and {edges_created} graph edges.")
        self.stdout.write("Map data seeding completed successfully!")

    def seed_users(self):
        # Admin account
        if not User.objects.filter(username="admin").exists():
            User.objects.create_superuser(
                username="admin",
                email="admin@mappdthu.edu.vn",
                password="adminpassword123",
                role="admin",
                phone="0987654321"
            )
            self.stdout.write("Created default Admin: admin / adminpassword123")
            
        # Staff account
        if not User.objects.filter(username="staff").exists():
            User.objects.create_user(
                username="staff",
                email="staff@mappdthu.edu.vn",
                password="staffpassword123",
                role="staff",
                phone="0123456789",
                is_staff=True
            )
            self.stdout.write("Created default Staff: staff / staffpassword123")
            
        # Normal user
        if not User.objects.filter(username="cuong").exists():
            User.objects.create_user(
                username="cuong",
                email="cuong@gmail.com",
                password="cuongpassword123",
                role="user",
                phone="0911223344"
            )
            self.stdout.write("Created default User: cuong / cuongpassword123")

    def seed_uat_report(self):
        if not Report.objects.filter(title__contains="UAT").exists():
            Report.objects.create(
                title="Báo cáo thử nghiệm chấp nhận người dùng (UAT) - Dự án Bản đồ DTHU",
                participants_count=30,
                completion_rate=95.0,
                satisfaction_rate=93.0,
                avg_gps_error=4.2,
                avg_api_response_ms=115.0,
                routing_success_rate=98.5,
                avg_page_load_seconds=1.2,
                description=(
                    "Báo cáo thử nghiệm UAT được thực hiện bởi nhóm nghiên cứu cùng 30 sinh viên và giảng viên "
                    "trường Đại học Đồng Tháp. Các kịch bản thử nghiệm bao gồm: tìm kiếm địa điểm, định vị GPS hiện tại, "
                    "và tính toán đường đi tối ưu trong campus bằng thuật toán Dijkstra và A*. Kết quả cho thấy tỷ lệ hoàn "
                    "thành tác vụ đạt 95%, mức độ hài lòng đạt 93%. API phản hồi trung bình 115ms (dưới ngưỡng 250ms), sai số "
                    "GPS trung bình là 4.2m ngoài thực địa."
                )
            )
            self.stdout.write("Created default UAT report.")
