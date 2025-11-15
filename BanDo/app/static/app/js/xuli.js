// =========================
// POLYGON_OBSTACLES: Danh sách các đa giác (polygon) đại diện cho các tòa nhà/vật cản trên bản đồ
// Mỗi phần tử là một mảng các điểm [vĩ độ, kinh độ] tạo thành một đa giác khép kín
// Dùng để vẽ lên bản đồ, tránh khi tìm đường, hoặc hiển thị trực quan các khu vực không đi qua được
// =========================
const POLYGON_OBSTACLES = [
  // --- Đa giác 1: Thư viện ---
  // Bốn điểm tạo thành hình chữ nhật quanh tòa nhà Thư viện
  [
    [10.42113, 105.64367], // Góc 1 của Thư viện
    [10.42113, 105.64385], // Góc 2 của Thư viện
    [10.42099, 105.64385], // Góc 3 của Thư viện
    [10.42099, 105.64367], // Góc 4 của Thư viện
  ],
  // --- Đa giác 2: Nhà B3 ---
  // Bốn điểm tạo thành hình chữ nhật quanh nhà B3 (cần chỉnh lại nếu tọa độ thực tế khác)
  [
    [10.42116, 105.64298], // Góc 1 của nhà B3
    [10.42116, 105.64307], // Góc 2 của nhà B3
    [10.42105, 105.64307], // Góc 3 của nhà B3
    [10.42105, 105.64298], // Góc 4 của nhà B3
  ],
  // --- Đa giác 3: Nhà xe cổng B ---
  // Bốn điểm tạo thành hình chữ nhật quanh khu vực nhà xe gần cổng B
  [
    [10.42123, 105.64385], // Góc 1 nhà xe cổng B
    [10.42123, 105.64393], // Góc 2 nhà xe cổng B
    [10.42116, 105.64393], // Góc 3 nhà xe cổng B
    [10.42116, 105.64385], // Góc 4 nhà xe cổng B
  ],
  // --- Thêm các polygon khác nếu cần ---
  // Để thêm tòa nhà/vật cản mới, chỉ cần thêm một mảng các điểm [lat, lng] vào đây
];
/**
 * xuli.js – Bản đồ + Geocode + Tìm đường (OSRM)
 * - Khởi tạo Leaflet (OSM tile), polygon khuôn viên, POIs và overlay thông tin.
 * - Nhập địa chỉ hoặc "lat, lng". Geocode bằng Nominatim. Tìm đường bằng OSRM.
 * - Bổ sung đầy đủ hàm tiện ích bị thiếu: removeLayerIfExists, setHighlightMarker, computeAndRenderRoute...
 */

document.addEventListener("DOMContentLoaded", function () {
  // ====== Lấy các phần tử giao diện (DOM elements) ======
  // mapEl: phần tử chứa bản đồ
  // startEl: ô nhập điểm xuất phát
  // endEl: ô nhập điểm đến
  // modeEl: chọn chế độ di chuyển (nếu có)
  // routeInfoEl: hiển thị thông tin tuyến đường
  // findBtn: nút tìm đường
  // campusPlaceEl: chọn nhanh các địa điểm trong khuôn viên (tùy chọn)
  // campusSetStartBtn, campusSetEndBtn: nút đặt làm điểm xuất phát/điểm đến từ danh sách campus (tùy chọn)
  const mapEl = document.getElementById("map");
  const startEl = document.getElementById("start");
  const endEl = document.getElementById("end");
  const modeEl = document.getElementById("mode");
  const routeInfoEl = document.getElementById("route-info");
  const findBtn = document.querySelector(".form-nhap button");
  const campusPlaceEl = document.getElementById("campus-place");
  const campusSetStartBtn = document.getElementById("campus-set-start");
  const campusSetEndBtn = document.getElementById("campus-set-end");

  // ====== Các biến trạng thái dùng trong runtime ======
  // Lưu các marker, tuyến đường, polygon, trạng thái tìm đường, v.v.

  let map, // đối tượng bản đồ Leaflet
    startMarker, // marker điểm xuất phát
    endMarker, // marker điểm đến
    routeLine, // polyline tuyến đường
    highlightMarker, // marker nổi bật khi chọn POI
    campusPolygon, // polygon khuôn viên
    campusPoiLayer; // layer các POI trong campus
  let campusPathsLayer = null; // layer các đường đi trong campus
  let inFlight = null; // trạng thái fetch đang chạy (dùng cho abort)
  let programmaticUpdate = false; // true nếu cập nhật marker bằng code, tránh lặp tìm đường
  // Các biến phục vụ định vị và theo dõi vị trí người dùng
  let userWatchId = null; // id theo dõi vị trí (nếu dùng watchPosition)
  let userLocationMarker = null; // marker vị trí hiện tại của user
  let userAccuracyCircle = null; // vòng tròn thể hiện độ chính xác định vị
  let initializedStartFromWatch = false; // đã khởi tạo marker từ định vị chưa
  let prevUserLatLng = null; // vị trí trước đó (dùng tính hướng di chuyển)
  let lastHeadingDeg = 0; // hướng di chuyển gần nhất (độ)
  let shownLowAccWarn = false; // đã cảnh báo độ chính xác thấp chưa
  let lastAutoRouteLatLng = null; // vị trí lần gần nhất đã tự động vẽ tuyến
  let lastRouteSummary = null; // tóm tắt tuyến đường gần nhất
  let reachedDestination = false; // đã tới điểm đến chưa (để không báo nhiều lần)
  // Loader state: phục vụ hiển thị loading khi tìm đường
  let loadingStartedAt = 0;
  let loadingHideTimer = null;
  // CUSTOM_VISUAL_PATHS: các đường minh họa (polyline) vẽ thêm trên bản đồ
  CUSTOM_VISUAL_PATHS = [];

  // Cấu hình cảnh báo độ chính xác thấp khi định vị (có thể bật/tắt)
  const GEO_WARN_LOW_ACCURACY = false; // true: bật cảnh báo, false: tắt
  const GEO_LOW_ACCURACY_THRESHOLD_M = 150; // ngưỡng cảnh báo (mét)

  // ====== Địa chỉ endpoint cho geocode/reverse geocode ======
  // Sử dụng dịch vụ Nominatim (OpenStreetMap)
  const NOMINATIM_SEARCH = "https://nominatim.openstreetmap.org/search";
  const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

  // ====== Khởi tạo bản đồ và gắn sự kiện ======
  initMap(); // Tạo bản đồ, các layer, polygon, tile nền, v.v.
  attachEventHandlers(); // Gắn các sự kiện cho UI

  // Xuất các hàm để có thể gọi từ HTML (onclick, v.v.)
  window.findRoute = guardedFindRoute;
  window.getCurrentLocation = getCurrentLocation;
  window.resetMap = resetMap;

  // ====== Hàm khởi tạo bản đồ (Leaflet) ======
  // Tạo map, các layer, tile nền, polygon, các pane cho các lớp vẽ khác nhau
  function initMap() {
    map = L.map(mapEl, {
      center: [10.420921, 105.643558], // Tâm bản đồ rộng hơn, dịch ra ngoài một chút để nhìn tổng thể hơn
      zoom: 18, // Mức zoom mặc định
      minZoom: 17, // Zoom nhỏ nhất cho phép (giới hạn không cho zoom quá xa)
      maxZoom: 19, // Zoom lớn nhất cho phép
      rotate: true, // Cho phép xoay bản đồ
      touchRotate: true, // Cho phép xoay bằng cảm ứng
      attribution: "", // Bỏ attribution mặc định của Leaflet
    });
    map.attributionControl.setPrefix(false); // Bỏ chữ "Leaflet" ở góc bản đồ
    try {
      // Tạo các pane riêng cho từng lớp vẽ (giúp kiểm soát thứ tự hiển thị)
      map.createPane("groundPane");
      map.getPane("groundPane").style.zIndex = 400;
      map.createPane("visualBasePane");
      map.getPane("visualBasePane").style.zIndex = 500; // nền đen
      map.createPane("visualCenterPane");
      map.getPane("visualCenterPane").style.zIndex = 510; // vạch trắng ở giữa
      map.createPane("whitePathPane");
      map.getPane("whitePathPane").style.zIndex = 520; // đường trắng tương tác
      map.createPane("stadiumPane");
      map.getPane("stadiumPane").style.zIndex = 530;
      map.createPane("labelPane");
      map.getPane("labelPane").style.zIndex = 700; // nhãn luôn trên cùng
    } catch (e) {}

    // Mở rộng giới hạn bản đồ để cho phép xem rộng hơn khuôn viên trường
    const bounds = [
      [10.424125, 105.638641], // Góc dưới trái (rộng hơn)
      [10.417701, 105.647316], // Góc trên phải (rộng hơn)
      
    ];
    map.setMaxBounds(bounds);

    // Thêm lớp nền bản đồ (OpenStreetMap, style sáng, không nhãn)
    L.tileLayer(
      "https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}{r}.png",
      {
        attribution: "",
        subdomains: "abcd",
        maxZoom: 20,
      }
    ).addTo(map);

    // --- ĐƯỜNG MINH HỌA (CUSTOM VISUAL PATHS) ---
    // Thay các điểm sau cho khớp "đường đen" trên ảnh; mỗi phần là một polyline riêng.

    // --- ĐƯỜNG MINH HỌA (CUSTOM VISUAL PATHS) ---
    // Các polyline ví dụ mô phỏng đường đen trên map bạn gửi.
    // Mỗi phần là 1 đoạn đường; chỉnh tọa độ nếu cần để khớp chính xác.
    /*CUSTOM_VISUAL_PATHS = [
      // 1) b2 xuống nhà a1 xuống gd 1
      [
        [10.420755, 105.642961],
        [10.420067, 105.643586],
        [10.419661, 105.643571],
        [10.419514, 105.643411],
      ],
      // 2) đoạn từ Cổng B lên thẳng nhà xe
      [
        [10.420353, 105.642506],
        [10.42136, 105.643647],
        [10.421451, 105.64389],
      ],
      // 3) đoạn từ cổng b quẹo phải xuống gd 1 -  T2 - A8
      [
        [10.420418, 105.642579],
        [10.419249, 105.643657],
        [10.41934, 105.644594],
        [10.419274, 105.644832],
      ],
      // 4) hiệu bộ
      [
        [10.420152, 105.642826],
        [10.420484, 105.643205],
      ],
      // cong c len c1
      [
        [10.420988, 105.641884],
        [10.421128, 105.642079],
        [10.421471, 105.641751],
        [10.421712, 105.641854],
      ],
      // ho boi
      [
        [10.421471, 105.641751],
        [10.42201, 105.641261],
        [10.422321, 105.640886],
      ],
      // từ gd 1 qua tòa h3
      [
        [10.420024, 105.643593],
        [10.420027, 105.644388],
        [10.420142, 105.644641],
      ],
      // từ a4 qua h2
      [
        [10.420029, 105.644001],
        [10.41929, 105.644043],
      ],
      // từ gd 1 qua  a9
      [
        [10.419661, 105.643571],
        [10.41929, 105.644043],
        [10.418984, 105.644384],
      ],
      // qua a7
      [
        [10.41929, 105.644043],
        [10.419032, 105.643874],
      ],
      // A9 qua A3-A2-A1
      [
        [10.41934, 105.644594],
        [10.41976, 105.644797],
        [10.41953, 105.64506],
        [10.419185, 105.64506],
      ],
      // ky tuc xa doc qua b5-b4-b3-b2-b1
      [
        [10.421573, 105.644101],
        [10.421539, 105.643631],
        [10.421824, 105.643356],
        [10.4209, 105.64232],
        [10.421128, 105.642079],
      ],
      //  đăng kí lao động
      [
        [10.421573, 105.644101],
        [10.421582, 105.64424],
      ],
      //vong nhà xe
      [
        [10.421557, 105.643877],
        [10.421451, 105.64389],
        [10.42136, 105.643647],
      ],
      // từ kí túc xá xuống nhà xe
      [
        [10.421451, 105.64389],
        [10.421197, 105.64389],
      ],
      // qua c2
      [
        [10.4214, 105.642886],
        [10.421759, 105.642538],
        [10.42159, 105.64235],
        [10.422172, 105.641802],
        [10.42212, 105.641495],
      ],
      // c1
      [
        [10.421851, 105.642105],
        [10.421712, 105.641854],
      ],
      // fusan
      [
        [10.421128, 105.642079],
        [10.421258, 105.642284],
      ],
      // qua san pick
      [
        [10.4214, 105.642886],
        [10.421511, 105.642616],
      ],
      // qua san bong ro
      [
        [10.4214, 105.642886],
        [10.421696, 105.642917],
      ],
      // 9 giữa b 4 - b3
      [
        [10.4214, 105.642886],
        [10.421004, 105.643245],
      ],
      // 9 giữa b3 - b2
      [
        [10.421241, 105.6427],
        [10.420853, 105.643059],
      ],
      // qua A4
      [
        [10.420029, 105.644001],
        [10.420106, 105.643889],
        [10.420235, 105.643895],
        [10.420327, 105.643968],
      ],
      // lòn vòng H1
      [
        [10.420235, 105.643895],
        [10.420267, 105.643646],
        [10.420869, 105.643093],
      ],
      // vong  ben nhà xe
      [
        [10.420235, 105.643895],
        [10.420615, 105.643925],
        [10.421167, 105.643439],
      ],
      // cat cho ngoi sau H1
      [
        [10.420615, 105.643925],
        [10.420338, 105.64359],
      ],
      // thu vien
      [
        [10.420948, 105.643639],
        [10.42106, 105.64377],
      ],
      // nhà xe
      [
        [10.420615, 105.643925],
        [10.420932, 105.644067],
        [10.421197, 105.64389],
      ],
      // khu thi nghiem
      [
        [10.420615, 105.643925],
        [10.420601, 105.644991],
        [10.420794, 105.644998],
      ],
      // san bóng
      [
        [10.420932, 105.644067],
        [10.420978, 105.64463],
      ],
    ];
    */

    // Layer riêng cho đường minh họa (để dễ bật/tắt). Vẽ 2 lớp: nền đen dày + vạch trắng mảnh ở giữa.
    let customVisualLayer = null;
    let customVisualVisible = true;

    function buildCustomVisualLayer() {
      if (customVisualLayer) return customVisualLayer;
      customVisualLayer = L.layerGroup();
      for (const seg of CUSTOM_VISUAL_PATHS) {
        if (!Array.isArray(seg) || seg.length < 2) continue;
        const base = L.polyline(seg, {
          pane: "visualBasePane",
          color: "#000000",
          weight: 10,
          opacity: 0.95,
          interactive: false,
          lineJoin: "round",
        });
        const center = L.polyline(seg, {
          pane: "visualCenterPane",
          color: "#ffffff",
          weight: 1,
          opacity: 0.95,
          dashArray: "10,8",
          interactive: false,
          lineCap: "round",
        });
        customVisualLayer.addLayer(base);
        customVisualLayer.addLayer(center);
      }
      return customVisualLayer;
    }
    function drawCustomVisualPaths() {
      if (!map) {
        setTimeout(drawCustomVisualPaths, 200);
        return;
      }
      const layer = buildCustomVisualLayer();
      if (!map.hasLayer(layer) && customVisualVisible) map.addLayer(layer);
    }

    function clearCustomVisualPaths() {
      try {
        if (customVisualLayer && map && map.hasLayer(customVisualLayer))
          map.removeLayer(customVisualLayer);
      } catch {}
      customVisualLayer = null;
    }

    // API runtime để chỉnh / bật tắt nhanh trong console
    window.setCustomVisualPaths = function (arrOfSegments) {
      CUSTOM_VISUAL_PATHS = Array.isArray(arrOfSegments)
        ? arrOfSegments
        : CUSTOM_VISUAL_PATHS;
      clearCustomVisualPaths();
      drawCustomVisualPaths();
    };
    window.clearCustomVisualPaths = function () {
      CUSTOM_VISUAL_PATHS = [];
      clearCustomVisualPaths();
    };
    window.toggleCustomVisualPaths = function () {
      customVisualVisible = !customVisualVisible;
      if (customVisualVisible) drawCustomVisualPaths();
      else clearCustomVisualPaths();
    };

    // Vẽ ngay (hàm drawCampusOnlyPaths có thể gọi lại)
    try {
      drawCustomVisualPaths();
    } catch (e) {}
    // --- KẾT THÚC đường minh họa ---

    // --- VẼ SÂN VẬN ĐỘNG (polygon mô phỏng) ---
    // Tọa độ polygon mẫu bám quanh Sân soccer (chỉnh nếu cần)
    const STADIUM_POLY = [
      [10.421318, 105.64435],
      [10.421323, 105.64485],
      [10.420641, 105.644869],
      [10.420644, 105.644361],
    ];

    let stadiumLayer = null;
    let stadiumVisible = true;

    function buildStadiumLayer() {
      if (stadiumLayer) return stadiumLayer;
      stadiumLayer = L.layerGroup();
      // nền cỏ xanh + viền
      const poly = L.polygon(STADIUM_POLY, {
        pane: "stadiumPane",
        color: "#0f9d58",
        weight: 2,
        opacity: 0.95,
        fillColor: "#34d399",
        fillOpacity: 0.85,
        lineJoin: "round",
      });
      // hàng kẻ sân (song song) — vài đường để giống sân vận động
      const centroid = poly.getBounds().getCenter();
      const lat0 = centroid.lat,
        lng0 = centroid.lng;
      const sc = metersPerDeg(lat0);
      const latM = sc.latM,
        lngM = sc.lngM;

      // tìm cạnh dài nhất để xác định hướng kẻ
      const ptsM = STADIUM_POLY.map((p) => ({
        x: (p[1] - lng0) * lngM,
        y: (p[0] - lat0) * latM,
      }));
      let bestLen = 0,
        bestIdx = 0;
      for (let i = 0; i < ptsM.length; i++) {
        const a = ptsM[i],
          b = ptsM[(i + 1) % ptsM.length];
        const Ld = Math.hypot(b.x - a.x, b.y - a.y);
        if (Ld > bestLen) {
          bestLen = Ld;
          bestIdx = i;
        }
      }
      // unit vector along edge
      let ux = 1,
        uy = 0;
      if (bestLen > 0) {
        const a = ptsM[bestIdx],
          b = ptsM[(bestIdx + 1) % ptsM.length];
        const dx = b.x - a.x,
          dy = b.y - a.y,
          Ld = Math.hypot(dx, dy) || 1;
        ux = dx / Ld;
        uy = dy / Ld;
      }
      const px = -uy,
        py = ux;

      // project pts to get ranges
      let maxAlong = 0,
        minOff = Infinity,
        maxOff = -Infinity;
      for (const p of ptsM) {
        const along = Math.abs(p.x * ux + p.y * uy);
        const off = p.x * px + p.y * py;
        if (along > maxAlong) maxAlong = along;
        if (off < minOff) minOff = off;
        if (off > maxOff) maxOff = off;
      }

      stadiumLayer.addLayer(poly);
      // label cố định
      const labelIcon = L.divIcon({
        className: "stadium-label",

        iconSize: [120, 28],
        iconAnchor: [60, -10],
      });
      const label = L.marker([centroid.lat, centroid.lng], {
        pane: "labelPane",
        icon: labelIcon,
        interactive: false,
      });
      stadiumLayer.addLayer(label);
      return stadiumLayer;
    }

    function drawStadium() {
      if (!map) {
        setTimeout(drawStadium, 200);
        return;
      }
      const layer = buildStadiumLayer();
      if (!map.hasLayer(layer) && stadiumVisible) map.addLayer(layer);
    }

    function clearStadium() {
      try {
        if (stadiumLayer && map && map.hasLayer(stadiumLayer))
          map.removeLayer(stadiumLayer);
      } catch {}
      stadiumLayer = null;
    }

    window.drawStadium = drawStadium;
    window.clearStadium = clearStadium;
    window.toggleStadium = function () {
      stadiumVisible = !stadiumVisible;
      if (stadiumVisible) drawStadium();
      else clearStadium();
    };

    // Vẽ tự động khi load map
    try {
      drawStadium();
    } catch (e) {}
    // --- KẾT THÚC: sân vận động ---

    // --- VẼ HỒ BƠI (polygon mô phỏng) ---
    const POOL_POLY = [
      [10.422301, 105.640676],
      [10.422461, 105.640868],
      [10.422192, 105.641138],
      [10.422042, 105.64092],
    ];

    let poolLayer = null;
    let poolVisible = true;

    function buildPoolLayer() {
      if (poolLayer) return poolLayer;
      poolLayer = L.layerGroup();
      // nền nước xanh nhạt + viền
      const poly = L.polygon(POOL_POLY, {
        pane: "stadiumPane",
        color: "#0ea5e9",
        weight: 2,
        opacity: 0.95,
        fillColor: "#60a5fa",
        fillOpacity: 0.85,
        lineJoin: "round",
      });
      poolLayer.addLayer(poly);

      // vẽ vài đường cong mô phỏng sóng (bằng các polyline mảnh màu trắng mờ)
      const midpoints = [
        [
          [10.42248, 105.64072],
          [10.42222, 105.64072],
        ],
        [
          [10.42248, 105.64086],
          [10.42222, 105.64086],
        ],
        [
          [10.42248, 105.641],
          [10.42222, 105.641],
        ],
      ];
      midpoints.forEach((mp) => {
        const wave = L.polyline(mp, {
          pane: "stadiumPane",
          color: "rgba(255,255,255,0.85)",
          weight: 1.2,
          dashArray: "4,6",
          interactive: false,
        });
        poolLayer.addLayer(wave);
      });

      // label hồ bơi
      const labelIcon = L.divIcon({
        className: "pool-label",

        iconSize: [90, 28],
        iconAnchor: [45, -10],
      });
      const centroid = poly.getBounds().getCenter();
      const label = L.marker([centroid.lat, centroid.lng], {
        pane: "labelPane",
        icon: labelIcon,
        interactive: false,
      });
      poolLayer.addLayer(label);

      return poolLayer;
    }

    function drawPool() {
      if (!map) {
        setTimeout(drawPool, 200);
        return;
      }
      const layer = buildPoolLayer();
      if (!map.hasLayer(layer) && poolVisible) map.addLayer(layer);
    }

    function clearPool() {
      try {
        if (poolLayer && map && map.hasLayer(poolLayer))
          map.removeLayer(poolLayer);
      } catch {}
      poolLayer = null;
    }

    window.drawPool = drawPool;
    window.clearPool = clearPool;
    window.togglePool = function () {
      poolVisible = !poolVisible;
      if (poolVisible) drawPool();
      else clearPool();
    };

    // Vẽ tự động khi load map
    try {
      drawPool();
    } catch (e) {}
    // --- KẾT THÚC: hồ bơi ---

    // --- ĐƯỜNG TRẮNG RIÊNG (dùng cho vẽ chỗ xen kẽ) ---
    // Mảng chứa các đoạn đường trắng: mỗi phần là một mảng [ [lat,lng], ... ]
    let CUSTOM_WHITE_PATHS = [
      [
        [10.421097, 105.642078],
        [10.420994, 105.642183],
      ],
    ];

    // Layer & trạng thái
    let customWhiteLayer = null;
    let customWhiteVisible = true;

    // Draft khi vẽ tương tác
    let _draftWhite = null;
    let _draftLine = null;
    let _draftMarkers = [];
    let _isDrawingWhite = false;

    function buildCustomWhiteLayer() {
      if (customWhiteLayer) return customWhiteLayer;
      customWhiteLayer = L.layerGroup();
      for (const seg of CUSTOM_WHITE_PATHS) {
        if (!Array.isArray(seg) || seg.length < 2) continue;
        // outline nhẹ để nổi trên nền sáng
        const outline = L.polyline(seg, {
          pane: "whitePathPane",
          color: "rgba(0,0,0,0.12)",
          weight: 6,
          opacity: 0.6,
          interactive: false,
          lineJoin: "round",
        });
        const white = L.polyline(seg, {
          pane: "whitePathPane",
          color: "#ffffff",
          weight: 3.2,
          opacity: 0.98,
          interactive: false,
          lineJoin: "round",
        });
        customWhiteLayer.addLayer(outline);
        customWhiteLayer.addLayer(white);
      }
      return customWhiteLayer;
    }

    function drawCustomWhitePaths() {
      if (!map) {
        setTimeout(drawCustomWhitePaths, 200);
        return;
      }
      const layer = buildCustomWhiteLayer();
      if (!map.hasLayer(layer) && customWhiteVisible) map.addLayer(layer);
    }

    function clearCustomWhitePaths() {
      try {
        if (customWhiteLayer && map && map.hasLayer(customWhiteLayer))
          map.removeLayer(customWhiteLayer);
      } catch {}
      customWhiteLayer = null;
    }

    // --- Interactive drawing helpers (click để thêm điểm, dblclick hoặc Enter để hoàn tất, Esc hủy) ---
    function _createDraftMarker(latlng) {
      const m = L.circleMarker(latlng, {
        pane: "whitePathPane",
        radius: 4,
        color: "#000",
        weight: 1,
        fillColor: "#fff",
        fillOpacity: 1,
      }).addTo(map);
      _draftMarkers.push(m);
    }
    function _updateDraftLine() {
      if (_draftLine) removeLayerIfExists(_draftLine);
      if (!_draftWhite || _draftWhite.length < 2) return;
      _draftLine = L.polyline(_draftWhite, {
        pane: "whitePathPane",
        color: "#ffffff",
        weight: 3.2,
        opacity: 0.98,
        interactive: false,
      }).addTo(map);
    }

    function startWhitePathDraw() {
      if (_isDrawingWhite) return;
      _isDrawingWhite = true;
      _draftWhite = [];
      _draftMarkers = [];
      if (map) {
        map.getContainer().style.cursor = "crosshair";
        map.on("click", _onMapClickWhileDrawingWhite);
        map.on("dblclick", _onMapDblClickWhileDrawingWhite);
      }
      showCenterNotice(
        "Vẽ đường trắng: click để thêm điểm; double-click hoặc Enter để hoàn tất; Esc để hủy.",
        "success"
      );
    }

    function _onMapClickWhileDrawingWhite(e) {
      if (!_isDrawingWhite) return;
      const p = [
        parseFloat(e.latlng.lat.toFixed(6)),
        parseFloat(e.latlng.lng.toFixed(6)),
      ];
      _draftWhite.push(p);
      _createDraftMarker(p);
      _updateDraftLine();
    }

    function _onMapDblClickWhileDrawingWhite() {
      finishWhitePathDraw();
    }

    function finishWhitePathDraw() {
      if (!_isDrawingWhite) return;
      if (Array.isArray(_draftWhite) && _draftWhite.length >= 2) {
        CUSTOM_WHITE_PATHS.push(_draftWhite.slice());
        clearCustomWhitePaths();
        drawCustomWhitePaths();
        showCenterNotice("Đã lưu đường trắng.", "success");
      } else {
        showCenterNotice("Đường quá ngắn — cần ít nhất 2 điểm.", "error");
      }
      _stopWhiteDrawingCleanup();
    }

    function cancelWhitePathDraw() {
      if (!_isDrawingWhite) return;
      _stopWhiteDrawingCleanup();
      showCenterNotice("Đã hủy vẽ đường trắng.", "error");
    }

    function _stopWhiteDrawingCleanup() {
      _isDrawingWhite = false;
      if (map) {
        map.off("click", _onMapClickWhileDrawingWhite);
        map.off("dblclick", _onMapDblClickWhileDrawingWhite);
        map.getContainer().style.cursor = "";
      }
      try {
        if (_draftLine) removeLayerIfExists(_draftLine);
      } catch {}
      _draftLine = null;
      for (const m of _draftMarkers)
        try {
          removeLayerIfExists(m);
        } catch {}
      _draftMarkers = [];
      _draftWhite = null;
    }

    // Runtime API
    window.startWhitePathDraw = startWhitePathDraw;
    window.finishWhitePathDraw = finishWhitePathDraw;
    window.cancelWhitePathDraw = cancelWhitePathDraw;
    window.setCustomWhitePaths = function (arr) {
      CUSTOM_WHITE_PATHS = Array.isArray(arr) ? arr : CUSTOM_WHITE_PATHS;
      clearCustomWhitePaths();
      drawCustomWhitePaths();
    };
    window.clearCustomWhitePaths = function () {
      CUSTOM_WHITE_PATHS = [];
      clearCustomWhitePaths();
    };
    window.toggleCustomWhitePaths = function () {
      customWhiteVisible = !customWhiteVisible;
      if (customWhiteVisible) drawCustomWhitePaths();
      else clearCustomWhitePaths();
    };
    window.exportCustomWhitePaths = function () {
      console.log(JSON.stringify(CUSTOM_WHITE_PATHS));
      return CUSTOM_WHITE_PATHS;
    };

    // keyboard: Enter to finish, Esc to cancel while drawing
    document.addEventListener("keydown", (ev) => {
      if (!_isDrawingWhite) return;
      if (ev.key === "Enter") {
        ev.preventDefault();
        finishWhitePathDraw();
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        cancelWhitePathDraw();
      }
    });

    // Tự vẽ nếu muốn lúc load
    try {
      drawCustomWhitePaths();
    } catch (e) {}

    initCampusPOIs();
    centerToCampus();
    try {
      if (typeof drawCampusOnlyPaths === "function") drawCampusOnlyPaths();
    } catch (e) {
      console.warn("drawCampusOnlyPaths error", e);
    }

    // Click map -> reverse geocode -> overlay
    let lastMapClick = 0;
    map.on("click", async (e) => {
      const now = Date.now();
      if (now - lastMapClick < 400) return;
      lastMapClick = now;
      try {
        const meta = await reverseGeocode(e.latlng.lat, e.latlng.lng);
        showPlaceInfo(e.latlng, meta);
      } catch {
        showPlaceInfo(e.latlng, {
          display_name: `Vĩ độ ${e.latlng.lat.toFixed(
            6
          )}, Kinh độ ${e.latlng.lng.toFixed(6)}`,
        });
      }
    });
  }

  // ====== Gắn sự kiện ======
  // ...existing code...

  function attachEventHandlers() {
    // UI controls
    if (modeEl) {
      modeEl.addEventListener("change", () => {
        if (hasBothInputs()) guardedFindRoute();
      });
    }

    [startEl, endEl].forEach((el) => {
      if (!el) return;
      el.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          guardedFindRoute();
        }
      });
      el.addEventListener("input", () => {
        clearInputDatasets(el);
        if (routeInfoEl) routeInfoEl.innerHTML = "";
      });
    });

    if (campusPlaceEl) {
      campusPlaceEl.addEventListener("change", () => {
        const coords = parseLatLng(campusPlaceEl.value.trim());
        if (!coords) return;
        const latlng = { lat: coords[0], lng: coords[1] };
        setHighlightMarker(latlng);
        map.setView([latlng.lat, latlng.lng], 18);
        showPlaceInfo(latlng, {
          name: campusPlaceEl.options[campusPlaceEl.selectedIndex].text,
        });
      });
    }

    if (campusSetStartBtn) {
      campusSetStartBtn.addEventListener("click", () => {
        const coords = parseLatLng(campusPlaceEl?.value?.trim());
        if (!coords) return;
        const label =
          campusPlaceEl.options[campusPlaceEl.selectedIndex]?.text || "";
        setAsStart({ lat: coords[0], lng: coords[1] }, label);
      });
    }

    if (campusSetEndBtn) {
      campusSetEndBtn.addEventListener("click", () => {
        const coords = parseLatLng(campusPlaceEl?.value?.trim());
        if (!coords) return;
        const label =
          campusPlaceEl.options[campusPlaceEl.selectedIndex]?.text || "";
        setAsEnd({ lat: coords[0], lng: coords[1] }, label);
      });
    }

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") closeOverlay();
    });
    const locBtnElem = document.getElementById("loc-btn");
    let _trackingBlink = false; // trạng thái nháy
    function startTrackingBlink() {
      if (!locBtnElem || _trackingBlink) return;
      const iconEl =
        locBtnElem.querySelector("i") ||
        locBtnElem.querySelector(".sidebar-icon");
      if (!iconEl) return;
      iconEl.classList.add("blinking");
      _trackingBlink = true;
    }

    function stopTrackingBlink() {
      if (!locBtnElem || !_trackingBlink) return;
      const iconEl =
        locBtnElem.querySelector("i") ||
        locBtnElem.querySelector(".sidebar-icon");
      if (!iconEl) return;
      iconEl.classList.remove("blinking");
      _trackingBlink = false;
    }

    // Expose để gọi từ logic theo dõi (ví dụ khi stopWatchPosition)
    window.startTrackingBlink = startTrackingBlink;
    window.stopTrackingBlink = stopTrackingBlink;
  }

  // ====== Utils ======
  function showCenterNotice(message, kind) {
    let host = document.getElementById("center-notice");
    if (!host) {
      host = document.createElement("div");
      host.id = "center-notice";
      host.style.cssText =
        "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10004;display:none;";
      const box = document.createElement("div");
      box.id = "center-notice-box";
      box.style.cssText =
        "min-width:260px;max-width:80vw;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);padding:14px 16px;text-align:center;font-weight:600;";
      host.appendChild(box);
      document.body.appendChild(host);
    }
    const box = document.getElementById("center-notice-box");
    box.textContent = message || "";
    if (kind === "success") {
      box.style.borderColor = "rgba(16,185,129,.45)";
      box.style.background = "linear-gradient(180deg,#0b1220,#0f172a)";
    } else if (kind === "error") {
      box.style.borderColor = "rgba(239,68,68,.45)";
      box.style.background = "linear-gradient(180deg,#0b1220,#111827)";
    } else {
      box.style.borderColor = "rgba(234,179,8,.45)";
      box.style.background = "linear-gradient(180deg,#0b1220,#111827)";
    }
    host.style.display = "block";
    try {
      if (window.__centerNoticeTimer) clearTimeout(window.__centerNoticeTimer);
    } catch {}
    window.__centerNoticeTimer = setTimeout(() => {
      host.style.display = "none";
    }, 2200);
  }

  function ensureGlobalLoader() {
    let el = document.getElementById("global-loader");
    if (!el) {
      el = document.createElement("div");
      el.id = "global-loader";
      el.style.cssText =
        "position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;";
      const box = document.createElement("div");
      box.style.cssText =
        "background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);";
      const sp = document.createElement("div");
      sp.style.cssText =
        "width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#22d3ee;animation:glspin .9s linear infinite;";
      const tx = document.createElement("div");
      tx.textContent = "Đang tìm đường...";
      tx.style.cssText = "color:#e5e7eb;font-weight:600;";
      box.appendChild(sp);
      box.appendChild(tx);
      el.appendChild(box);
      document.body.appendChild(el);
      if (!document.getElementById("global-loader-style")) {
        const st = document.createElement("style");
        st.id = "global-loader-style";
        st.textContent =
          "@keyframes glspin { to { transform: rotate(360deg); } }";
        document.head.appendChild(st);
      }
    }
    return el;
  }
  function setLoading(loading, opts = {}) {
    const loader = ensureGlobalLoader();
    const MIN_MS = 1500; // tối thiểu 2 giây
    if (loading) {
      try {
        if (loadingHideTimer) clearTimeout(loadingHideTimer);
      } catch {}
      loadingHideTimer = null;
      loadingStartedAt = Date.now();
      if (findBtn) {
        findBtn.disabled = true;
        if (!findBtn.dataset.originalText)
          findBtn.dataset.originalText = findBtn.innerHTML;
        findBtn.innerHTML = '<i class="fa-solid fa-route"></i> Tìm...';
      }
      loader.style.display = "flex";
    } else {
      const hide = () => {
        loader.style.display = "none";
        if (findBtn) {
          findBtn.disabled = false;
          if (findBtn.dataset.originalText)
            findBtn.innerHTML = findBtn.dataset.originalText;
        }
        if (opts && typeof opts.onHidden === "function") {
          try {
            opts.onHidden();
          } catch {}
        }
      };
      const elapsed = Date.now() - (loadingStartedAt || 0);
      const delay = Math.max(0, MIN_MS - elapsed);
      if (delay > 0) {
        try {
          if (loadingHideTimer) clearTimeout(loadingHideTimer);
        } catch {}
        loadingHideTimer = setTimeout(hide, delay);
      } else {
        hide();
      }
    }
  }

  function hasBothInputs() {
    return startEl?.value.trim() && endEl?.value.trim();
  }

  function clearInputDatasets(el) {
    if (!el) return;
    delete el.dataset.lat;
    delete el.dataset.lng;
    delete el.dataset.label;
  }

  function formatLatLng(latlng) {
    return `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`;
  }

  function parseLatLng(input) {
    if (!input) return null;
    const m = String(input)
      .trim()
      .match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return [lat, lng];
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
    if (inFlight)
      try {
        inFlight.abort();
      } catch {}
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    inFlight = controller;
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      if (!res.ok) throw new Error(`Lỗi mạng (${res.status})`);
      return await res.json();
    } finally {
      clearTimeout(timeoutId);
      inFlight = null;
    }
  }

  async function geocode(input) {
    const parsed = parseLatLng(input);
    if (parsed) return parsed;
    const url = `${NOMINATIM_SEARCH}?format=json&limit=1&q=${encodeURIComponent(
      input
    )}`;
    const data = await fetchJsonWithTimeout(url, {
      headers: { "Accept-Language": "vi,en;q=0.8" },
    });
    if (!data.length) throw new Error(`Không tìm thấy: ${input}`);
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  }

  async function geocodeDetails(input) {
    const url = `${NOMINATIM_SEARCH}?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(
      input
    )}`;
    const data = await fetchJsonWithTimeout(url, {
      headers: { "Accept-Language": "vi,en;q=0.8" },
    });
    if (!data.length) throw new Error(`Không tìm thấy: ${input}`);
    return data[0];
  }

  async function reverseGeocode(lat, lon) {
    const url = `${NOMINATIM_REVERSE}?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1`;
    return await fetchJsonWithTimeout(url, {
      headers: { "Accept-Language": "vi,en;q=0.8" },
    });
  }

  const debouncedFindRoute = debounce(() => guardedFindRoute(), 450);

  // ====== Cập nhật guardedFindRoute để báo thiếu điểm sau khi loader tắt ======
  async function guardedFindRoute() {
    // Nếu chưa đủ điểm, vẫn hiển thị loader ngắn và sau đó popup thông báo ở giữa màn hình
    if (!hasBothInputs()) {
      setLoading(true);
      setLoading(false, {
        onHidden: () => {
          showCenterNotice("Vui lòng chọn điểm xuất phát và điểm đến.", "warn");
        },
      });
      return;
    }
    try {
      setLoading(true);
      if (routeInfoEl) routeInfoEl.innerHTML = "⏳ Đang tìm đường...";
      // Lấy toạ độ xuất phát/kết thúc
      const s = await resolveInputCoords(startEl);
      const e = await resolveInputCoords(endEl);
      let found = false;
      // Nếu điểm xuất phát ngoài campus, chỉ vẽ đường thẳng
      if (!isNearCampus(s[0], s[1], 1500)) {
        // Xóa mọi tuyến cũ
        if (routeLine) removeLayerIfExists(routeLine);
        routeLine = null;
        // Vẽ đường thẳng từ s đến e
        routeLine = L.polyline(
          [
            [s[0], s[1]],
            [e[0], e[1]],
          ],
          {
            color: "#8b5cf6",
            weight: 5,
            opacity: 0.85,
            dashArray: "8,8",
          }
        ).addTo(map);
        found = true;
        if (routeInfoEl)
          routeInfoEl.innerHTML =
            '<div style="color:#f59e42"><b>Bạn đang ở ngoài khu vực campus, chỉ hiển thị đường thẳng tới điểm đến.</b></div>';
        showCenterNotice(
          "Bạn đang ở ngoài khu vực campus, chỉ hiển thị đường thẳng tới điểm đến.",
          "warn"
        );
      } else {
        // Trong campus: giữ logic cũ
        if (typeof window.findAndDrawInternal === "function") {
          window.findAndDrawInternal(
            { lat: s[0], lng: s[1] },
            { lat: e[0], lng: e[1] }
          );
          found = true;
        } else {
          const gridCoords = tryBeelineGridRoute(s, e);
          if (Array.isArray(gridCoords) && gridCoords.length >= 2) {
            drawManualRouteCoords(gridCoords);
            found = true;
          }
        }
        if (!found) {
          showCenterNotice(
            "Không tìm được đường đi phù hợp trong lối mòn/khoảng trống!",
            "error"
          );
        }
      }
    } catch (err) {
      alert(err.message || "Đã xảy ra lỗi");
    } finally {
      setLoading(false);
    }
  }

  async function resolveInputCoords(el) {
    if (el?.dataset?.lat && el?.dataset?.lng)
      return [parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)];
    return await geocode(el.value.trim());
  }

  // Xoá layer an toàn
  function removeLayerIfExists(layer) {
    try {
      if (
        layer &&
        map &&
        typeof map.hasLayer === "function" &&
        map.hasLayer(layer)
      ) {
        map.removeLayer(layer);
      }
    } catch {}
  }

  // Marker làm nổi bật vị trí xem/POI
  function setHighlightMarker(latlng) {
    if (!map) return;
    if (highlightMarker) removeLayerIfExists(highlightMarker);
    highlightMarker = L.circleMarker([latlng.lat, latlng.lng], {
      radius: 8,
      color: "#22d3ee",
      weight: 2,
      fillColor: "#22d3ee",
      fillOpacity: 0.35,
    }).addTo(map);
  }

  // Chuẩn hoá góc về [0, 360)
  function normalizeHeading(deg) {
    if (deg == null || isNaN(deg)) return 0;
    deg = deg % 360;
    return deg < 0 ? deg + 360 : deg;
  }

  // Tính bearing (độ) từ điểm A -> B (latlng) theo công thức geodesic
  function computeBearing(a, b) {
    if (!a || !b) return null;
    const toRad = (x) => (x * Math.PI) / 180;
    const toDeg = (x) => (x * 180) / Math.PI;
    const lat1 = toRad(a.lat),
      lon1 = toRad(a.lng);
    const lat2 = toRad(b.lat),
      lon2 = toRad(b.lng);
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x =
      Math.cos(lat1) * Math.sin(lat2) -
      Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    const brng = toDeg(Math.atan2(y, x));
    return normalizeHeading(brng);
  }

  // Xây dựng DivIcon có mũi tên quay theo heading
  function buildUserHeadingIcon(headingDeg) {
    const hdg = normalizeHeading(headingDeg);
    const html = `
      <div style="width:48px;height:48px;position:relative;transform:rotate(${hdg}deg);transform-origin:center center;">
        <svg width="48" height="48" viewBox="0 0 36 36" xmlns="http://www.w3.org/2000/svg">
          <!-- chấm vị trí -->
          <circle cx="18" cy="18" r="8" fill="#22d3ee" fill-opacity="0.6" stroke="#38bdf8" stroke-width="2" />
          <!-- mũi tên hướng lên (bắc), sẽ được quay bằng CSS -->
          <path d="M18 3 L24 14 L12 14 Z" fill="#22d3ee" stroke="#38bdf8" stroke-width="1.5" />
        </svg>
      </div>`;
    return L.divIcon({
      className: "user-heading-icon",
      html,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
  }

  // Tạo marker có thể kéo thả
  function createMarker(latlng, popupText, colorHex) {
    const color = (colorHex || "3b82f6").replace(/^#?/, "#");
    const html = `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 6px 14px rgba(0,0,0,.35);"></div>`;
    const icon = L.divIcon({
      className: "leaflet-startend-icon",
      html,
      iconSize: [28, 28],
      iconAnchor: [14, 28],
    });
    const marker = L.marker(latlng, { draggable: true, icon })
      .addTo(map)
      .bindPopup(popupText)
      .openPopup();
    marker.on("dragend", (ev) => {
      const pos = ev.target.getLatLng();
      if (popupText.includes("xuất phát")) {
        startEl.value = formatLatLng(pos);
        startEl.dataset.lat = pos.lat;
        startEl.dataset.lng = pos.lng;
      } else {
        endEl.value = formatLatLng(pos);
        endEl.dataset.lat = pos.lat;
        endEl.dataset.lng = pos.lng;
      }
      if (hasBothInputs()) debouncedFindRoute();
    });
    return marker;
  }

  // Đặt điểm xuất phát/kết thúc (cho phép truyền label tùy chọn)
  function setAsStart(latlng, label) {
    if (startMarker) {
      removeLayerIfExists(startMarker);
      startMarker = null;
    }
    // Chỉ tạo chấm khi là thao tác do người dùng (không phải cập nhật chương trình)
    if (!programmaticUpdate) {
      startMarker = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 7,
        color: "#10b981",
        weight: 2,
        fillColor: "#10b981",
        fillOpacity: 0.7,
      }).addTo(map);
    }
    startEl.value = label || formatLatLng(latlng);
    startEl.dataset.lat = latlng.lat;
    startEl.dataset.lng = latlng.lng;
    if (!programmaticUpdate && hasBothInputs()) debouncedFindRoute();
  }
  function setAsEnd(latlng, label) {
    reachedDestination = false;
    if (endMarker) {
      removeLayerIfExists(endMarker);
      endMarker = null;
    }
    // Chỉ tạo chấm khi là thao tác do người dùng (không phải cập nhật chương trình)
    if (!programmaticUpdate) {
      endMarker = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 7,
        color: "#ef4444",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 0.7,
      }).addTo(map);
    }
    endEl.value = label || formatLatLng(latlng);
    endEl.dataset.lat = latlng.lat;
    endEl.dataset.lng = latlng.lng;
    if (!programmaticUpdate && hasBothInputs()) debouncedFindRoute();
  }

  // Reset trạng thái bản đồ
  function resetMap() {
    reachedDestination = false;
    removeLayerIfExists(startMarker);
    removeLayerIfExists(endMarker);
    removeLayerIfExists(routeLine);
    removeLayerIfExists(highlightMarker);
    startMarker = endMarker = routeLine = highlightMarker = null;
    if (startEl) {
      startEl.value = "";
      clearInputDatasets(startEl);
    }
    if (endEl) {
      endEl.value = "";
      clearInputDatasets(endEl);
    }
    if (routeInfoEl) routeInfoEl.innerHTML = "";
  }

  // Hiển thị thông tin lộ trình (tối giản, không có chi tiết bước)
  function renderRouteInfo(summary) {
    lastRouteSummary = summary || null;
    const distanceKm =
      summary?.distance != null ? (summary.distance / 1000).toFixed(2) : "-";
    const durationMin =
      summary?.duration != null ? (summary.duration / 60).toFixed(1) : "-";
    const html = `<div><b>Khoảng cách:</b> ${distanceKm} km<br><b>Thời gian:</b> ${durationMin} phút</div>`;
    if (routeInfoEl) routeInfoEl.innerHTML = html;
  }

  const ARRIVAL_THRESHOLD_M = 30; // ngưỡng báo đã đến (m)
  function renderProgress(remDist) {
    if (!routeInfoEl) return;
    let html = "";
    if (
      lastRouteSummary &&
      Number.isFinite(lastRouteSummary.distance) &&
      Number.isFinite(lastRouteSummary.duration)
    ) {
      const dKm = (lastRouteSummary.distance / 1000).toFixed(2);
      const tMin = (lastRouteSummary.duration / 60).toFixed(1);
      html += `<div><b>Khoảng cách:</b> ${dKm} km<br><b>Thời gian:</b> ${tMin} phút</div>`;
    }
    if (typeof remDist === "number" && isFinite(remDist)) {
      const rem = Math.max(0, Math.round(remDist));
      const etaMin = (rem / 1.2 / 60).toFixed(1); // giả định đi bộ ~1.2 m/s
      html += `<div style="margin-top:6px;color:#cbd5e1"><b>Còn:</b> ${rem} m · ETA ~ ${etaMin} phút</div>`;
    }
    if (html) routeInfoEl.innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function handleError(err) {
    console.error(err);
    alert(err?.message || "Đã xảy ra lỗi. Vui lòng thử lại.");
  }

  function debounce(fn, delay) {
    let t = null;
    return function (...args) {
      if (t) clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Geolocation: bật/tắt theo dõi vị trí khi di chuyển
  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function isNearCampus(lat, lng, radiusM = 1500) {
    const campusCenter = { lat: 10.4209, lng: 105.6439 };
    return distanceMeters({ lat, lng }, campusCenter) < radiusM;
  }
  // Geolocation: bật/tắt theo dõi vị trí khi di chuyển (có mũi tên định hướng)
  function getCurrentLocation() {
    if (!navigator.geolocation) {
      alert("Trình duyệt không hỗ trợ định vị.");
      return;
    }

    const geoBtn = document.getElementById("loc-btn");
    // Cảnh báo khi không chạy trên HTTPS hoặc localhost (trình duyệt có thể chặn định vị)
    if (
      !window.isSecureContext &&
      location.hostname !== "localhost" &&
      location.hostname !== "127.0.0.1"
    ) {
      try {
        alert(
          "Trình duyệt có thể chặn định vị trên kết nối không bảo mật (http). Hãy truy cập bằng https hoặc localhost."
        );
      } catch {}
    }

    // Lấy vị trí một lần và đặt làm điểm xuất phát
    if (geoBtn && !geoBtn.dataset.originalText) {
      geoBtn.dataset.originalText = geoBtn.innerHTML;
    }
    if (typeof window.startTrackingBlink === "function")
      window.startTrackingBlink();
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc =
          typeof pos.coords.accuracy === "number"
            ? pos.coords.accuracy
            : Infinity;
        const ll = L.latLng(lat, lng);
        // Nếu ngoài phạm vi campus, cảnh báo nhưng vẫn đặt marker và zoom tới
        if (!isNearCampus(lat, lng, 1500)) {
          showCenterNotice("Bạn đang ở ngoài khu vực bản đồ!", "warn");
        }
        // Hiển thị marker vị trí hiện tại
        if (!userLocationMarker) {
          userLocationMarker = L.marker(ll, {
            icon: buildUserHeadingIcon(0),
          }).addTo(map);
        } else {
          userLocationMarker.setLatLng(ll);
        }
        if (!userAccuracyCircle) {
          userAccuracyCircle = L.circle(ll, {
            radius: acc,
            color: "#60a5fa",
            weight: 1,
            fillColor: "#3b82f6",
            fillOpacity: 0.1,
          }).addTo(map);
        } else {
          userAccuracyCircle.setLatLng(ll);
          userAccuracyCircle.setRadius(acc);
        }
        // Đặt làm điểm xuất phát
        programmaticUpdate = true;
        setAsStart({ lat, lng }, `${lat.toFixed(6)},${lng.toFixed(6)}`);
        programmaticUpdate = false;
        map.setView(ll, Math.max(map.getZoom(), 15));
        initializedStartFromWatch = true;
        if (hasBothInputs()) {
          try {
            guardedFindRoute();
          } catch {}
          lastAutoRouteLatLng = ll;
        }
        if (geoBtn && geoBtn.dataset.originalText)
          geoBtn.innerHTML = geoBtn.dataset.originalText;
        if (typeof window.stopTrackingBlink === "function")
          window.stopTrackingBlink();
      },
      (err) => {
        console.warn(err);
        alert(
          err.code === 1
            ? "Bạn đã từ chối quyền truy cập vị trí."
            : "Không thể lấy vị trí hiện tại."
        );
        if (geoBtn && geoBtn.dataset.originalText)
          geoBtn.innerHTML = geoBtn.dataset.originalText;
        if (typeof window.stopTrackingBlink === "function")
          window.stopTrackingBlink();
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  }

  // Overlay thông tin địa điểm
  function ensureOverlay() {
    let scrim = document.getElementById("place-overlay-scrim");
    if (!scrim) {
      scrim = document.createElement("div");
      scrim.id = "place-overlay-scrim";
      scrim.style.cssText =
        "position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.35);display:none;";
      document.body.appendChild(scrim);
      scrim.addEventListener("click", (e) => {
        if (e.target === scrim) closeOverlay();
      });
    }
    let card = document.getElementById("place-overlay-card");
    if (!card) {
      card = document.createElement("div");
      card.id = "place-overlay-card";
      card.style.cssText =
        "position:fixed;right:24px;top:24px;z-index:9999;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);width:min(420px,90vw);max-height:80vh;overflow:auto;display:none;";
      document.body.appendChild(card);
    }
    return { scrim, card };
  }

  function openOverlay(html) {
    const { scrim, card } = ensureOverlay();
    card.innerHTML = html;
    scrim.style.display = "block";
    card.style.display = "block";
  }

  function closeOverlay() {
    const scrim = document.getElementById("place-overlay-scrim");
    const card = document.getElementById("place-overlay-card");
    if (scrim) scrim.style.display = "none";
    if (card) card.style.display = "none";
    if (highlightMarker) {
      removeLayerIfExists(highlightMarker);
      highlightMarker = null;
    }
  }

  function showPlaceInfo(latlng, meta) {
    const addrLines = [];
    if (meta?.address) {
      const a = meta.address;
      const parts = [
        a.road,
        a.suburb,
        a.city || a.town || a.village,
        a.state,
        a.postcode,
        a.country,
      ];
      addrLines.push(parts.filter(Boolean).map(escapeHtml).join(", "));
    } else if (meta?.display_name) {
      const dn = String(meta.display_name).trim();
      const rh = String(meta?.name || meta?.display_name || "").trim();
      if (dn && dn.toLowerCase() !== rh.toLowerCase()) {
        addrLines.push(escapeHtml(dn));
      }
    }
    const descriptionHtml = meta?.description
      ? `<div style="color:#e5e7eb;margin-top:6px">${escapeHtml(
          meta.description
        )}</div>`
      : "";
    const headerLabel = escapeHtml(
      (meta?.name || meta?.display_name || "").trim()
    );
    const headerLabelHtml = headerLabel
      ? `<div style="font-weight:600;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%">${headerLabel}</div>`
      : "<div></div>";

    const html = `
      <div style="position:sticky;top:0;background:#0b1220;border-bottom:1px solid rgba(255,255,255,.06);padding:12px 14px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        ${headerLabelHtml}
        <button id="overlay-close" style="background:#111827;border:1px solid rgba(255,255,255,.08);color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer;">Đóng</button>
      </div>
      <div style="padding:14px 14px 8px 14px;line-height:1.65;">
        ${
          addrLines.length
            ? `<div style="color:#cbd5e1">${addrLines.join("<br>")}</div>`
            : ""
        }
        ${descriptionHtml}
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">
          <button id="set-as-start" style="background:linear-gradient(180deg,#10b981,#059669);color:#fff;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Điểm xuất phát</button>
          <button id="set-as-end" style="background:linear-gradient(180deg,#ef4444,#dc2626);color:#fff;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;float:right">Điểm đến</button>
        </div>
      </div>`;

    openOverlay(html);

    const closeBtn = document.getElementById("overlay-close");
    if (closeBtn) closeBtn.addEventListener("click", closeOverlay);

    const btnStart = document.getElementById("set-as-start");
    if (btnStart)
      btnStart.addEventListener("click", () => {
        setAsStart(latlng, meta?.name || meta?.display_name || "");
        closeOverlay();
      });

    const btnEnd = document.getElementById("set-as-end");
    if (btnEnd)
      btnEnd.addEventListener("click", () => {
        setAsEnd(latlng, meta?.name || meta?.display_name || "");
        closeOverlay();
      });

    setHighlightMarker(latlng);
  }

  // Kiểm tra điểm có trong polygon (ray casting)
  function pointInPolygon([lat, lng], polygonLayer) {
    if (!polygonLayer) return false;
    // polygonLayer là mảng [lat, lng]
    const poly = polygonLayer;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0],
        yi = poly[i][1];
      const xj = poly[j][0],
        yj = poly[j][1];
      const intersect =
        yi > lng !== yj > lng &&
        lat < ((xj - xi) * (lng - yi)) / (yj - yi + 1e-12) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Khởi tạo POIs trong khuôn viên
  function initCampusPOIs() {
    if (campusPoiLayer) {
      removeLayerIfExists(campusPoiLayer);
      campusPoiLayer = null;
    }
    campusPoiLayer = L.layerGroup().addTo(map);

    function buildPoiIcon(label, colorHint) {
      const safe = label
        ? String(label).replace(
            /[<>&"]/g,
            (s) =>
              ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[s])
          )
        : "";
      const k = (label || "").toLowerCase();
      let color =
        colorHint || k.includes("thư viện")
          ? "#6366f1" // tím cho tòa / thư viện
          : k.includes("Nhà")
          ? "#ef4444"
          : k.includes("nhà xe")
          ? "#f59e0b"
          : k.includes("ký túc")
          ? "#06b6d4"
          : k.includes("cổng")
          ? "#10b981"
          : k.includes("sân")
          ? "#3b82f6"
          : k.includes("hồ")
          ? "#0ea5e9"
          : k.includes("nhà thi đấu")
          ? "#8b5cf6"
          : k.includes("pickleball")
          ? "#f97316"
          : k.includes("giáo")
          ? "#eab308"
          : k.includes("khu")
          ? "#8cff00ff"
          : k.includes("hiệu")
          ? "#0ea5e9"
          : "#e70384ff";
      const dotHtml = `<div style="width:10px;height:10px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 4px 8px rgba(0,0,0,.12)"></div>`;
      const labelHtml = `<div style="background:#fff;color:#0b1220;padding:6px 10px;border-radius:12px;font-weight:600;font-size:13px;white-space:nowrap;box-shadow:0 8px 20px rgba(11,18,32,.06);">${safe}</div>`;
      const html = `<div style="display:flex;align-items:center;gap:8px;transform:translateY(-8px)">${dotHtml}${labelHtml}</div>`;
      return L.divIcon({
        className: "poi-icon",
        html,
        iconSize: [160, 36],
        iconAnchor: [20, 18],
      });
    }

    const campusPOIs = [
      {
        id: "gateC",
        name: "Cổng C",
        lat: 10.421031,
        lng: 105.641932,
        description: "Cổng C của khuôn viên trường.",
      },
      {
        id: "gateB",
        name: "Cổng B",
        lat: 10.420366,
        lng: 105.642533,
        description: "Cổng B của khuôn viên trường.",
      },
      {
        id: "buildingB1",
        name: "Nhà B1",
        lat: 10.420717,
        lng: 105.642506,
        description: "Nhà B1",
      },
      {
        id: "buildingB2",
        name: "Nhà B2",
        lat: 10.420904,
        lng: 105.642823,
        description: "Nhà B2",
      },
      {
        id: "buildingB3",
        name: "Nhà B3",
        lat: 10.421105,
        lng: 105.643024,
        description: "Nhà B3",
      },
      {
        id: "buildingB4",
        name: "Nhà B4",
        lat: 10.421303,
        lng: 105.643228,
        description: "Nhà B4",
      },
      {
        id: "buildingB5",
        name: "Nhà B5",
        lat: 10.421485,
        lng: 105.643474,
        description: "Nhà B5",
      },
      {
        id: "buildingC1",
        name: "Nhà C1",
        lat: 10.421712,
        lng: 105.641854,
        description: "Nhà C1",
      },
      {
        id: "buildingC2",
        name: "Nhà C2",
        lat: 10.42212,
        lng: 105.641495,
        description: "Nhà C2",
      },
      {
        id: "buildingA1",
        name: "Nhà A1",
        lat: 10.420419,
        lng: 105.643402,
        description: "Nhà A1",
      },
      {
        id: "buildingA4",
        name: "Nhà A4",
        lat: 10.420327,
        lng: 105.643968,
        description: "Nhà A4",
      },
      {
        id: "buildingA7",
        name: "Nhà A7",
        lat: 10.419032,
        lng: 105.643874,
        description: "Nhà A7",
      },
      {
        id: "buildingA8",
        name: "Nhà A8",
        lat: 10.419274,
        lng: 105.644832,
        description: "Nhà A8",
      },
      {
        id: "buildingA9",
        name: "Nhà A9",
        lat: 10.418984,
        lng: 105.644384,
        description: "Nhà A9",
      },
      {
        id: "buildingT1",
        name: "Nhà T3",
        lat: 10.41976,
        lng: 105.644797,
        description: "Nhà T3",
      },
      {
        id: "buildingT2",
        name: "Nhà T2",
        lat: 10.41953,
        lng: 105.64506,
        description: "Nhà T2",
      },
      {
        id: "buildingT3",
        name: "Nhà T1",
        lat: 10.419185,
        lng: 105.64506,
        description: "Nhà T1",
      },
      {
        id: "buildingH1",
        name: "Nhà H1",
        lat: 10.420601,
        lng: 105.643611,
        description: "Nhà H1",
      },
      {
        id: "buildingH2",
        name: "Nhà H2",
        lat: 10.419686,
        lng: 105.644293,
        description: "Nhà H2",
      },
      {
        id: "buildingH3",
        name: "Nhà Khát Vọng",
        lat: 10.420142,
        lng: 105.644641,
        description: "Nhà H3",
      },
      {
        id: "sports hall",
        name: "Nhà thi đấu đa năng",
        lat: 10.421258,
        lng: 105.642284,
        description: "Nhà thi đấu đa năng",
      },
      {
        id: "pickleball court",
        name: "Sân pickleball",
        lat: 10.421511,
        lng: 105.642616,
        description: "Sân pickleball",
      },
      {
        id: "basketball court",
        name: "Sân basketball",
        lat: 10.421696,
        lng: 105.642917,
        description: "Sân basketball",
      },
      {
        id: "soccer field",
        name: "Sân soccer",
        lat: 10.420978,
        lng: 105.64463,
        description: "Sân soccer",
      },
      {
        id: "experimental area",
        name: "Khu thí nghiệm",
        lat: 10.420794,
        lng: 105.644998,
        description: "Khu thí nghiệm",
      },
      {
        id: "hall-a",
        name: "Nhà A3",
        lat: 10.419691,
        lng: 105.643799,
        description: "Giảng đường lớn dành cho các lớp học tập trung.",
      },
      {
        id: "hall-1",
        name: "Giảng đường 1",
        lat: 10.419465,
        lng: 105.643593,
        description: "Giảng đường lớn dành cho các lớp học tập trung.",
      },
      {
        id: "hall-2",
        name: "Nhà A2",
        lat: 10.419833,
        lng: 105.643778,
        description: "Giảng đường lớn dành cho các lớp học tập trung.",
      },
      {
        id: "library",
        name: "Thư viện",
        lat: 10.42106,
        lng: 105.64377,
        description: "Thư viện trường, mở cửa từ 7:30 - 20:00.",
      },
      {
        id: "dorm",
        name: "Ký túc xá",
        lat: 10.421669,
        lng: 105.643866,
        description: "Ký túc xá sinh viên.",
      },
      {
        id: "hieubo",
        name: "Hiệu bộ",
        lat: 10.420409,
        lng: 105.642938,
        description: "Hiệu bộ trường Đại học Đồng Tháp.",
      },
      {
        id: "parkingB",
        name: "Nhà xe cổng B",
        lat: 10.421197,
        lng: 105.64389,
        description: "Khu vực gửi xe cho sinh viên và cán bộ.",
      },
      {
        id: "parkingC",
        name: "Nhà xe cổng C",
        lat: 10.421073,
        lng: 105.64245,
        description: "Khu vực gửi xe cho sinh viên và cán bộ.",
      },
      {
        id: "school",
        name: "Trường mẫu giáo",
        lat: 10.418921,
        lng: 105.644955,
        description: "Trường mẫu giáo dành cho con em cán bộ và sinh viên.",
      },
      {
        id: "pool",
        name: "Hồ bơi",
        lat: 10.422321,
        lng: 105.640886,
        description: "Hồ bơi",
      },
      {
        id: "laodong",
        name: "Đăng kí lao động",
        lat: 10.421582,
        lng: 105.64424,
        description: "Lao động",
      },
    ];

    campusPOIs.forEach((p) => {
      const marker = L.marker([p.lat, p.lng], {
        pane: "labelPane",
        icon: buildPoiIcon(p.name),
      });
      marker.on("click", () => {
        const meta = {
          name: p.name,
          description: p.description,
          display_name: p.name,
        };
        const latlng = { lat: p.lat, lng: p.lng };
        showPlaceInfo(latlng, meta);
        setHighlightMarker(latlng);
        if (map) map.setView([p.lat, p.lng], Math.max(map.getZoom(), 18));
      });
      marker.addTo(campusPoiLayer);
    });
  }

  // Tuyến thủ công nội bộ (polyline) giữa các POI trong khuôn viên
  const CAMPUS_PATH_ORDER = [
    { name: "Sân soccer", lat: 10.420825, lng: 105.644397 },
    { name: "Khu thí nghiệm", lat: 10.420781, lng: 105.644899 },
    { name: "Giảng đường A", lat: 10.419691, lng: 105.643799 },
    { name: "Thư viện", lat: 10.42106, lng: 105.64377 },
    { name: "Ký túc xá", lat: 10.421669, lng: 105.643866 },
  ];

  // Tuyến thủ công (màu tím) trong khuôn viên, dùng khi hai điểm gần tuyến này
  const CAMPUS_MANUAL_PATH = [
    [10.420825, 105.644397], // Sân soccer
    [10.420781, 105.644899], // Khu thí nghiệm
    [10.419691, 105.643799], // Giảng đường A
    [10.42106, 105.64377], // Thư viện
    [10.421669, 105.643866], // Ký túc xá
  ];

  // ==== Lưới lối đi (walkway) – vẽ bằng các polyline bám "khoảng trống" ====

  function _round6(x) {
    return Math.round(x * 1e6) / 1e6;
  }
  function _hashLL(lat, lng) {
    return `${_round6(lat)},${_round6(lng)}`;
  }

  function buildWalkwayGraph() {
    const nodes = new Map(); // key -> {id, lat, lng}
    const adj = new Map(); // id -> [{to, weight}]
    let idSeq = 0;
    function ensureNode(lat, lng) {
      const key = _hashLL(lat, lng);
      if (!nodes.has(key)) nodes.set(key, { id: `n${++idSeq}`, lat, lng });
      return nodes.get(key);
    }
    function link(a, b) {
      const w = haversineMeters(a.lat, a.lng, b.lat, b.lng);
      if (!adj.has(a.id)) adj.set(a.id, []);
      if (!adj.has(b.id)) adj.set(b.id, []);
      adj.get(a.id).push({ to: b.id, weight: w });
      adj.get(b.id).push({ to: a.id, weight: w });
    }

    // Kết hợp WALKWAY_NETWORK + CUSTOM_VISUAL_PATHS + CAMPUS_MANUAL_PATH
    const allLines = [];
    if (Array.isArray(WALKWAY_NETWORK)) allLines.push(...WALKWAY_NETWORK);
    if (Array.isArray(CUSTOM_VISUAL_PATHS)) {
      for (const seg of CUSTOM_VISUAL_PATHS)
        if (Array.isArray(seg) && seg.length >= 2) allLines.push(seg);
    }
    if (Array.isArray(CAMPUS_MANUAL_PATH) && CAMPUS_MANUAL_PATH.length >= 2) {
      allLines.push(CAMPUS_MANUAL_PATH);
    }

    for (const line of allLines) {
      for (let i = 1; i < line.length; i++) {
        const pA = line[i - 1],
          pB = line[i];
        if (!Array.isArray(pA) || !Array.isArray(pB)) continue;
        const p1 = ensureNode(pA[0], pA[1]);
        const p2 = ensureNode(pB[0], pB[1]);
        link(p1, p2);
      }
    }
    // Trả về lookup theo id và các danh sách hỗ trợ
    const nodesById = new Map();
    for (const n of nodes.values()) nodesById.set(n.id, n);
    return { nodesById, adj };
  }

  function findNearestWalkNode(graph, lat, lng) {
    let bestId = null,
      best = Infinity;
    for (const [id, n] of graph.nodesById.entries()) {
      const d = haversineMeters(lat, lng, n.lat, n.lng);
      if (d < best) {
        best = d;
        bestId = id;
      }
    }
    return { id: bestId, dist: best };
  }

  function dijkstraById(graph, srcId, dstId) {
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const id of graph.nodesById.keys()) dist.set(id, Infinity);
    dist.set(srcId, 0);
    while (visited.size < graph.nodesById.size) {
      let u = null,
        best = Infinity;
      for (const [k, v] of dist.entries()) {
        if (visited.has(k)) continue;
        if (v < best) {
          best = v;
          u = k;
        }
      }
      if (u == null || best === Infinity) break;
      visited.add(u);
      if (u === dstId) break;
      const neighbors = graph.adj.get(u) || [];
      for (const nb of neighbors) {
        const alt = dist.get(u) + nb.weight;
        if (alt < dist.get(nb.to)) {
          dist.set(nb.to, alt);
          prev.set(nb.to, u);
        }
      }
    }
    if (!prev.has(dstId) && srcId !== dstId) return null;
    const pathIds = [];
    let cur = dstId;
    pathIds.push(cur);
    while (cur !== srcId) {
      const p = prev.get(cur);
      if (!p) break;
      pathIds.push(p);
      cur = p;
    }
    pathIds.reverse();
    return pathIds;
  }

  const WALKWAY_NEAR_THRESH_M = 120; // khoảng cách tối đa để coi là ở gần lưới lối đi
  function tryWalkwayRoute(s, e) {
    const g = buildWalkwayGraph();
    const ns = findNearestWalkNode(g, s[0], s[1]);
    const ne = findNearestWalkNode(g, e[0], e[1]);
    if (
      !ns.id ||
      !ne.id ||
      (ns.dist > WALKWAY_NEAR_THRESH_M && ne.dist > WALKWAY_NEAR_THRESH_M)
    )
      return null;
    const ids = dijkstraById(g, ns.id, ne.id);
    if (!ids || !ids.length) return null;
    const coords = [];
    coords.push([s[0], s[1]]);
    for (const id of ids) {
      const n = g.nodesById.get(id);
      coords.push([n.lat, n.lng]);
    }
    coords.push([e[0], e[1]]);
    return coords;
  }

  // ==== Beeline A* trên lưới tránh vật cản (đi theo khoảng trống như bạn vẽ) ====
  function getCampusObstacles() {
    const items = [
      ["Tòa B1", 10.420717, 105.642506, 24],
      ["Tòa B2", 10.420904, 105.642823, 24],
      ["Tòa B3", 10.421105, 105.643024, 28],
      ["Tòa B4", 10.421303, 105.643228, 26],
      ["Tòa B5", 10.421485, 105.643474, 26],
      ["Tòa C1", 10.421712, 105.641854, 26],
      ["Tòa C2", 10.42212, 105.641495, 26],
      ["Tòa A1", 10.420419, 105.643402, 24],
      ["Tòa A4", 10.420327, 105.643968, 24],
      ["Tòa A7", 10.419032, 105.643874, 24],
      ["Tòa A8", 10.419274, 105.644832, 24],
      ["Tòa A9", 10.418984, 105.644384, 24],
      ["Tòa T1", 10.41976, 105.644797, 24],
      ["Tòa T3", 10.419385, 105.64506, 24],
      ["Tòa H1", 10.420601, 105.643611, 24],
      ["Tòa H2", 10.419686, 105.644293, 24],
      ["Tòa H3", 10.420142, 105.644641, 24],
      ["Nhà thi đấu đa năng", 10.421258, 105.642284, 40],
      ["Thư viện", 10.42106, 105.64377, 28],
      ["Ký túc xá", 10.421669, 105.643866, 28],
      ["Hiệu bộ", 10.420409, 105.642938, 24],
      ["Nhà xe cổng B", 10.421197, 105.64389, 20],
      ["Nhà xe cổng C", 10.421073, 105.64245, 20],
      ["Sân pickleball", 10.421511, 105.642616, 18],
      ["Sân basketball", 10.421696, 105.642917, 20],
      ["NoDiag1", 10.4212, 105.6427, 12],
      ["NoDiag2", 10.4213, 105.64293, 12],
      ["NoDiag3", 10.42141, 105.64318, 12],
      ["NoDiag4", 10.42148, 105.64333, 12],
    ];
    return items.map((x) => ({ name: x[0], lat: x[1], lng: x[2], r: x[3] }));
  }
  function metersPerDeg(lat) {
    const latM = 111320;
    const lngM = 111320 * Math.cos(((lat || 10.4205) * Math.PI) / 180);
    return { latM, lngM };
  }
  function project(lat0, lng0, lat, lng) {
    const sc = metersPerDeg(lat0);
    return { x: (lng - lng0) * sc.lngM, y: (lat - lat0) * sc.latM };
  }
  function unproject(lat0, lng0, x, y) {
    const sc = metersPerDeg(lat0);
    return { lat: y / sc.latM + lat0, lng: x / sc.lngM + lng0 };
  }

  function rdpSimplify(points, eps) {
    if (!points || points.length <= 2) return points || [];
    function perpDist(p, a, b) {
      const x = a[1],
        y = a[0],
        x2 = b[1],
        y2 = b[0],
        x0 = p[1],
        y0 = p[0];
      const dx = x2 - x,
        dy = y2 - y;
      if (dx === 0 && dy === 0) return Math.hypot(x0 - x, y0 - y);
      const t = ((x0 - x) * dx + (y0 - y) * dy) / (dx * dx + dy * dy);
      const px = x + t * dx,
        py = y + t * dy;
      return Math.hypot(x0 - px, y0 - py);
    }
    function rec(pts) {
      let maxD = 0,
        idx = 0;
      const a = pts[0],
        b = pts[pts.length - 1];
      for (let i = 1; i < pts.length - 1; i++) {
        const d = perpDist(pts[i], a, b);
        if (d > maxD) {
          maxD = d;
          idx = i;
        }
      }
      if (maxD > eps) {
        const p1 = rec(pts.slice(0, idx + 1));
        const p2 = rec(pts.slice(idx));
        return p1.slice(0, -1).concat(p2);
      }
      return [a, b];
    }
    return rec(points);
  }

  function tryBeelineGridRoute(s, e) {
    if (!Array.isArray(s) || !Array.isArray(e)) return null;
    const obs = getCampusObstacles();
    const lat0 = 10.4208,
      lng0 = 105.6438; // gốc quy chiếu gần khuôn viên
    const ps = project(lat0, lng0, s[0], s[1]);
    const pe = project(lat0, lng0, e[0], e[1]);
    let minX = Math.min(ps.x, pe.x),
      maxX = Math.max(ps.x, pe.x);
    let minY = Math.min(ps.y, pe.y),
      maxY = Math.max(ps.y, pe.y);
    for (const o of obs) {
      const p = project(lat0, lng0, o.lat, o.lng);
      minX = Math.min(minX, p.x - o.r - 40);
      maxX = Math.max(maxX, p.x + o.r + 40);
      minY = Math.min(minY, p.y - o.r - 40);
      maxY = Math.max(maxY, p.y + o.r + 40);
    }
    const cell = 3; // mét/ô (mịn hơn để bám sát khoảng trống)
    const w = Math.max(10, Math.ceil((maxX - minX) / cell) + 1);
    const h = Math.max(10, Math.ceil((maxY - minY) / cell) + 1);
    const block = new Uint8Array(w * h);
    function idx(ix, iy) {
      return iy * w + ix;
    }
    function cellCenter(ix, iy) {
      return { x: minX + ix * cell, y: minY + iy * cell };
    }
    // mark obstacles
    for (let iy = 0; iy < h; iy++) {
      for (let ix = 0; ix < w; ix++) {
        const c = cellCenter(ix, iy);
        // Chuyển về lat/lng để kiểm tra polygon
        const ll = unproject(lat0, lng0, c.x, c.y);
        let inPoly = false;
        for (const poly of POLYGON_OBSTACLES) {
          if (pointInPolygon([ll.lat, ll.lng], poly)) {
            inPoly = true;
            break;
          }
        }
        if (inPoly) {
          block[idx(ix, iy)] = 1;
          continue;
        }
        // Vẫn kiểm tra vật cản hình tròn (cũ)
        for (const o of obs) {
          const po = project(lat0, lng0, o.lat, o.lng);
          const d = Math.hypot(c.x - po.x, c.y - po.y);
          if (d <= o.r) {
            block[idx(ix, iy)] = 1;
            break;
          }
        }
      }
    }
    function clampCellNear(xm, ym) {
      let ix = Math.round((xm - minX) / cell),
        iy = Math.round((ym - minY) / cell);
      ix = Math.max(0, Math.min(w - 1, ix));
      iy = Math.max(0, Math.min(h - 1, iy));
      if (!block[idx(ix, iy)]) return { ix, iy };
      const q = [[ix, iy]],
        seen = new Set([idx(ix, iy)]);
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      while (q.length) {
        const [cx, cy] = q.shift();
        for (const d of dirs) {
          const nx = cx + d[0],
            ny = cy + d[1];
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = idx(nx, ny);
          if (seen.has(k)) continue;
          seen.add(k);
          if (!block[k]) return { ix: nx, iy: ny };
          q.push([nx, ny]);
        }
      }
      return { ix, iy };
    }
    const sCell = clampCellNear(ps.x, ps.y);
    const eCell = clampCellNear(pe.x, pe.y);
    const D = 1,
      D2 = 1.5;
    const gScore = new Float32Array(w * h);
    for (let i = 0; i < gScore.length; i++) gScore[i] = Infinity;
    const fScore = new Float32Array(w * h);
    for (let i = 0; i < fScore.length; i++) fScore[i] = Infinity;
    const prev = new Int32Array(w * h);
    for (let i = 0; i < prev.length; i++) prev[i] = -1;
    const start = idx(sCell.ix, sCell.iy),
      goal = idx(eCell.ix, eCell.iy);
    gScore[start] = 0;
    function hCost(a, b) {
      const ax = a % w,
        ay = (a / w) | 0,
        bx = b % w,
        by = (b / w) | 0;
      const dx = Math.abs(ax - bx),
        dy = Math.abs(ay - by);
      return D * (dx + dy) + (D2 - 2 * D) * Math.min(dx, dy);
    }
    fScore[start] = hCost(start, goal);
    const open = new Set([start]);
    const nbrs = [
      [1, 0, D],
      [0, 1, D],
      [-1, 0, D],
      [0, -1, D],
      [1, 1, D2],
      [1, -1, D2],
      [-1, 1, D2],
      [-1, -1, D2],
    ];
    while (open.size) {
      let cur = -1,
        best = Infinity;
      for (const k of open) {
        if (fScore[k] < best) {
          best = fScore[k];
          cur = k;
        }
      }
      if (cur === goal) break;
      open.delete(cur);
      const cx = cur % w,
        cy = (cur / w) | 0;
      for (const d of nbrs) {
        const nx = cx + d[0],
          ny = cy + d[1];
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = idx(nx, ny);
        if (block[ni]) continue;
        const tentative = gScore[cur] + d[2];
        if (tentative < gScore[ni]) {
          prev[ni] = cur;
          gScore[ni] = tentative;
          fScore[ni] = tentative + hCost(ni, goal);
          open.add(ni);
        }
      }
    }
    if (prev[goal] === -1 && goal !== start) return null;
    const path = [];
    let cur = goal;
    path.push(cur);
    while (cur !== start) {
      cur = prev[cur];
      if (cur < 0) break;
      path.push(cur);
    }
    path.reverse();
    const pts = [];
    pts.push([s[0], s[1]]);
    for (const p of path) {
      const cx = p % w,
        cy = (p / w) | 0;
      const c = cellCenter(cx, cy);
      const ll = unproject(lat0, lng0, c.x, c.y);
      pts.push([ll.lat, ll.lng]);
    }
    pts.push([e[0], e[1]]);
    const simp = rdpSimplify(pts, 0.000015);
    return simp;
  }

  // ==== Đồ thị tuyến nội bộ trong khuôn viên (shortest path) ====
  function buildCampusGraph() {
    const nodes = new Map();
    const poiTable = {
      "Cổng C": [10.421031, 105.641932],
      "Cổng B": [10.420366, 105.642533],
      "Tòa B1": [10.420717, 105.642506],
      "Tòa B2": [10.420904, 105.642823],
      "Tòa B3": [10.421105, 105.643024],
      "Tòa B4": [10.421303, 105.643228],
      "Tòa B5": [10.421485, 105.643474],
      "Tòa C1": [10.421712, 105.641854],
      "Tòa C2": [10.42212, 105.641495],
      "Tòa A1": [10.420419, 105.643402],
      "Tòa A4": [10.420327, 105.643968],
      "Tòa A7": [10.419032, 105.643874],
      "Tòa A8": [10.419274, 105.644832],
      "Tòa A9": [10.418984, 105.644384],
      "Tòa T1": [10.41976, 105.644797],
      "Tòa T3": [10.419385, 105.64506],
      "Tòa H1": [10.420601, 105.643611],
      "Tòa H2": [10.419686, 105.644293],
      "Tòa H3": [10.420142, 105.644641],
      "Nhà thi đấu đa năng": [10.421258, 105.642284],
      "Sân pickleball": [10.421511, 105.642616],
      "Sân basketball": [10.421696, 105.642917],
      "Sân soccer": [10.420825, 105.644397],
      "Khu thí nghiệm": [10.420781, 105.644899],
      "Giảng đường A": [10.419691, 105.643799],
      "Thư viện": [10.42106, 105.64377],
      "Ký túc xá": [10.421669, 105.643866],
      "Hiệu bộ": [10.420409, 105.642938],
      "Nhà xe cổng B": [10.421197, 105.64389],
      "Nhà xe cổng C": [10.421073, 105.64245],
      "Trường mẫu giáo": [10.418921, 105.644955],
      "Hồ bơi": [10.422321, 105.640886],
    };
    for (const [nm, ll] of Object.entries(poiTable))
      nodes.set(nm, { lat: ll[0], lng: ll[1] });

    const E = [
      ["Cổng C", "Nhà xe cổng C"],
      ["Cổng C", "Tòa C1"],
      ["Tòa C1", "Tòa C2"],
      ["Nhà xe cổng C", "Tòa B2"],
      ["Tòa B2", "Tòa B1"],
      ["Tòa B2", "Tòa B3"],
      ["Tòa B3", "Tòa B4"],
      ["Tòa B4", "Tòa B5"],
      ["Cổng B", "Tòa B1"],
      ["Cổng B", "Hiệu bộ"],
      ["Hiệu bộ", "Tòa B1"],
      ["Tòa B1", "Tòa A1"],
      ["Tòa A1", "Tòa H1"],
      ["Tòa H1", "Thư viện"],
      ["Thư viện", "Tòa B4"],
      ["Thư viện", "Nhà xe cổng B"],
      ["Tòa B4", "Tòa B5"],
      ["Nhà xe cổng B", "Tòa B3"],
      ["Tòa A1", "Tòa A4"],
      ["Tòa A4", "Giảng đường A"],
      ["Giảng đư��ng A", "Tòa A7"],
      ["Tòa A7", "Tòa A9"],
      ["Giảng đường A", "Tòa H2"],
      ["Tòa H2", "Tòa H3"],
      ["Tòa H2", "Tòa A8"],
      ["Tòa A8", "Tòa T1"],
      ["Tòa T1", "Tòa T3"],
      ["Tòa A8", "Tòa A9"],
      ["Tòa T3", "Trường mẫu giáo"],
      ["Tòa B4", "Sân basketball"],
      ["Sân basketball", "Tòa B5"],
      ["Sân basketball", "Sân pickleball"],
      ["Ký túc xá", "Tòa B5"],
      ["Ký túc xá", "Thư viện"],
      ["Tòa T1", "Khu thí nghiệm"],
      ["Khu thí nghiệm", "Sân soccer"],
    ];

    const adj = new Map();
    for (const [a, b] of E) {
      if (!nodes.has(a) || !nodes.has(b)) continue;
      const A = nodes.get(a),
        B = nodes.get(b);
      const w = haversineMeters(A.lat, A.lng, B.lat, B.lng);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({ to: b, weight: w });
      adj.get(b).push({ to: a, weight: w });
    }
    return { nodes, adj };
  }

  const CAMPUS_ROUTER_NEAR_NODE_M = 350; // khoảng cách coi là "gần" mạng lưới

  function findNearestGraphNode(graph, lat, lng) {
    let name = null,
      best = Infinity;
    for (const [nm, ll] of graph.nodes.entries()) {
      const d = haversineMeters(lat, lng, ll.lat, ll.lng);
      if (d < best) {
        best = d;
        name = nm;
      }
    }
    return { name, dist: best };
  }

  function dijkstraShortestPath(graph, src, dst) {
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const k of graph.nodes.keys()) dist.set(k, Infinity);
    dist.set(src, 0);

    while (visited.size < graph.nodes.size) {
      let u = null,
        best = Infinity;
      for (const [k, v] of dist.entries()) {
        if (visited.has(k)) continue;
        if (v < best) {
          best = v;
          u = k;
        }
      }
      if (u == null || best === Infinity) break;
      visited.add(u);
      if (u === dst) break;
      const neighbors = graph.adj.get(u) || [];
      for (const nb of neighbors) {
        const alt = dist.get(u) + nb.weight;
        if (alt < dist.get(nb.to)) {
          dist.set(nb.to, alt);
          prev.set(nb.to, u);
        }
      }
    }
    if (!prev.has(dst) && src !== dst) return null;
    const path = [];
    let cur = dst;
    path.push(cur);
    while (cur !== src) {
      const p = prev.get(cur);
      if (p == null) {
        break;
      }
      path.push(p);
      cur = p;
    }
    path.reverse();
    return path;
  }

  function buildCoordsFromNodePath(graph, nodePath) {
    const coords = [];
    for (let i = 0; i < nodePath.length; i++) {
      const nm = nodePath[i];
      const ll = graph.nodes.get(nm);
      coords.push([ll.lat, ll.lng]);
    }
    return coords;
  }

  function tryCampusShortestRoute(s, e) {
    const graph = buildCampusGraph();
    const ns = findNearestGraphNode(graph, s[0], s[1]);
    const ne = findNearestGraphNode(graph, e[0], e[1]);
    if (
      ns.dist > CAMPUS_ROUTER_NEAR_NODE_M &&
      ne.dist > CAMPUS_ROUTER_NEAR_NODE_M
    )
      return null;
    const nodePath = dijkstraShortestPath(graph, ns.name, ne.name);
    if (!nodePath || nodePath.length < 1) return null;
    const routeCoords = [];
    routeCoords.push([s[0], s[1]]);
    const body = buildCoordsFromNodePath(graph, nodePath);
    for (const c of body) routeCoords.push(c);
    routeCoords.push([e[0], e[1]]);
    return routeCoords;
  }

  function nearestIndexAndDistanceOnManualPath(lat, lng) {
    let bestIdx = -1,
      best = Infinity;
    for (let i = 0; i < CAMPUS_MANUAL_PATH.length; i++) {
      const [pLat, pLng] = CAMPUS_MANUAL_PATH[i];
      const d = haversineMeters(lat, lng, pLat, pLng);
      if (d < best) {
        best = d;
        bestIdx = i;
      }
    }
    return { idx: bestIdx, dist: best };
  }

  function sliceManualPath(i, j) {
    if (i === j) return null;
    const a = Math.min(i, j),
      b = Math.max(i, j);
    return CAMPUS_MANUAL_PATH.slice(a, b + 1);
  }

  // Ngưỡng snap lên tuyến tím (nới lỏng để ưu tiên tuyến nội bộ)
  const MANUAL_SNAP_THRESHOLD_M = 800;

  // Xây coords theo kiểu: [start] + [đoạn tuyến tím giữa 2 nút gần nhất] + [end]
  function buildSnappedManualRouteCoords(s, e) {
    if (!Array.isArray(s) || !Array.isArray(e)) return null;
    const ns = nearestIndexAndDistanceOnManualPath(s[0], s[1]);
    const ne = nearestIndexAndDistanceOnManualPath(e[0], e[1]);
    if (ns.idx < 0 || ne.idx < 0) return null;
    const bothFar =
      ns.dist > MANUAL_SNAP_THRESHOLD_M && ne.dist > MANUAL_SNAP_THRESHOLD_M;
    if (bothFar) return null;
    if (ns.idx === ne.idx) {
      const node = CAMPUS_MANUAL_PATH[ns.idx];
      if (!node) return null;
      return [
        [s[0], s[1]],
        [node[0], node[1]],
        [e[0], e[1]],
      ];
    }
    const seg = sliceManualPath(ns.idx, ne.idx);
    if (!Array.isArray(seg) || seg.length < 2)
      return [
        [s[0], s[1]],
        [e[0], e[1]],
      ];
    return [[s[0], s[1]], ...seg, [e[0], e[1]]];
  }

  function _normLabel(s) {
    return String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
  }

  // Nếu tên start/end trùng các điểm trong CAMPUS_PATH_ORDER, xây dựng polyline đi theo thứ tự đã định.
  function buildManualPathFromLabels(startLabel, endLabel) {
    const a = _normLabel(startLabel),
      b = _normLabel(endLabel);
    if (!a || !b) return null;
    const i = CAMPUS_PATH_ORDER.findIndex((p) => _normLabel(p.name) === a);
    const j = CAMPUS_PATH_ORDER.findIndex((p) => _normLabel(p.name) === b);
    if (i === -1 || j === -1 || i === j) return null;
    const segment =
      i <= j
        ? CAMPUS_PATH_ORDER.slice(i, j + 1)
        : CAMPUS_PATH_ORDER.slice(j, i + 1).reverse();
    return segment.map((p) => [p.lat, p.lng]);
  }

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000; // m
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const la1 = toRad(lat1);
    const la2 = toRad(lat2);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function totalPathDistanceMeters(coords) {
    let sum = 0;
    for (let k = 1; k < coords.length; k++) {
      const [aLat, aLng] = coords[k - 1];
      const [bLat, bLng] = coords[k];
      sum += haversineMeters(aLat, aLng, bLat, bLng);
    }
    return sum;
  }

  // Vẽ tuyến thủ công (màu tím) — sửa để không gây "nhảy", vẽ trên các pane đã tạo
  function drawManualRouteCoords(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return;
    if (routeLine) {
      removeLayerIfExists(routeLine);
      routeLine = null;
    }

    routeLine = L.layerGroup();
    const outline = L.polyline(coords, {
      pane: "visualBasePane",
      color: "rgba(0,0,0,0.18)",
      weight: 8,
      opacity: 0.9,
      interactive: false,
      lineJoin: "round",
    });
    const main = L.polyline(coords, {
      pane: "visualCenterPane",
      color: "#7c3aed",
      weight: 6,
      opacity: 0.98,
      interactive: false,
      lineJoin: "round",
    });
    routeLine.addLayer(outline);
    routeLine.addLayer(main);
    routeLine.addTo(map);

    // Không fitBounds tự động mỗi lần chọn — chỉ pan nhẹ tới centroid nếu cần
    try {
      const bounds = L.featureGroup([main]).getBounds();
      if (bounds && bounds.isValid()) {
        const mapCenter = map.getCenter();
        if (!bounds.contains(mapCenter)) {
          const c = bounds.getCenter();
          map.panTo(c, { animate: true, duration: 0.6 });
        }
      }
    } catch (e) {}

    const dist = totalPathDistanceMeters(coords);
    const speedMps = 1.2; // ~4.3 km/h
    const dur = dist / speedMps;
    renderRouteInfo({ distance: dist, duration: dur });
    if (startMarker) {
      removeLayerIfExists(startMarker);
      startMarker = null;
    }
    if (endMarker) {
      removeLayerIfExists(endMarker);
      endMarker = null;
    }
  }

  // Tính toán và vẽ lộ trình (OSRM)
  async function computeAndRenderRoute() {
    reachedDestination = false;
    const s = await resolveInputCoords(startEl);
    const e = await resolveInputCoords(endEl);

    // Ưu tiên 0: Beeline A* nội bộ khuôn viên (chỉ khi cả hai điểm gần khuôn viên)
    const campusCenter = { lat: 10.4209, lng: 105.6439 };
    const nearCampus =
      distanceMeters({ lat: s[0], lng: s[1] }, campusCenter) < 1200 &&
      distanceMeters({ lat: e[0], lng: e[1] }, campusCenter) < 1200;
    if (nearCampus) {
      // 1) thử bắt tuyến tím (CAMPUS_MANUAL_PATH)
      const manualSnap = buildSnappedManualRouteCoords(s, e);
      if (manualSnap) {
        drawManualRouteCoords(manualSnap);
        return;
      }
      // 2) thử lưới walkway (dùng cả CUSTOM_VISUAL_PATHS)
      const walkCoords = tryWalkwayRoute(s, e);
      if (Array.isArray(walkCoords) && walkCoords.length >= 2) {
        const simp = rdpSimplify(walkCoords, 0.000012);
        drawManualRouteCoords(simp);
        return;
      }
      // 3) fallback A* grid
      const gridCoords = tryBeelineGridRoute(s, e);
      if (Array.isArray(gridCoords) && gridCoords.length >= 2) {
        drawManualRouteCoords(gridCoords);
        return;
      }
    }

    if (!Array.isArray(s) || !Array.isArray(e))
      throw new Error(
        "Vui lòng nhập địa chỉ hoặc toạ độ hợp lệ cho cả hai điểm."
      );

    // Cập nhật marker start/end (không kích hoạt tìm lại trong khi đang tính)
    programmaticUpdate = true;
    setAsStart({ lat: s[0], lng: s[1] });
    setAsEnd({ lat: e[0], lng: e[1] });
    programmaticUpdate = false;

    if (routeLine) {
      removeLayerIfExists(routeLine);
      routeLine = null;
    }

    const url = new URL(
      `https://router.project-osrm.org/route/v1/driving/${s[1]},${s[0]};${e[1]},${e[0]}`
    );
    url.searchParams.set("overview", "full");
    url.searchParams.set("geometries", "geojson");
    url.searchParams.set("alternatives", "false");
    url.searchParams.set("steps", "false");

    const data = await fetchJsonWithTimeout(url.toString());
    if (
      !data ||
      data.code !== "Ok" ||
      !Array.isArray(data.routes) ||
      !data.routes.length
    ) {
      throw new Error("Không tìm thấy tuyến phù hợp.");
    }

    const route = data.routes[0];

    routeLine = L.geoJSON(route.geometry, {
      style: { color: "#22d3ee", weight: 6, opacity: 0.9 },
    }).addTo(map);

    const b = routeLine.getBounds();
    if (b && typeof b.isValid === "function" && b.isValid())
      map.fitBounds(b, { padding: [28, 28] });

    renderRouteInfo({ distance: route.distance, duration: route.duration });

    // Ẩn chấm start/end sau khi có tuyến để chỉ còn lại đường đi
    if (startMarker) {
      removeLayerIfExists(startMarker);
      startMarker = null;
    }
    if (endMarker) {
      removeLayerIfExists(endMarker);
      endMarker = null;
    }
  }

  // Đưa map về khu vực khuôn viên
  async function centerToCampus() {
    try {
      const pref = await geocodeDetails(
        "Đại học Đồng Tháp, Cao Lãnh, Đồng Tháp, Việt Nam"
      );
      if (pref.boundingbox?.length === 4) {
        const [south, north, west, east] = pref.boundingbox.map(parseFloat);
        map.fitBounds(
          [
            [south, west],
            [north, east],
          ],
          { maxZoom: 18, padding: [20, 20] }
        );
        return;
      }
      map.setView([parseFloat(pref.lat), parseFloat(pref.lon)], 17);
    } catch {
      map.setView([10.4559, 105.6331], 15);
    }
  }
});

// ======= Định tuyến thông minh trong khuôn viên (dùng CUSTOM_VISUAL_PATHS làm đồ thị) =======

// Xây dựng đồ thị từ CUSTOM_VISUAL_PATHS: mỗi node là một toạ độ duy nhất, cạnh có trọng số là khoảng cách mét
function buildCampusGraph() {
  // Danh sách node, mỗi node là {lat, lng}
  const nodes = [];
  // Hàm tạo key duy nhất cho mỗi toạ độ (làm tròn 6 chữ số thập phân)
  const keyOf = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6);
  const idxMap = new Map();
  // Thêm node mới nếu chưa có, trả về id node
  const addNode = (p) => {
    const k = keyOf(p);
    if (idxMap.has(k)) return idxMap.get(k);
    const id = nodes.length;
    nodes.push({ lat: p[0], lng: p[1] });
    idxMap.set(k, id);
    return id;
  };
  // edges: id -> [{to, w, pts: [p0,p1]}], lưu cạnh và trọng số (w = mét)
  const edges = {};
  // Thêm cạnh hai chiều giữa hai node
  const pushEdge = (a, b, w, pts) => {
    edges[a] = edges[a] || [];
    edges[a].push({ to: b, w: w, pts });
  };
  // Tính khoảng cách mét giữa hai điểm lat/lng
  const meters = (a, b) => {
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat),
      dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat),
      lat2 = toRad(b.lat);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };
  // Duyệt qua từng đoạn đường trong CUSTOM_VISUAL_PATHS để thêm node và cạnh
  (CUSTOM_VISUAL_PATHS || []).forEach((seg) => {
    for (let i = 0; i < seg.length - 1; i++) {
      const a = seg[i],
        b = seg[i + 1];
      const ia = addNode(a),
        ib = addNode(b);
      const w = meters({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
      pushEdge(ia, ib, w, [a, b]);
      pushEdge(ib, ia, w, [b, a]);
    }
  });
  return { nodes, edges, idxMap };
}

// Tìm node gần nhất trong đồ thị với một toạ độ bất kỳ
function nearestGraphNode(graph, latlng) {
  let best = -1,
    bestD = Infinity;
  graph.nodes.forEach((n, i) => {
    // Dùng khoảng cách Euclid (tương đối nhanh, đủ chính xác cho campus nhỏ)
    const d = Math.hypot(n.lat - latlng.lat, n.lng - latlng.lng);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

// Thuật toán Dijkstra đơn giản để tìm đường ngắn nhất giữa hai node trong đồ thị
function dijkstra(graph, sourceIdx, targetIdx) {
  const N = graph.nodes.length;
  const dist = new Array(N).fill(Infinity); // Khoảng cách ngắn nhất từ source
  const prev = new Array(N).fill(-1); // Lưu node trước đó trên đường đi
  const vis = new Array(N).fill(false); // Đánh dấu đã thăm
  dist[sourceIdx] = 0;
  for (let iter = 0; iter < N; iter++) {
    let u = -1,
      best = Infinity;
    for (let i = 0; i < N; i++)
      if (!vis[i] && dist[i] < best) {
        best = dist[i];
        u = i;
      }
    if (u === -1) break; // Không còn node nào để duyệt
    vis[u] = true;
    if (u === targetIdx) break; // Đã đến đích
    const adj = graph.edges[u] || [];
    for (const e of adj) {
      const v = e.to;
      const nd = dist[u] + e.w;
      if (nd < dist[v]) {
        dist[v] = nd;
        prev[v] = u;
      }
    }
  }
  if (!isFinite(dist[targetIdx])) return null; // Không tìm được đường đi
  const path = [];
  for (let u = targetIdx; u != -1; u = prev[u]) path.push(u);
  path.reverse();
  return path;
}

// Chuyển một đường đi (danh sách chỉ số node) thành mảng toạ độ lat/lng (nối các đoạn)
function graphPathToLatLngs(graph, path) {
  const pts = [];
  for (let k = 0; k < path.length - 1; k++) {
    const u = path[k],
      v = path[k + 1];
    // Tìm cạnh u->v để lấy toạ độ chi tiết
    const arr = graph.edges[u] || [];
    let edge = arr.find((e) => e.to === v);
    if (edge && edge.pts) {
      if (
        pts.length &&
        pts[pts.length - 1][0] === edge.pts[0][0] &&
        pts[pts.length - 1][1] === edge.pts[0][1]
      ) {
        // Nếu điểm đầu trùng, chỉ thêm điểm cuối
        pts.push([edge.pts[1][0], edge.pts[1][1]]);
      } else {
        // Thêm cả hai điểm
        pts.push([edge.pts[0][0], edge.pts[0][1]]);
        pts.push([edge.pts[1][0], edge.pts[1][1]]);
      }
    } else {
      // Nếu không có cạnh chi tiết, chỉ lấy node
      pts.push([graph.nodes[u].lat, graph.nodes[u].lng]);
      pts.push([graph.nodes[v].lat, graph.nodes[v].lng]);
    }
  }
  // Loại bỏ các điểm trùng liên tiếp
  const clean = pts.filter(
    (p, i) => i === 0 || !(p[0] === pts[i - 1][0] && p[1] === pts[i - 1][1])
  );
  return clean;
}

// Kiểm tra một toạ độ có nằm trong khuôn viên không (dùng maxBounds của map làm proxy)
function pointInCampus(latlng) {
  if (!map) return false;
  const b = map.options.maxBounds;
  if (!b) return true;
  const sw = b[0],
    ne = b[1];
  return (
    latlng.lat >= Math.min(sw[0], ne[0]) &&
    latlng.lat <= Math.max(sw[0], ne[0]) &&
    latlng.lng >= Math.min(sw[1], ne[1]) &&
    latlng.lng <= Math.max(sw[1], ne[1])
  );
}

// Vẽ đường đi chỉ trong khuôn viên bằng Dijkstra trên đồ thị campus
function drawCampusPath(startLatLng, endLatLng) {
  // Nếu không có dữ liệu đường campus thì fallback sang OSRM
  if (!CUSTOM_VISUAL_PATHS || !CUSTOM_VISUAL_PATHS.length) {
    return computeAndRenderRoute(
      startLatLng.lat,
      startLatLng.lng,
      endLatLng.lat,
      endLatLng.lng
    );
  }
  // Xây đồ thị và tìm node gần nhất với điểm đầu/cuối
  const graph = buildCampusGraph();
  const sIdx = nearestGraphNode(graph, startLatLng);
  const eIdx = nearestGraphNode(graph, endLatLng);
  if (sIdx === -1 || eIdx === -1)
    return computeAndRenderRoute(
      startLatLng.lat,
      startLatLng.lng,
      endLatLng.lat,
      endLatLng.lng
    );

  // Tìm đường đi ngắn nhất
  const pathIdx = dijkstra(graph, sIdx, eIdx);
  if (!pathIdx)
    return computeAndRenderRoute(
      startLatLng.lat,
      startLatLng.lng,
      endLatLng.lat,
      endLatLng.lng
    );

  // Chuyển đường đi thành mảng toạ độ
  const latlngs = graphPathToLatLngs(graph, pathIdx);

  // Nếu điểm đầu/cuối không trùng node thì thêm vào đầu/cuối
  if (
    latlngs.length &&
    (latlngs[0][0] !== startLatLng.lat || latlngs[0][1] !== startLatLng.lng)
  ) {
    latlngs.unshift([startLatLng.lat, startLatLng.lng]);
  }
  if (
    latlngs.length &&
    (latlngs[latlngs.length - 1][0] !== endLatLng.lat ||
      latlngs[latlngs.length - 1][1] !== endLatLng.lng)
  ) {
    latlngs.push([endLatLng.lat, endLatLng.lng]);
  }

  // Vẽ polyline lên bản đồ
  if (routeLine) removeLayerIfExists(routeLine);
  routeLine = L.polyline(latlngs, {
    color: "#16a34a",
    weight: 5,
    opacity: 0.9,
  }).addTo(map);
  map.fitBounds(routeLine.getBounds());
  renderRouteInfo({ distance: null, duration: null });
}

// Vẽ đường đi kết hợp campus + ngoài khuôn viên (OSRM)
// Chiến lược:
// - Nếu điểm đầu trong campus, điểm cuối ngoài campus: nối start -> node gần biên campus -> node exit campus
// - Gọi OSRM từ node exit đến điểm ngoài, sau đó ghép lại với đường nội bộ
async function drawMixedPath(startLatLng, endLatLng) {
  try {
    const graph = buildCampusGraph();
    const sIdx = nearestGraphNode(graph, startLatLng);
    // Chọn node exit gần biên campus nhất (heuristic: gần tâm bản đồ)
    const exitIdx = (() => {
      let best = -1,
        bestD = Infinity;
      const center = map.getCenter();
      graph.nodes.forEach((n, i) => {
        const d = Math.hypot(n.lat - center.lat, n.lng - center.lng);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      return best;
    })();
    // Nếu điểm cuối vẫn trong campus thì chỉ vẽ campus
    if (pointInCampus(endLatLng)) return drawCampusPath(startLatLng, endLatLng);

    // Tính đường nội bộ từ start -> exit
    const pathIdx = dijkstra(graph, sIdx, exitIdx);
    const internalLatLngs = pathIdx
      ? graphPathToLatLngs(graph, pathIdx)
      : [[startLatLng.lat, startLatLng.lng]];

    // Gọi OSRM từ node exit đến điểm ngoài
    const exitNode = graph.nodes[exitIdx];
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${exitNode.lng},${exitNode.lat};${endLatLng.lng},${endLatLng.lat}?overview=full&geometries=geojson`;
    const res = await fetch(osrmUrl);
    const data = await res.json();
    if (!data.routes || !data.routes.length)
      throw new Error("OSRM route failed");
    const extCoords = data.routes[0].geometry.coordinates.map((c) => [
      c[1],
      c[0],
    ]);

    // Ghép đường nội bộ và đường ngoài lại
    const stitched = internalLatLngs.concat(extCoords);
    if (routeLine) removeLayerIfExists(routeLine);
    routeLine = L.polyline(stitched, {
      color: "#1e40af",
      weight: 5,
      opacity: 0.9,
    }).addTo(map);
    map.fitBounds(routeLine.getBounds());
    renderRouteInfo({
      distance: data.routes[0].distance,
      duration: data.routes[0].duration,
    });
  } catch (e) {
    console.warn("drawMixedPath error", e);
    // Nếu lỗi thì fallback sang OSRM thường
    return computeAndRenderRoute(
      startLatLng.lat,
      startLatLng.lng,
      endLatLng.lat,
      endLatLng.lng
    );
  }
}

// Hàm tìm đường thông minh: nhận start/end là {lat, lng} hoặc đọc từ input
async function findSmartRoute(start, end) {
  try {
    // Lấy toạ độ từ input nếu chưa truyền vào
    let s = start,
      t = end;
    if (!s)
      s =
        startEl && startEl.dataset.lat && startEl.dataset.lng
          ? {
              lat: parseFloat(startEl.dataset.lat),
              lng: parseFloat(startEl.dataset.lng),
            }
          : parseLatLng(startEl?.value);
    if (!t)
      t =
        endEl && endEl.dataset.lat && endEl.dataset.lng
          ? {
              lat: parseFloat(endEl.dataset.lat),
              lng: parseFloat(endEl.dataset.lng),
            }
          : parseLatLng(endEl?.value);
    if (!s || !t) {
      showCenterNotice("Cần cả xuất phát và điểm đến", "error");
      return;
    }

    // Nếu cả hai điểm đều trong campus thì vẽ đường campus, ngược lại vẽ kết hợp
    if (pointInCampus(s) && pointInCampus(t)) {
      drawCampusPath(s, t);
    } else {
      await drawMixedPath(s, t);
    }
  } catch (e) {
    console.error("findSmartRoute", e);
    // Nếu lỗi thì fallback sang OSRM thường
    if (typeof computeAndRenderRoute === "function") {
      return computeAndRenderRoute(s.lat, s.lng, t.lat, t.lng);
    }
  }
}

// Ghi đè guardedFindRoute để dùng định tuyến thông minh
const _orig_guarded = guardedFindRoute;
guardedFindRoute = async function () {
  if (!hasBothInputs()) {
    setLoading(true);
    setLoading(false, {
      onHidden: () =>
        showCenterNotice("Vui lòng chọn điểm xuất phát và điểm đến.", "warn"),
    });
    return;
  }
  setLoading(true);
  try {
    await findSmartRoute();
  } catch (e) {
    console.error(e);
    alert("Lỗi khi tính tuyến");
  } finally {
    setLoading(false);
  }
};

// xuli_internal_route_optimized.js
// Tối ưu hóa định tuyến nội bộ bằng CUSTOM_VISUAL_PATHS (<40 đoạn)
// - Dùng Dijkstra (tối ưu cho đồ thị nhỏ)
// - Làm mượt đường bằng Chaikin subdivision (có thể cấu hình số lần lặp)
// - Vẽ tuyến đường màu xanh (#2563eb) và cập nhật #route-info với khoảng cách/thời gian
// - Không dùng API ngoài. Thiết kế để tích hợp với UI helper của xuli.js.

(function () {
  "use strict";
  if (typeof CUSTOM_VISUAL_PATHS === "undefined") CUSTOM_VISUAL_PATHS = [];

  // --- hàm tiện ích ---
  const toRad = (v) => (v * Math.PI) / 180;
  const hav = (a, b) => {
    const R = 6371000;
    const dLat = toRad(b[0] - a[0]),
      dLng = toRad(b[1] - a[1]);
    const lat1 = toRad(a[0]),
      lat2 = toRad(b[0]);
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  };

  // --- xây đồ thị dạng gọn ---
  function buildGraph() {
    const nodes = []; // [ [lat,lng] ]
    const idMap = new Map(); // key -> id
    const edges = []; // danh sách kề: mảng các mảng {to,w,pts}

    const key = (p) => p[0].toFixed(6) + "," + p[1].toFixed(6);
    const addNode = (p) => {
      const k = key(p);
      if (idMap.has(k)) return idMap.get(k);
      const id = nodes.length;
      nodes.push([p[0], p[1]]);
      idMap.set(k, id);
      edges[id] = [];
      return id;
    };

    (CUSTOM_VISUAL_PATHS || []).forEach((seg) => {
      if (!Array.isArray(seg) || seg.length < 2) return;
      for (let i = 0; i < seg.length - 1; i++) {
        const a = seg[i],
          b = seg[i + 1];
        const ia = addNode(a),
          ib = addNode(b);
        const w = hav(a, b);
        edges[ia].push({
          to: ib,
          w,
          pts: [
            [a[0], a[1]],
            [b[0], b[1]],
          ],
        });
        edges[ib].push({
          to: ia,
          w,
          pts: [
            [b[0], b[1]],
            [a[0], a[1]],
          ],
        });
      }
    });
    return { nodes, edges };
  }

  // tìm nút gần nhất bằng khoảng cách Euclid xấp xỉ (nhanh)
  function nearestNode(graph, latlng) {
    if (!graph || !graph.nodes || !graph.nodes.length) return -1;
    let best = -1,
      bd = Infinity;
    for (let i = 0; i < graph.nodes.length; i++) {
      const n = graph.nodes[i];
      const d =
        (n[0] - latlng.lat) * (n[0] - latlng.lat) +
        (n[1] - latlng.lng) * (n[1] - latlng.lng);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  // Thuật toán Dijkstra tối ưu cho đồ thị nhỏ (<200 nút)
  function dijkstra(graph, src, dst) {
    const N = graph.nodes.length;
    const dist = new Array(N).fill(Infinity);
    const prev = new Array(N).fill(-1);
    const used = new Array(N).fill(false);
    dist[src] = 0;
    for (;;) {
      let u = -1,
        best = Infinity;
      for (let i = 0; i < N; i++)
        if (!used[i] && dist[i] < best) {
          best = dist[i];
          u = i;
        }
      if (u === -1) break;
      if (u === dst) break;
      used[u] = true;
      const adj = graph.edges[u] || [];
      for (let j = 0; j < adj.length; j++) {
        const e = adj[j];
        const nd = dist[u] + e.w;
        if (nd < dist[e.to]) {
          dist[e.to] = nd;
          prev[e.to] = u;
        }
      }
    }
    if (!isFinite(dist[dst])) return null;
    const path = [];
    for (let v = dst; v !== -1; v = prev[v]) path.push(v);
    path.reverse();
    return path;
  }

  // chuyển path dạng id -> latlng bằng pts lưu trong cạnh
  function pathToLatLngs(graph, path) {
    const out = [];
    for (let k = 0; k < path.length - 1; k++) {
      const u = path[k],
        v = path[k + 1];
      const adj = graph.edges[u] || [];
      let e = null;
      for (let i = 0; i < adj.length; i++)
        if (adj[i].to === v) {
          e = adj[i];
          break;
        }
      if (e && e.pts) {
        if (
          out.length === 0 ||
          out[out.length - 1][0] !== e.pts[0][0] ||
          out[out.length - 1][1] !== e.pts[0][1]
        )
          out.push([e.pts[0][0], e.pts[0][1]]);
        out.push([e.pts[1][0], e.pts[1][1]]);
      } else {
        // fallback: lấy từ nodes
        const na = graph.nodes[u],
          nb = graph.nodes[v];
        if (
          out.length === 0 ||
          out[out.length - 1][0] !== na[0] ||
          out[out.length - 1][1] !== na[1]
        )
          out.push([na[0], na[1]]);
        out.push([nb[0], nb[1]]);
      }
    }
    // bỏ trùng lặp liên tiếp
    const clean = out.filter(
      (p, i) => i === 0 || !(p[0] === out[i - 1][0] && p[1] === out[i - 1][1])
    );
    return clean;
  }

  // Làm mượt bằng Chaikin subdivision (mặc định 2 lần lặp -> rất mượt)
  function smoothChaikin(points, iterations) {
    iterations = iterations == null ? 2 : iterations;
    if (!points || points.length < 3) return points;
    let pts = points.map((p) => [p[0], p[1]]);
    for (let it = 0; it < iterations; it++) {
      const next = [];
      next.push(pts[0]); // giữ điểm đầu
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i],
          q = pts[i + 1];
        const Q = [0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]];
        const R = [0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]];
        next.push(Q);
        next.push(R);
      }
      next.push(pts[pts.length - 1]); // giữ điểm cuối
      pts = next;
    }
    return pts;
  }

  // Tính tổng khoảng cách (mét) từ danh sách latlng
  function totalDistance(latlngs) {
    let s = 0;
    for (let i = 0; i < latlngs.length - 1; i++)
      s += hav(latlngs[i], latlngs[i + 1]);
    return s;
  }

  // Hàm chính: tìm và vẽ đường nội bộ
  function findAndDrawInternal(start, end) {
    try {
      if (!map) {
        console.warn("map undefined");
        return;
      }
      if (!start || !end) {
        showCenterNotice &&
          showCenterNotice("Cần cả điểm xuất phát và điểm đến", "error");
        return;
      }
      const graph = buildGraph();
      if (!graph.nodes.length) {
        showCenterNotice && showCenterNotice("Không có đường nội bộ", "error");
        return;
      }
      const sIdx = nearestNode(graph, start);
      const eIdx = nearestNode(graph, end);
      if (sIdx < 0 || eIdx < 0) {
        showCenterNotice &&
          showCenterNotice("Không tìm được nút gần vị trí", "error");
        return;
      }
      const pidx = dijkstra(graph, sIdx, eIdx);
      if (!pidx) {
        showCenterNotice &&
          showCenterNotice("Không tìm được tuyến nối hai điểm", "error");
        return;
      }
      let latlngs = pathToLatLngs(graph, pidx);
      // nối điểm thực tế nếu không trùng nút
      if (
        latlngs.length &&
        (latlngs[0][0] !== start.lat || latlngs[0][1] !== start.lng)
      )
        latlngs.unshift([start.lat, start.lng]);
      if (
        latlngs.length &&
        (latlngs[latlngs.length - 1][0] !== end.lat ||
          latlngs[latlngs.length - 1][1] !== end.lng)
      )
        latlngs.push([end.lat, end.lng]);

      // làm mượt
      const smooth = smoothChaikin(latlngs, 2);

      // lọc điểm trùng gần kề để nhẹ polyline
      const reduced = [smooth[0]];
      for (let i = 1; i < smooth.length; i++) {
        const a = reduced[reduced.length - 1],
          b = smooth[i];
        if (Math.hypot(a[0] - b[0], a[1] - b[1]) > 1e-6) reduced.push(b);
      }

      // vẽ
      try {
        if (typeof routeLine !== "undefined" && routeLine)
          removeLayerIfExists(routeLine);
      } catch (e) {}
      routeLine = L.polyline(
        reduced.map((p) => [p[0], p[1]]),
        { color: "#2563eb", weight: 6, opacity: 0.95, lineJoin: "round" }
      ).addTo(map);
      map.fitBounds(routeLine.getBounds(), { padding: [28, 28] });

      // cập nhật thông tin tuyến
      const meters = totalDistance(reduced);
      renderRouteInfo &&
        renderRouteInfo({ distance: meters, duration: meters / 1.2 });
    } catch (err) {
      console.error("findAndDrawInternal error", err);
      showCenterNotice &&
        showCenterNotice("Lỗi khi tính đường nội bộ", "error");
    }
  }

  // Ghi đè guardedFindRoute để dùng định tuyến nội bộ
  const _orig =
    typeof guardedFindRoute === "function" ? guardedFindRoute : null;
  guardedFindRoute = async function () {
    if (!hasBothInputs()) {
      setLoading(true);
      setLoading(false, {
        onHidden: () =>
          showCenterNotice &&
          showCenterNotice("Vui lòng chọn điểm xuất phát và điểm đến.", "warn"),
      });
      return;
    }
    setLoading(true);
    try {
      const s =
        startEl && startEl.dataset.lat && startEl.dataset.lng
          ? {
              lat: parseFloat(startEl.dataset.lat),
              lng: parseFloat(startEl.dataset.lng),
            }
          : parseLatLng(startEl?.value)
          ? {
              lat: parseLatLng(startEl.value)[0],
              lng: parseLatLng(startEl.value)[1],
            }
          : null;
      const t =
        endEl && endEl.dataset.lat && endEl.dataset.lng
          ? {
              lat: parseFloat(endEl.dataset.lat),
              lng: parseFloat(endEl.dataset.lng),
            }
          : parseLatLng(endEl?.value)
          ? {
              lat: parseLatLng(endEl.value)[0],
              lng: parseLatLng(endEl.value)[1],
            }
          : null;
      if (!s || !t) {
        showCenterNotice &&
          showCenterNotice("Cần cả xuất phát và điểm đến", "error");
        return;
      }
      findAndDrawInternal(s, t);
    } catch (e) {
      console.error(e);
      showCenterNotice && showCenterNotice("Lỗi khi tìm đường", "error");
    } finally {
      setLoading(false);
    }
  };

  // expose cho console/test
  window.findAndDrawInternal = findAndDrawInternal;
  window.buildInternalGraph = buildGraph;
})();
