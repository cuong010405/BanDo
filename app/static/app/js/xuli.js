/**
 * xuli.js – Bản đồ + Geocode + Tìm đường (OSRM)
 * - Khởi tạo Leaflet (OSM tile), polygon khuôn viên, POIs và overlay thông tin.
 * - Nhập địa chỉ hoặc "lat, lng". Geocode bằng Nominatim. Tìm đường bằng OSRM.
 * - Bổ sung đầy đủ hàm tiện ích bị thiếu: removeLayerIfExists, setHighlightMarker, computeAndRenderRoute...
 */

document.addEventListener('DOMContentLoaded', function () {
  // ====== Phần tử giao diện ======
  const mapEl = document.getElementById('map');
  const startEl = document.getElementById('start');
  const endEl = document.getElementById('end');
  const modeEl = document.getElementById('mode'); // nếu không có cũng không sao
  const routeInfoEl = document.getElementById('route-info');
  const findBtn = document.querySelector('.form-nhap button');
  const campusPlaceEl = document.getElementById('campus-place'); // tùy chọn
  const campusSetStartBtn = document.getElementById('campus-set-start'); // tùy chọn
  const campusSetEndBtn = document.getElementById('campus-set-end'); // tùy chọn

  // ====== Trạng thái runtime ======
  let map, startMarker, endMarker, routeLine, highlightMarker, campusPolygon, campusPoiLayer;
  let inFlight = null;
  let programmaticUpdate = false; // tránh gọi tìm đường lặp khi cập nhật marker bằng code
  // Theo dõi vị trí người dùng khi di chuyển
  let userWatchId = null;
  let userLocationMarker = null;
  let userAccuracyCircle = null;
  let initializedStartFromWatch = false;
  let prevUserLatLng = null;        // lưu vị trí trước đó để suy ra hướng khi thiếu heading
  let lastHeadingDeg = 0;           // góc hướng gần nhất (độ)
  let shownLowAccWarn = false;      // đã cảnh báo độ chính xác thấp chưa
  let lastAutoRouteLatLng = null;   // vị trí lần gần nhất đã tự vẽ tuyến
  let lastRouteSummary = null;     // tóm tắt tuyến OSRM/manual gần nhất
  let reachedDestination = false;  // đã tới điểm đến chưa (để không báo nhiều lần)
  // Loader state
  let loadingStartedAt = 0;
  let loadingHideTimer = null;

  // Cấu hình cảnh báo độ chính xác thấp (tắt popup cảnh báo)
  const GEO_WARN_LOW_ACCURACY = false;
  const GEO_LOW_ACCURACY_THRESHOLD_M = 150;

  // ====== Endpoints ======
  const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
  const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';

  // ====== Khởi tạo ======
  initMap();
  attachEventHandlers();

  // Xuất hàm để HTML gọi
  window.findRoute = guardedFindRoute;
  window.getCurrentLocation = getCurrentLocation;
  window.resetMap = resetMap;

  // ====== Khởi tạo bản đồ ======
  function initMap() {
    map = L.map(mapEl, {
      center: [10.4209, 105.6439],  // tâm khuôn viên
      zoom: 17,
      minZoom: 16,                  // zoom nhỏ nhất cho phép
      maxZoom: 20,                  // zoom lớn nhất cho phép

    });
    const bounds = [
    [10.4180, 105.6405],
    [10.4230, 105.6460]
  ];
  map.setMaxBounds(bounds);
  map.setMaxBoundsViscosity = 1.0; // dính chặt biên, không kéo ra ngoài

    // Lớp nền OSM
    L.tileLayer('https://cartodb-basemaps-a.global.ssl.fastly.net/light_nolabels/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; OpenStreetMap contributors &copy; Carto',
  subdomains: 'abcd',
  maxZoom: 20
}).addTo(map);


    // Vẽ polygon khuôn viên (ví dụ)
    

    initCampusPOIs();
    centerToCampus();

    // Click map -> reverse geocode -> overlay
    map.on('click', async (e) => {
      try {
        const meta = await reverseGeocode(e.latlng.lat, e.latlng.lng);
        showPlaceInfo(e.latlng, meta);
      } catch {
        showPlaceInfo(e.latlng, { display_name: `Vĩ độ ${e.latlng.lat.toFixed(6)}, Kinh độ ${e.latlng.lng.toFixed(6)}` });
      }
    });
  }

  // ====== Gắn sự kiện ======
  // ...existing code...

function attachEventHandlers() {
  // UI controls
  if (modeEl) {
    modeEl.addEventListener('change', () => { if (hasBothInputs()) guardedFindRoute(); });
  }

  [startEl, endEl].forEach((el) => {
    if (!el) return;
    el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); guardedFindRoute(); } });
    el.addEventListener('input', () => {
      clearInputDatasets(el);
      if (routeInfoEl) routeInfoEl.innerHTML = '';
    });
  });

  if (campusPlaceEl) {
    campusPlaceEl.addEventListener('change', () => {
      const coords = parseLatLng(campusPlaceEl.value.trim());
      if (!coords) return;
      const latlng = { lat: coords[0], lng: coords[1] };
      setHighlightMarker(latlng);
      map.setView([latlng.lat, latlng.lng], 18);
      showPlaceInfo(latlng, { name: campusPlaceEl.options[campusPlaceEl.selectedIndex].text });
    });
  }

  if (campusSetStartBtn) {
    campusSetStartBtn.addEventListener('click', () => {
      const coords = parseLatLng(campusPlaceEl?.value?.trim());
      if (!coords) return;
      const label = campusPlaceEl.options[campusPlaceEl.selectedIndex]?.text || '';
      setAsStart({ lat: coords[0], lng: coords[1] }, label);
    });
  }

  if (campusSetEndBtn) {
    campusSetEndBtn.addEventListener('click', () => {
      const coords = parseLatLng(campusPlaceEl?.value?.trim());
      if (!coords) return;
      const label = campusPlaceEl.options[campusPlaceEl.selectedIndex]?.text || '';
      setAsEnd({ lat: coords[0], lng: coords[1] }, label);
    });
  }

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') closeOverlay(); });
// ...existing code...
  const locBtnElem = document.getElementById('loc-btn');
  let _trackingBlink = false; // trạng thái nháy
  function startTrackingBlink() {
    if (!locBtnElem || _trackingBlink) return;
    const iconEl = locBtnElem.querySelector('i') || locBtnElem.querySelector('.sidebar-icon');
    if (!iconEl) return;
    iconEl.classList.add('blinking');
    _trackingBlink = true;
  }

  function stopTrackingBlink() {
    if (!locBtnElem || !_trackingBlink) return;
    const iconEl = locBtnElem.querySelector('i') || locBtnElem.querySelector('.sidebar-icon');
    if (!iconEl) return;
    iconEl.classList.remove('blinking');
    _trackingBlink = false;
  }

  

  // Expose để gọi từ logic theo dõi (ví dụ khi stopWatchPosition)
  window.startTrackingBlink = startTrackingBlink;
  window.stopTrackingBlink = stopTrackingBlink;
// ...existing code...


  }

  // ====== Utils ======
  function showCenterNotice(message, kind) {
    let host = document.getElementById('center-notice');
    if (!host) {
      host = document.createElement('div');
      host.id = 'center-notice';
      host.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10004;display:none;';
      const box = document.createElement('div');
      box.id = 'center-notice-box';
      box.style.cssText = 'min-width:260px;max-width:80vw;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);padding:14px 16px;text-align:center;font-weight:600;';
      host.appendChild(box);
      document.body.appendChild(host);
    }
    const box = document.getElementById('center-notice-box');
    box.textContent = message || '';
    if (kind === 'success') {
      box.style.borderColor = 'rgba(16,185,129,.45)';
      box.style.background = 'linear-gradient(180deg,#0b1220,#0f172a)';
    } else if (kind === 'error') {
      box.style.borderColor = 'rgba(239,68,68,.45)';
      box.style.background = 'linear-gradient(180deg,#0b1220,#111827)';
    } else {
      box.style.borderColor = 'rgba(234,179,8,.45)';
      box.style.background = 'linear-gradient(180deg,#0b1220,#111827)';
    }
    host.style.display = 'block';
    try { if (window.__centerNoticeTimer) clearTimeout(window.__centerNoticeTimer); } catch {}
    window.__centerNoticeTimer = setTimeout(() => { host.style.display = 'none'; }, 2200);
  }

  
  function ensureGlobalLoader() {
    let el = document.getElementById('global-loader');
    if (!el) {
      el = document.createElement('div');
      el.id = 'global-loader';
      el.style.cssText = 'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);';
      const sp = document.createElement('div');
      sp.style.cssText = 'width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#22d3ee;animation:glspin .9s linear infinite;';
      const tx = document.createElement('div');
      tx.textContent = 'Đang tìm đường...';
      tx.style.cssText = 'color:#e5e7eb;font-weight:600;';
      box.appendChild(sp);
      box.appendChild(tx);
      el.appendChild(box);
      document.body.appendChild(el);
      if (!document.getElementById('global-loader-style')) {
        const st = document.createElement('style');
        st.id = 'global-loader-style';
        st.textContent = '@keyframes glspin { to { transform: rotate(360deg); } }';
        document.head.appendChild(st);
      }
    }
    return el;
  }
  function setLoading(loading, opts = {}) {
    const loader = ensureGlobalLoader();
    const MIN_MS = 2000; // tối thiểu 2 giây
    if (loading) {
      try { if (loadingHideTimer) clearTimeout(loadingHideTimer); } catch {}
      loadingHideTimer = null;
      loadingStartedAt = Date.now();
      if (findBtn) {
        findBtn.disabled = true;
        if (!findBtn.dataset.originalText) findBtn.dataset.originalText = findBtn.innerHTML;
        findBtn.innerHTML = '<i class="fa-solid fa-route"></i> Tìm...';
      }
      loader.style.display = 'flex';
    } else {
      const hide = () => {
        loader.style.display = 'none';
        if (findBtn) {
          findBtn.disabled = false;
          if (findBtn.dataset.originalText) findBtn.innerHTML = findBtn.dataset.originalText;
        }
        if (opts && typeof opts.onHidden === 'function') {
          try { opts.onHidden(); } catch {}
        }
      };
      const elapsed = Date.now() - (loadingStartedAt || 0);
      const delay = Math.max(0, MIN_MS - elapsed);
      if (delay > 0) {
        try { if (loadingHideTimer) clearTimeout(loadingHideTimer); } catch {}
        loadingHideTimer = setTimeout(hide, delay);
      } else {
        hide();
      }
    }
  }

  function hasBothInputs() { return startEl?.value.trim() && endEl?.value.trim(); }

  function clearInputDatasets(el) { if (!el) return; delete el.dataset.lat; delete el.dataset.lng; delete el.dataset.label; }

  function formatLatLng(latlng) { return `${latlng.lat.toFixed(6)},${latlng.lng.toFixed(6)}`; }

  function parseLatLng(input) {
    if (!input) return null;
    const m = String(input).trim().match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!m) return null;
    const lat = Number(m[1]);
    const lng = Number(m[2]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return [lat, lng];
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 15000) {
    if (inFlight) try { inFlight.abort(); } catch {}
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
    const url = `${NOMINATIM_SEARCH}?format=json&limit=1&q=${encodeURIComponent(input)}`;
    const data = await fetchJsonWithTimeout(url, { headers: { 'Accept-Language': 'vi,en;q=0.8' } });
    if (!data.length) throw new Error(`Không tìm thấy: ${input}`);
    return [parseFloat(data[0].lat), parseFloat(data[0].lon)];
  }

  async function geocodeDetails(input) {
    const url = `${NOMINATIM_SEARCH}?format=json&limit=1&addressdetails=1&q=${encodeURIComponent(input)}`;
    const data = await fetchJsonWithTimeout(url, { headers: { 'Accept-Language': 'vi,en;q=0.8' } });
    if (!data.length) throw new Error(`Không tìm thấy: ${input}`);
    return data[0];
  }

  async function reverseGeocode(lat, lon) {
    const url = `${NOMINATIM_REVERSE}?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1`;
    return await fetchJsonWithTimeout(url, { headers: { 'Accept-Language': 'vi,en;q=0.8' } });
  }

  const debouncedFindRoute = debounce(() => guardedFindRoute(), 450);

  // ====== Cập nhật guardedFindRoute để báo thiếu điểm sau khi loader tắt ======
  async function guardedFindRoute() {
    // Nếu chưa đủ điểm, vẫn hiển thị loader ngắn và sau đó popup thông báo ở giữa màn hình
    if (!hasBothInputs()) {
      setLoading(true);
      setLoading(false, {
        onHidden: () => {
          // Sau khi loader ẩn, hiển thị thông báo ở giữa màn hình
          showCenterNotice('Vui lòng chọn điểm xuất phát và điểm đến.', 'warn');
        }
      });
      return;
    }

    try {
      setLoading(true);
      if (routeInfoEl) routeInfoEl.innerHTML = '⏳ Đang tìm đường...';
      await computeAndRenderRoute();
    } catch (err) {
      alert(err.message || 'Đã xảy ra lỗi');
    } finally {
      setLoading(false);
    }
  }

  async function resolveInputCoords(el) {
    if (el?.dataset?.lat && el?.dataset?.lng) return [parseFloat(el.dataset.lat), parseFloat(el.dataset.lng)];
    return await geocode(el.value.trim());
  }
  
  // Xoá layer an toàn
  function removeLayerIfExists(layer) {
    try {
      if (layer && map && typeof map.hasLayer === 'function' && map.hasLayer(layer)) {
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
      color: '#22d3ee',
      weight: 2,
      fillColor: '#22d3ee',
      fillOpacity: 0.35
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
    const toRad = (x) => x * Math.PI / 180;
    const toDeg = (x) => x * 180 / Math.PI;
    const lat1 = toRad(a.lat), lon1 = toRad(a.lng);
    const lat2 = toRad(b.lat), lon2 = toRad(b.lng);
    const dLon = lon2 - lon1;
    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
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
    return L.divIcon({ className: 'user-heading-icon', html, iconSize: [48, 48], iconAnchor: [24, 24] });
  }

  // Tạo marker có thể kéo thả
  function createMarker(latlng, popupText, colorHex) {
    const color = (colorHex || '3b82f6').replace(/^#?/, '#');
    const html = `<div style="width:28px;height:28px;border-radius:50%;background:${color};border:2px solid rgba(255,255,255,.9);box-shadow:0 6px 14px rgba(0,0,0,.35);"></div>`;
    const icon = L.divIcon({
      className: 'leaflet-startend-icon',
      html,
      iconSize: [28, 28],
      iconAnchor: [14, 28]
    });
    const marker = L.marker(latlng, { draggable: true, icon }).addTo(map).bindPopup(popupText).openPopup();
    marker.on('dragend', (ev) => {
      const pos = ev.target.getLatLng();
      if (popupText.includes('xuất phát')) {
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
    if (startMarker) { removeLayerIfExists(startMarker); startMarker = null; }
    // Chỉ tạo chấm khi là thao tác do người dùng (không phải cập nhật chương trình)
    if (!programmaticUpdate) {
      startMarker = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 7,
        color: '#10b981',
        weight: 2,
        fillColor: '#10b981',
        fillOpacity: 0.7
      }).addTo(map);
      try { startMarker.bringToFront(); } catch {}
    }
    startEl.value = label || formatLatLng(latlng);
    startEl.dataset.lat = latlng.lat;
    startEl.dataset.lng = latlng.lng;
    if (!programmaticUpdate && hasBothInputs()) debouncedFindRoute();
  }
  function setAsEnd(latlng, label) {
    reachedDestination = false;
    if (endMarker) { removeLayerIfExists(endMarker); endMarker = null; }
    // Chỉ tạo chấm khi là thao tác do người dùng (không phải cập nhật chương trình)
    if (!programmaticUpdate) {
      endMarker = L.circleMarker([latlng.lat, latlng.lng], {
        radius: 7,
        color: '#ef4444',
        weight: 2,
        fillColor: '#ef4444',
        fillOpacity: 0.7
      }).addTo(map);
      try { endMarker.bringToFront(); } catch {}
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
    if (startEl) { startEl.value = ''; clearInputDatasets(startEl); }
    if (endEl) { endEl.value = ''; clearInputDatasets(endEl); }
    if (routeInfoEl) routeInfoEl.innerHTML = '';
  }

  // Hiển thị thông tin lộ trình (tối giản, không có chi tiết bước)
  function renderRouteInfo(summary) {
    lastRouteSummary = summary || null;
    const distanceKm = summary?.distance != null ? (summary.distance / 1000).toFixed(2) : '-';
    const durationMin = summary?.duration != null ? (summary.duration / 60).toFixed(1) : '-';
    const html = `<div><b>Khoảng cách:</b> ${distanceKm} km<br><b>Thời gian:</b> ${durationMin} phút</div>`;
    if (routeInfoEl) routeInfoEl.innerHTML = html;
  }

  const ARRIVAL_THRESHOLD_M = 30; // ngưỡng báo đã đến (m)
  function renderProgress(remDist) {
    if (!routeInfoEl) return;
    let html = '';
    if (lastRouteSummary && Number.isFinite(lastRouteSummary.distance) && Number.isFinite(lastRouteSummary.duration)) {
      const dKm = (lastRouteSummary.distance / 1000).toFixed(2);
      const tMin = (lastRouteSummary.duration / 60).toFixed(1);
      html += `<div><b>Khoảng cách:</b> ${dKm} km<br><b>Thời gian:</b> ${tMin} phút</div>`;
    }
    if (typeof remDist === 'number' && isFinite(remDist)) {
      const rem = Math.max(0, Math.round(remDist));
      const etaMin = (rem / 1.2 / 60).toFixed(1); // giả định đi bộ ~1.2 m/s
      html += `<div style="margin-top:6px;color:#cbd5e1"><b>Còn:</b> ${rem} m · ETA ~ ${etaMin} phút</div>`;
    }
    if (html) routeInfoEl.innerHTML = html;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function handleError(err) {
    console.error(err);
    alert(err?.message || 'Đã xảy ra lỗi. Vui lòng thử lại.');
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
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLng/2)**2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function isNearCampus(lat, lng, radiusM = 1500) {
    const campusCenter = { lat: 10.4209, lng: 105.6439 };
    return distanceMeters({ lat, lng }, campusCenter) < radiusM;
  }
  // Geolocation: bật/tắt theo dõi vị trí khi di chuyển (có mũi tên định hướng)
  function getCurrentLocation() {
  if (!navigator.geolocation) { alert('Trình duyệt không hỗ trợ định vị.'); return; }

  const geoBtn = document.getElementById('loc-btn');
  // Cảnh báo khi không chạy trên HTTPS hoặc localhost (trình duyệt có thể chặn định vị)
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    try { alert('Trình duyệt có thể chặn định vị trên kết nối không bảo mật (http). Hãy truy cập bằng https hoặc localhost.'); } catch {}
  }

  // Nếu đang theo dõi -> dừng
  if (userWatchId !== null) {
    try { navigator.geolocation.clearWatch(userWatchId); } catch {}
    userWatchId = null;
    initializedStartFromWatch = false;
    prevUserLatLng = null;
    lastHeadingDeg = 0;
    shownLowAccWarn = false;
    if (userLocationMarker) { removeLayerIfExists(userLocationMarker); userLocationMarker = null; }
    if (userAccuracyCircle) { removeLayerIfExists(userAccuracyCircle); userAccuracyCircle = null; }
    if (geoBtn) {
      if (!geoBtn.dataset.originalText) geoBtn.dataset.originalText = '<i class="fa-solid fa-location-crosshairs"></i> Lấy vị trí ';
      geoBtn.innerHTML = geoBtn.dataset.originalText;
    }
    // stop blinking when tracking stopped
    if (typeof window.stopTrackingBlink === 'function') window.stopTrackingBlink();
    return;
  }

  // Bắt đầu theo dõi
  if (geoBtn && !geoBtn.dataset.originalText) {
    geoBtn.dataset.originalText = geoBtn.innerHTML;
  }
  userWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity;

      const ll = L.latLng(lat, lng);

      // Bỏ qua fix quá kém khi khởi tạo lần đầu, đợi fix tốt hơn (nới lỏng ngưỡng)
      if (!initializedStartFromWatch && acc > 2000) {
        return;
      }
      if (prevUserLatLng && acc > 2000) {
        const dist = distanceMeters(prevUserLatLng, ll);
        if (dist > 2000) return;
      }

      if (GEO_WARN_LOW_ACCURACY && !shownLowAccWarn && acc > GEO_LOW_ACCURACY_THRESHOLD_M && acc < Infinity) {
        shownLowAccWarn = true;
        try { showCenterNotice(`Độ chính xác định vị thấp (~${Math.round(acc)} m). Đang đợi tín hiệu tốt hơn...`, 'warn'); } catch {}
      }

      let hdg = (typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading)) ? pos.coords.heading : null;
      if ((hdg == null || isNaN(hdg)) && prevUserLatLng) {
        const b = computeBearing(prevUserLatLng, ll);
        if (b != null && !isNaN(b)) hdg = b;
      }
      if (typeof hdg === 'number' && !isNaN(hdg)) lastHeadingDeg = hdg;

      if (!userLocationMarker) {
        userLocationMarker = L.marker(ll, { icon: buildUserHeadingIcon(lastHeadingDeg) }).addTo(map);
      } else {
        userLocationMarker.setLatLng(ll);
        userLocationMarker.setIcon(buildUserHeadingIcon(lastHeadingDeg));
      }

      if (!userAccuracyCircle) {
        userAccuracyCircle = L.circle(ll, {
          radius: acc,
          color: '#60a5fa',
          weight: 1,
          fillColor: '#3b82f6',
          fillOpacity: 0.1
        }).addTo(map);
      } else {
        userAccuracyCircle.setLatLng(ll);
        userAccuracyCircle.setRadius(acc);
      }

      try { userAccuracyCircle && userAccuracyCircle.bringToBack(); } catch {}
      try { userLocationMarker && userLocationMarker.bringToFront(); } catch {}

      prevUserLatLng = ll;

      if (!initializedStartFromWatch) {
        const hadEnd = !!(endEl && endEl.value && endEl.value.trim().length > 0);
        programmaticUpdate = true;
        setAsStart({ lat, lng }, `${lat.toFixed(6)},${lng.toFixed(6)}`);
        programmaticUpdate = false;
        map.setView(ll, Math.max(map.getZoom(), 15));
        initializedStartFromWatch = true;
        // Khởi động nháy khi có fix đầu tiên
        if (typeof window.startTrackingBlink === 'function') window.startTrackingBlink();
        // Nếu đã có điểm đến, tự động tìm và vẽ đường (xuất phát = vị trí hiện tại)
        if (hadEnd && hasBothInputs()) {
          try { guardedFindRoute(); } catch {}
          lastAutoRouteLatLng = ll;
        }
      } else {
        // Khi đang theo dõi: nếu đã có điểm đến -> tự cập nhật start và vẽ lại khi di chuyển đủ xa
        const hadEnd = !!(endEl && endEl.value && endEl.value.trim().length > 0);
        if (hadEnd) {
          programmaticUpdate = true;
          setAsStart({ lat, lng }, `${lat.toFixed(6)},${lng.toFixed(6)}`);
          programmaticUpdate = false;
          const moved = lastAutoRouteLatLng ? distanceMeters(lastAutoRouteLatLng, ll) : Infinity;
          if (moved > 20) {
            lastAutoRouteLatLng = ll;
            if (hasBothInputs()) debouncedFindRoute();
          }
        }
      }

      // Cập nhật khoảng cách còn lại và phát hiện đã đến nơi
      try {
        const dlat = parseFloat(endEl?.dataset?.lat);
        const dlng = parseFloat(endEl?.dataset?.lng);
        if (!Number.isNaN(dlat) && !Number.isNaN(dlng)) {
          const dest = L.latLng(dlat, dlng);
          const rem = distanceMeters(ll, dest);
          renderProgress(rem);
          if (!reachedDestination && rem <= ARRIVAL_THRESHOLD_M) {
            reachedDestination = true;
            try { if (navigator.vibrate) navigator.vibrate([120,80,120]); } catch {}
            showCenterNotice('Bạn đã tới điểm đến.', 'success');
            try { navigator.geolocation.clearWatch(userWatchId); } catch {}
            userWatchId = null;
            initializedStartFromWatch = false;
            if (typeof window.stopTrackingBlink === 'function') window.stopTrackingBlink();
          }
        }
      } catch {}
    },
    (err) => {
      console.warn(err);
      alert(err.code === 1 ? 'Bạn đã từ chối quyền truy cập vị trí.' : 'Không thể lấy vị trí hiện tại.');
      if (geoBtn && geoBtn.dataset.originalText) geoBtn.innerHTML = geoBtn.dataset.originalText;
      userWatchId = null;
      // stop blinking on error
      if (typeof window.stopTrackingBlink === 'function') window.stopTrackingBlink();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );

  // Bắt đầu nháy ngay khi bật theo dõi để báo đang lấy vị trí; sẽ dừng khi lỗi/nguời dùng tắt.
  if (typeof window.startTrackingBlink === 'function') window.startTrackingBlink();
}

  // Overlay thông tin địa điểm
  function ensureOverlay() {
    let scrim = document.getElementById('place-overlay-scrim');
    if (!scrim) {
      scrim = document.createElement('div');
      scrim.id = 'place-overlay-scrim';
      scrim.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.35);display:none;';
      document.body.appendChild(scrim);
      scrim.addEventListener('click', (e) => { if (e.target === scrim) closeOverlay(); });
    }
    let card = document.getElementById('place-overlay-card');
    if (!card) {
      card = document.createElement('div');
      card.id = 'place-overlay-card';
      card.style.cssText = 'position:fixed;right:24px;top:24px;z-index:9999;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);width:min(420px,90vw);max-height:80vh;overflow:auto;display:none;';
      document.body.appendChild(card);
    }
    return { scrim, card };
  }

  function openOverlay(html) {
    const { scrim, card } = ensureOverlay();
    card.innerHTML = html;
    scrim.style.display = 'block';
    card.style.display = 'block';
  }

  function closeOverlay() {
    const scrim = document.getElementById('place-overlay-scrim');
    const card = document.getElementById('place-overlay-card');
    if (scrim) scrim.style.display = 'none';
    if (card) card.style.display = 'none';
    if (highlightMarker) { removeLayerIfExists(highlightMarker); highlightMarker = null; }
  }

  function showPlaceInfo(latlng, meta) {
        const addrLines = [];
    if (meta?.address) {
      const a = meta.address;
      const parts = [a.road, a.suburb, a.city || a.town || a.village, a.state, a.postcode, a.country];
      addrLines.push(parts.filter(Boolean).map(escapeHtml).join(', '));
    } else if (meta?.display_name) {
      const dn = String(meta.display_name).trim();
      const rh = String(meta?.name || meta?.display_name || '').trim();
      if (dn && dn.toLowerCase() !== rh.toLowerCase()) {
        addrLines.push(escapeHtml(dn));
      }
    }
    const descriptionHtml = meta?.description ? `<div style="color:#e5e7eb;margin-top:6px">${escapeHtml(meta.description)}</div>` : '';
    const headerLabel = escapeHtml((meta?.name || meta?.display_name || '').trim());
    const headerLabelHtml = headerLabel ? `<div style="font-weight:600;color:#e5e7eb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:70%">${headerLabel}</div>` : '<div></div>';
    
    const html = `
      <div style="position:sticky;top:0;background:#0b1220;border-bottom:1px solid rgba(255,255,255,.06);padding:12px 14px;border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        ${headerLabelHtml}
        <button id="overlay-close" style="background:#111827;border:1px solid rgba(255,255,255,.08);color:#e5e7eb;border-radius:8px;padding:6px 10px;cursor:pointer;">Đóng</button>
      </div>
      <div style="padding:14px 14px 8px 14px;line-height:1.65;">
        ${addrLines.length ? `<div style="color:#cbd5e1">${addrLines.join('<br>')}</div>` : ''}
        ${descriptionHtml}
        <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;">
          <button id="set-as-start" style="background:linear-gradient(180deg,#10b981,#059669);color:#fff;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;">Điểm xuất phát</button>
          <button id="set-as-end" style="background:linear-gradient(180deg,#ef4444,#dc2626);color:#fff;border:none;padding:10px 12px;border-radius:10px;cursor:pointer;font-weight:600;float:right">Điểm đến</button>
        </div>
      </div>`;

    openOverlay(html);

    const closeBtn = document.getElementById('overlay-close');
    if (closeBtn) closeBtn.addEventListener('click', closeOverlay);

    const btnStart = document.getElementById('set-as-start');
    if (btnStart) btnStart.addEventListener('click', () => { setAsStart(latlng, meta?.name || meta?.display_name || ''); closeOverlay(); });

    const btnEnd = document.getElementById('set-as-end');
    if (btnEnd) btnEnd.addEventListener('click', () => { setAsEnd(latlng, meta?.name || meta?.display_name || ''); closeOverlay(); });

    setHighlightMarker(latlng);
  }

  // Kiểm tra điểm có trong polygon (ray casting)
  function pointInPolygon([lat, lng], polygonLayer) {
    if (!polygonLayer) return false;
    const poly = polygonLayer.getLatLngs()[0]; // ring đầu tiên
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].lat, yi = poly[i].lng;
      const xj = poly[j].lat, yj = poly[j].lng;
      const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi + 1e-12) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // Khởi tạo POIs trong khuôn viên
  function initCampusPOIs() {
    if (campusPoiLayer) { removeLayerIfExists(campusPoiLayer); campusPoiLayer = null; }
    campusPoiLayer = L.layerGroup().addTo(map);

    function buildPoiIcon(label) {
      const safe = label ? String(label).replace(/[<>&"]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[s])) : '';
      return L.divIcon({
        className: 'poi-icon',
        html: `
          <div class="poi">
            <div class="poi-dot"></div>
            <div class="poi-label">${safe}</div>
          </div>`,
        iconSize: [1, 1],
        iconAnchor: [-6, 8]
      });
    }

    const campusPOIs = [
      { id: 'gateC',    name: 'Cổng C',    lat: 10.421031, lng: 105.641932, description: 'Cổng C của khuôn viên trường.' },
      { id: 'gateB',    name: 'Cổng B',    lat: 10.420366, lng: 105.642533, description: 'Cổng B của khuôn viên trường.' },

      { id: 'buildingB1',    name: 'Tòa B1',    lat: 10.420717, lng: 105.642506, description: 'Tòa B1' },
      { id: 'buildingB2',    name: 'Tòa B2',    lat: 10.420904, lng: 105.642823, description: 'Tòa B2' },
      { id: 'buildingB3',    name: 'Tòa B3',    lat: 10.421105, lng: 105.643024, description: 'Tòa B3' },
      { id: 'buildingB4',    name: 'Tòa B4',    lat: 10.421303, lng: 105.643228, description: 'Tòa B4' },
      { id: 'buildingB5',    name: 'Tòa B5',    lat: 10.421485, lng: 105.643474, description: 'Tòa B5' },

      { id: 'buildingC1',    name: 'Tòa C1',    lat: 10.421712, lng: 105.641854, description: 'Tòa C1' },
      { id: 'buildingC2',    name: 'Tòa C2',    lat: 10.422120, lng: 105.641495, description: 'Tòa C2' },

      { id: 'buildingA1',    name: 'Tòa A1',    lat: 10.420419, lng: 105.643402, description: 'Tòa A1' },
      { id: 'buildingA4',    name: 'Tòa A4',    lat: 10.420327, lng: 105.643968, description: 'Tòa A4' },
      { id: 'buildingA7',    name: 'Tòa A7',    lat: 10.419032, lng: 105.643874, description: 'Tòa A7' },
      { id: 'buildingA8',    name: 'Tòa A8',    lat: 10.419274, lng: 105.644832, description: 'Tòa A8' },
      { id: 'buildingA9',    name: 'Tòa A9',    lat: 10.418984, lng: 105.644384, description: 'Tòa A9' },

      { id: 'buildingT1',    name: 'Tòa T1',    lat: 10.419760, lng: 105.644797, description: 'Tòa T1' },
      { id: 'buildingT3',    name: 'Tòa T3',    lat: 10.419385, lng: 105.645060, description: 'Tòa T3' },


      { id: 'buildingH1',          name: 'Tòa H1',                 lat: 10.420601, lng: 105.643611, description: 'Tòa H1' },
      { id: 'buildingH2',          name: 'Tòa H2',                 lat: 10.419686, lng: 105.644293, description: 'Tòa H2' },
      { id: 'buildingH3',          name: 'Tòa H3',                 lat: 10.420142, lng: 105.644641, description: 'Tòa H3' },

      { id: 'sports hall',         name: 'Nhà thi đấu đa năng',    lat: 10.421258, lng: 105.642284, description: 'Nhà thi đấu đa năng' },
      { id: 'pickleball court',    name: 'Sân pickleball',         lat: 10.421511, lng: 105.642616, description: 'Sân pickleball' },
      { id: 'basketball court',    name: 'Sân basketball',         lat: 10.421696, lng: 105.642917, description: 'Sân basketball' },
      { id: 'soccer field',        name: 'Sân soccer',             lat: 10.420825, lng: 105.644397, description: 'Sân soccer' },
      { id: 'experimental area',   name: 'Khu thí nghiệm',         lat: 10.420781, lng: 105.644899, description: 'Khu thí nghiệm' },

      { id: 'hall-a',   name: 'Giảng đường A',  lat: 10.419691, lng: 105.643799, description: 'Giảng đường lớn dành cho các lớp học tập trung.' },
      { id: 'library',  name: 'Thư viện',       lat: 10.421060, lng: 105.643770, description: 'Thư viện trường, mở cửa từ 7:30 - 20:00.' },
      { id: 'dorm',     name: 'Ký túc xá',      lat: 10.421669, lng: 105.643866, description: 'Ký túc xá sinh viên.' },
      { id:'hieubo',    name: 'Hiệu bộ',        lat: 10.420409, lng: 105.642938, description: 'Hiệu bộ trường Đại học Đồng Tháp.' },

      { id: 'parkingB', name: 'Nhà xe cổng B',  lat: 10.421197, lng: 105.643890, description: 'Khu vực gửi xe cho sinh viên và cán bộ.' },
      { id: 'parkingC', name: 'Nhà xe cổng C',  lat: 10.421073, lng: 105.642450, description: 'Khu vực gửi xe cho sinh viên và cán bộ.' },

      { id: 'school',   name: 'Trường mẫu giáo',lat: 10.418921, lng: 105.644955, description: 'Trường mẫu giáo dành cho con em cán bộ và sinh viên.' },
      { id: 'pool',     name: 'Hồ bơi',         lat: 10.422321, lng: 105.640886, description: 'Hồ bơi' }
      
    ];
         campusPOIs.forEach(p => {
      
      const marker = L.marker([p.lat, p.lng], { icon: buildPoiIcon(p.name) });
            marker.on('click', () => {
        const meta = { name: p.name, description: p.description, display_name: p.name };
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
    { name: 'Sân soccer',     lat: 10.420825, lng: 105.644397 },
    { name: 'Khu thí nghiệm', lat: 10.420781, lng: 105.644899 },
    { name: 'Giảng đường A',  lat: 10.419691, lng: 105.643799 },
    { name: 'Thư viện',       lat: 10.421060, lng: 105.643770 },
    { name: 'Ký túc xá',      lat: 10.421669, lng: 105.643866 }
  ];

  // Tuyến thủ công (màu tím) trong khuôn viên, dùng khi hai điểm gần tuyến này
  const CAMPUS_MANUAL_PATH = [
    [10.420825, 105.644397], // Sân soccer
    [10.420781, 105.644899], // Khu thí nghiệm
    [10.419691, 105.643799], // Giảng đường A
    [10.421060, 105.643770], // Thư viện
    [10.421669, 105.643866]  // Ký túc xá
  ];

  // ==== Lưới lối đi (walkway) – vẽ bằng các polyline bám "khoảng trống" ====
  // Có thể thêm/bớt các đoạn để bám đúng lối đi thực tế. Tuyến sẽ tìm đường ngắn nhất trên lưới này.
  const WALKWAY_NETWORK = [
    // Nhánh bắc: Sân basketball → B4 → Nhà xe cổng C → Cổng C
    [ [10.421696,105.642917], [10.420982, 105.642103], [10.421181, 105.642295], [10.421073,105.642450], [10.421031,105.641932] ],
    // Nhánh về Cổng B qua B2, B1
    [ [10.421073,105.642450], [10.420904,105.642823], [10.420717,105.642506], [10.420366,105.642533] ],
    // Nhánh B3 → Thư viện → Nhà xe B → Ký túc xá
    [ [10.421105,105.643024], [10.421060,105.643770], [10.421197,105.643890], [10.421669,105.643866] ],
    // Nhánh A1 → Giảng đường A → A7 → A9
    [ [10.420419,105.643402], [10.419691,105.643799], [10.419032,105.643874], [10.418984,105.644384] ],
    // Nhánh Giảng đường A → H2 → A8 → T1 → T3 → Trường mẫu giáo
    [ [10.419691,105.643799], [10.419686,105.644293], [10.419274,105.644832], [10.419760,105.644797], [10.419385,105.645060], [10.418921,105.644955] ],
    // Nhánh Ký túc xá → T1 (đi mép phía đông)
    [ [10.421669,105.643866], [10.421400,105.644200], [10.420600,105.644550], [10.419760,105.644797] ],
    // Nhánh Sân soccer → Khu thí nghiệm
    [ [10.420825,105.644397], [10.420781,105.644899] ],
    // Nhánh nối trung tâm: B4 ↔ B3 ↔ B2 ↔ B1
    [ [10.421303,105.643228], [10.421105,105.643024], [10.420904,105.642823], [10.420717,105.642506] ]
  ];

  function _round6(x){ return Math.round(x*1e6)/1e6; }
  function _hashLL(lat,lng){ return `${_round6(lat)},${_round6(lng)}`; }

  function buildWalkwayGraph(){
    const nodes = new Map(); // key -> {id, lat, lng}
    const adj = new Map();   // id -> [{to, weight}]
    let idSeq = 0;
    function ensureNode(lat,lng){
      const key = _hashLL(lat,lng);
      if (!nodes.has(key)) nodes.set(key, { id: `n${++idSeq}`, lat, lng });
      return nodes.get(key);
    }
    function link(a,b){
      const w = haversineMeters(a.lat,a.lng,b.lat,b.lng);
      if (!adj.has(a.id)) adj.set(a.id, []);
      if (!adj.has(b.id)) adj.set(b.id, []);
      adj.get(a.id).push({ to: b.id, weight: w });
      adj.get(b.id).push({ to: a.id, weight: w });
    }
    for (const line of WALKWAY_NETWORK){
      for (let i=1;i<line.length;i++){
        const p1 = ensureNode(line[i-1][0], line[i-1][1]);
        const p2 = ensureNode(line[i][0], line[i][1]);
        link(p1,p2);
      }
    }
    // Trả về lookup theo id và các danh sách hỗ trợ
    const nodesById = new Map();
    for (const n of nodes.values()) nodesById.set(n.id, n);
    return { nodesById, adj };
  }

  function findNearestWalkNode(graph, lat, lng){
    let bestId=null, best=Infinity;
    for (const [id,n] of graph.nodesById.entries()){
      const d = haversineMeters(lat,lng,n.lat,n.lng);
      if (d<best){ best=d; bestId=id; }
    }
    return { id: bestId, dist: best };
  }

  function dijkstraById(graph, srcId, dstId){
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const id of graph.nodesById.keys()) dist.set(id, Infinity);
    dist.set(srcId, 0);
    while (visited.size < graph.nodesById.size){
      let u=null, best=Infinity;
      for (const [k,v] of dist.entries()){
        if (visited.has(k)) continue;
        if (v<best){ best=v; u=k; }
      }
      if (u==null || best===Infinity) break;
      visited.add(u);
      if (u===dstId) break;
      const neighbors = graph.adj.get(u) || [];
      for (const nb of neighbors){
        const alt = dist.get(u) + nb.weight;
        if (alt < dist.get(nb.to)){
          dist.set(nb.to, alt);
          prev.set(nb.to, u);
        }
      }
    }
    if (!prev.has(dstId) && srcId!==dstId) return null;
    const pathIds = [];
    let cur = dstId; pathIds.push(cur);
    while (cur!==srcId){
      const p = prev.get(cur); if (!p) break; pathIds.push(p); cur = p;
    }
    pathIds.reverse();
    return pathIds;
  }

  const WALKWAY_NEAR_THRESH_M = 120; // khoảng cách tối đa để coi là ở gần lưới lối đi
  function tryWalkwayRoute(s,e){
    const g = buildWalkwayGraph();
    const ns = findNearestWalkNode(g, s[0], s[1]);
    const ne = findNearestWalkNode(g, e[0], e[1]);
    if (!ns.id || !ne.id || (ns.dist>WALKWAY_NEAR_THRESH_M && ne.dist>WALKWAY_NEAR_THRESH_M)) return null;
    const ids = dijkstraById(g, ns.id, ne.id);
    if (!ids || !ids.length) return null;
    const coords = [];
    coords.push([s[0], s[1]]);
    for (const id of ids){ const n = g.nodesById.get(id); coords.push([n.lat, n.lng]); }
    coords.push([e[0], e[1]]);
    return coords;
  }

  // ==== Beeline A* trên lưới tránh vật cản (đi theo khoảng trống như bạn vẽ) ====
  function getCampusObstacles(){
    const items = [
      ['Tòa B1',10.420717,105.642506,18], ['Tòa B2',10.420904,105.642823,18], ['Tòa B3',10.421105,105.643024,18],
      ['Tòa B4',10.421303,105.643228,20], ['Tòa B5',10.421485,105.643474,22], ['Tòa C1',10.421712,105.641854,22],
      ['Tòa C2',10.422120,105.641495,22], ['Tòa A1',10.420419,105.643402,18], ['Tòa A4',10.420327,105.643968,18],
      ['Tòa A7',10.419032,105.643874,18], ['Tòa A8',10.419274,105.644832,18], ['Tòa A9',10.418984,105.644384,18],
      ['Tòa T1',10.419760,105.644797,18], ['Tòa T3',10.419385,105.645060,18], ['Tòa H1',10.420601,105.643611,18],
      ['Tòa H2',10.419686,105.644293,18], ['Tòa H3',10.420142,105.644641,18], ['Nhà thi đấu đa năng',10.421258,105.642284,36],
      ['Thư viện',10.421060,105.643770,22], ['Ký túc xá',10.421669,105.643866,22], ['Hiệu bộ',10.420409,105.642938,18],
      ['Nhà xe cổng B',10.421197,105.643890,16], ['Nhà xe cổng C',10.421073,105.642450,16],
      ['Sân pickleball',10.421511,105.642616,14], ['Sân basketball',10.421696,105.642917,16],
      // Dải cản đường chéo (chặn lối chéo cắt qua khối giữa pickleball → B5)
      ['NoDiag1',10.421200,105.642700,10],
      ['NoDiag2',10.421300,105.642930,10],
      ['NoDiag3',10.421410,105.643180,10],
      ['NoDiag4',10.421480,105.643330,10]
    ];
    return items.map(x=>({ name:x[0], lat:x[1], lng:x[2], r:x[3] }));
  }
  function metersPerDeg(lat){
    const latM = 111320; const lngM = 111320 * Math.cos((lat||10.4205)*Math.PI/180);
    return { latM, lngM };
  }
  function project(lat0,lng0,lat,lng){ const sc = metersPerDeg(lat0); return { x:(lng-lng0)*sc.lngM, y:(lat-lat0)*sc.latM }; }
  function unproject(lat0,lng0,x,y){ const sc = metersPerDeg(lat0); return { lat: y/sc.latM + lat0, lng: x/sc.lngM + lng0 }; }

  function rdpSimplify(points, eps){
    if (!points || points.length<=2) return points||[];
    function perpDist(p,a,b){
      const x=a[1],y=a[0], x2=b[1],y2=b[0], x0=p[1],y0=p[0];
      const dx=x2-x, dy=y2-y; if (dx===0&&dy===0) return Math.hypot(x0-x,y0-y);
      const t=((x0-x)*dx+(y0-y)*dy)/(dx*dx+dy*dy); const px=x+t*dx, py=y+t*dy; return Math.hypot(x0-px,y0-py);
    }
    function rec(pts){
      let maxD=0, idx=0; const a=pts[0], b=pts[pts.length-1];
      for (let i=1;i<pts.length-1;i++){ const d=perpDist(pts[i],a,b); if (d>maxD){maxD=d; idx=i;} }
      if (maxD>eps){ const p1=rec(pts.slice(0,idx+1)); const p2=rec(pts.slice(idx)); return p1.slice(0,-1).concat(p2); }
      return [a,b];
    }
    return rec(points);
  }

  function tryBeelineGridRoute(s,e){
    if (!Array.isArray(s)||!Array.isArray(e)) return null;
    const obs = getCampusObstacles();
    const lat0 = 10.4208, lng0 = 105.6438; // gốc quy chiếu gần khuôn viên
    const ps = project(lat0,lng0,s[0],s[1]);
    const pe = project(lat0,lng0,e[0],e[1]);
    let minX = Math.min(ps.x,pe.x), maxX = Math.max(ps.x,pe.x);
    let minY = Math.min(ps.y,pe.y), maxY = Math.max(ps.y,pe.y);
    for (const o of obs){ const p=project(lat0,lng0,o.lat,o.lng); minX=Math.min(minX,p.x-o.r-40); maxX=Math.max(maxX,p.x+o.r+40); minY=Math.min(minY,p.y-o.r-40); maxY=Math.max(maxY,p.y+o.r+40); }
    const cell = 3; // mét/ô (mịn hơn để bám sát khoảng trống)
    const w = Math.max(10, Math.ceil((maxX-minX)/cell)+1);
    const h = Math.max(10, Math.ceil((maxY-minY)/cell)+1);
    const block = new Uint8Array(w*h);
    function idx(ix,iy){ return iy*w+ix; }
    function cellCenter(ix,iy){ return { x: minX + ix*cell, y: minY + iy*cell }; }
    // mark obstacles
    for (let iy=0; iy<h; iy++){
      for (let ix=0; ix<w; ix++){
        const c = cellCenter(ix,iy);
        for (const o of obs){
          const po = project(lat0,lng0,o.lat,o.lng); const d = Math.hypot(c.x-po.x, c.y-po.y);
          if (d <= o.r) { block[idx(ix,iy)] = 1; break; }
        }
      }
    }
    function clampCellNear(xm,ym){
      let ix = Math.round((xm-minX)/cell), iy = Math.round((ym-minY)/cell);
      ix = Math.max(0, Math.min(w-1, ix)); iy = Math.max(0, Math.min(h-1, iy));
      if (!block[idx(ix,iy)]) return {ix,iy};
      // tìm ô trống gần nhất (BFS nhỏ)
      const q=[[ix,iy]], seen=new Set([idx(ix,iy)]);
      const dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
      while(q.length){ const [cx,cy]=q.shift(); for (const d of dirs){ const nx=cx+d[0], ny=cy+d[1]; if(nx<0||ny<0||nx>=w||ny>=h) continue; const k=idx(nx,ny); if(seen.has(k)) continue; seen.add(k); if(!block[k]) return {ix:nx,iy:ny}; q.push([nx,ny]); } }
      return {ix,iy};
    }
    const sCell = clampCellNear(ps.x, ps.y); const eCell = clampCellNear(pe.x, pe.y);
    // A* octile
    const D=1, D2=1.5; // tăng chi phí đi chéo để hạn chế cắt góc
    const gScore = new Float32Array(w*h); for (let i=0;i<gScore.length;i++) gScore[i]=Infinity;
    const fScore = new Float32Array(w*h); for (let i=0;i<fScore.length;i++) fScore[i]=Infinity;
    const prev = new Int32Array(w*h); for (let i=0;i<prev.length;i++) prev[i]=-1;
    const start = idx(sCell.ix, sCell.iy), goal = idx(eCell.ix, eCell.iy);
    gScore[start]=0;
    function hCost(a,b){ const ax=a%w, ay=(a/w)|0, bx=b%w, by=(b/w)|0; const dx=Math.abs(ax-bx), dy=Math.abs(ay-by); return D*(dx+dy) + (D2-2*D)*Math.min(dx,dy); }
    fScore[start] = hCost(start, goal);
    const open = new Set([start]);
    const nbrs = [[1,0,D],[0,1,D],[-1,0,D],[0,-1,D],[1,1,D2],[1,-1,D2],[-1,1,D2],[-1,-1,D2]];
    while(open.size){
      let cur=-1, best=Infinity; for (const k of open){ if (fScore[k] < best){ best=fScore[k]; cur=k; } }
      if (cur===goal) break;
      open.delete(cur);
      const cx=cur%w, cy=(cur/w)|0;
      for (const d of nbrs){ const nx=cx+d[0], ny=cy+d[1]; if(nx<0||ny<0||nx>=w||ny>=h) continue; const ni=idx(nx,ny); if(block[ni]) continue; const tentative=gScore[cur]+d[2]; if(tentative<gScore[ni]){ prev[ni]=cur; gScore[ni]=tentative; fScore[ni]=tentative+hCost(ni, goal); open.add(ni);} }
    }
    if (prev[goal]===-1 && goal!==start) return null;
    const path=[]; let cur=goal; path.push(cur); while(cur!==start){ cur=prev[cur]; if (cur<0) break; path.push(cur); } path.reverse();
    // build coords
    const pts=[]; pts.push([s[0], s[1]]);
    for (const p of path){ const cx=p%w, cy=(p/w)|0; const c=cellCenter(cx,cy); const ll=unproject(lat0,lng0,c.x,c.y); pts.push([ll.lat, ll.lng]); }
    pts.push([e[0], e[1]]);
    // simplify ~ 2-4 m
    const simp = rdpSimplify(pts, 0.000015); // ~1.5-2 m, giảm nguy cơ cắt qua mép toà
    return simp;
  }

  // ==== Đồ thị tuyến nội bộ trong khuôn viên (shortest path) ====
  // Dùng các POI làm nút và định nghĩa các cạnh nội bộ, tính đường ngắn nhất bằng Dijkstra
  function buildCampusGraph(){
    const nodes = new Map();
    const poiTable = {
      'Cổng C': [10.421031,105.641932],
      'Cổng B': [10.420366,105.642533],
      'Tòa B1': [10.420717,105.642506],
      'Tòa B2': [10.420904,105.642823],
      'Tòa B3': [10.421105,105.643024],
      'Tòa B4': [10.421303,105.643228],
      'Tòa B5': [10.421485,105.643474],
      'Tòa C1': [10.421712,105.641854],
      'Tòa C2': [10.422120,105.641495],
      'Tòa A1': [10.420419,105.643402],
      'Tòa A4': [10.420327,105.643968],
      'Tòa A7': [10.419032,105.643874],
      'Tòa A8': [10.419274,105.644832],
      'Tòa A9': [10.418984,105.644384],
      'Tòa T1': [10.419760,105.644797],
      'Tòa T3': [10.419385,105.645060],
      'Tòa H1': [10.420601,105.643611],
      'Tòa H2': [10.419686,105.644293],
      'Tòa H3': [10.420142,105.644641],
      'Nhà thi đấu đa năng': [10.421258,105.642284],
      'Sân pickleball': [10.421511,105.642616],
      'Sân basketball': [10.421696,105.642917],
      'Sân soccer': [10.420825,105.644397],
      'Khu thí nghiệm': [10.420781,105.644899],
      'Giảng đường A': [10.419691,105.643799],
      'Thư viện': [10.421060,105.643770],
      'Ký túc xá': [10.421669,105.643866],
      'Hiệu bộ': [10.420409,105.642938],
      'Nhà xe cổng B': [10.421197,105.643890],
      'Nhà xe cổng C': [10.421073,105.642450],
      'Trường mẫu giáo': [10.418921,105.644955],
      'Hồ bơi': [10.422321,105.640886]
    };
    for (const [nm,ll] of Object.entries(poiTable)) nodes.set(nm, {lat: ll[0], lng: ll[1]});

    const E = [
      ['Cổng C','Nhà xe cổng C'], ['Cổng C','Tòa C1'], ['Tòa C1','Tòa C2'],
      ['Nhà xe cổng C','Tòa B2'], ['Tòa B2','Tòa B1'], ['Tòa B2','Tòa B3'], ['Tòa B3','Tòa B4'], ['Tòa B4','Tòa B5'],
      ['Cổng B','Tòa B1'], ['Cổng B','Hiệu bộ'], ['Hiệu bộ','Tòa B1'],
      ['Tòa B1','Tòa A1'], ['Tòa A1','Tòa H1'], ['Tòa H1','Thư viện'],
      ['Thư viện','Tòa B4'], ['Thư viện','Nhà xe cổng B'], ['Tòa B4','Tòa B5'], ['Nhà xe cổng B','Tòa B3'],
      ['Tòa A1','Tòa A4'], ['Tòa A4','Giảng đường A'], ['Giảng đư��ng A','Tòa A7'], ['Tòa A7','Tòa A9'],
      ['Giảng đường A','Tòa H2'], ['Tòa H2','Tòa H3'], ['Tòa H2','Tòa A8'], ['Tòa A8','Tòa T1'], ['Tòa T1','Tòa T3'],
      ['Tòa A8','Tòa A9'], ['Tòa T3','Trường mẫu giáo'],
      ['Tòa B4','Sân basketball'], ['Sân basketball','Tòa B5'], ['Sân basketball','Sân pickleball'],
      ['Ký túc xá','Tòa B5'], ['Ký túc xá','Thư viện'],
      ['Tòa T1','Khu thí nghiệm'], ['Khu thí nghiệm','Sân soccer']
    ];

    const adj = new Map();
    for (const [a,b] of E){
      if(!nodes.has(a) || !nodes.has(b)) continue;
      const A = nodes.get(a), B = nodes.get(b);
      const w = haversineMeters(A.lat, A.lng, B.lat, B.lng);
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push({to:b, weight:w});
      adj.get(b).push({to:a, weight:w});
    }
    return { nodes, adj };
  }

  const CAMPUS_ROUTER_NEAR_NODE_M = 350; // khoảng cách coi là "gần" mạng lưới

  function findNearestGraphNode(graph, lat, lng){
    let name=null, best=Infinity;
    for (const [nm,ll] of graph.nodes.entries()){
      const d = haversineMeters(lat,lng,ll.lat,ll.lng);
      if (d<best){ best=d; name=nm; }
    }
    return { name, dist: best };
  }

  function dijkstraShortestPath(graph, src, dst){
    const dist = new Map();
    const prev = new Map();
    const visited = new Set();
    for (const k of graph.nodes.keys()) dist.set(k, Infinity);
    dist.set(src, 0);

    while (visited.size < graph.nodes.size){
      let u=null, best=Infinity;
      for (const [k,v] of dist.entries()){
        if (visited.has(k)) continue;
        if (v<best){ best=v; u=k; }
      }
      if (u==null || best===Infinity) break;
      visited.add(u);
      if (u===dst) break;
      const neighbors = graph.adj.get(u) || [];
      for (const nb of neighbors){
        const alt = dist.get(u) + nb.weight;
        if (alt < dist.get(nb.to)){
          dist.set(nb.to, alt);
          prev.set(nb.to, u);
        }
      }
    }
    if (!prev.has(dst) && src!==dst) return null;
    const path = [];
    let cur = dst;
    path.push(cur);
    while (cur!==src){
      const p = prev.get(cur);
      if (p==null){ break; }
      path.push(p);
      cur = p;
    }
    path.reverse();
    return path;
  }

  function buildCoordsFromNodePath(graph, nodePath){
    const coords = [];
    for (let i=0;i<nodePath.length;i++){
      const nm = nodePath[i];
      const ll = graph.nodes.get(nm);
      coords.push([ll.lat, ll.lng]);
    }
    return coords;
  }

  function tryCampusShortestRoute(s, e){
    const graph = buildCampusGraph();
    const ns = findNearestGraphNode(graph, s[0], s[1]);
    const ne = findNearestGraphNode(graph, e[0], e[1]);
    if (ns.dist > CAMPUS_ROUTER_NEAR_NODE_M && ne.dist > CAMPUS_ROUTER_NEAR_NODE_M) return null;
    const nodePath = dijkstraShortestPath(graph, ns.name, ne.name);
    if (!nodePath || nodePath.length<1) return null;
    const routeCoords = [];
    routeCoords.push([s[0], s[1]]);
    const body = buildCoordsFromNodePath(graph, nodePath);
    for (const c of body) routeCoords.push(c);
    routeCoords.push([e[0], e[1]]);
    return routeCoords;
  }

  function nearestIndexAndDistanceOnManualPath(lat, lng){
    let bestIdx = -1, best = Infinity;
    for (let i=0;i<CAMPUS_MANUAL_PATH.length;i++){
      const [pLat, pLng] = CAMPUS_MANUAL_PATH[i];
      const d = haversineMeters(lat, lng, pLat, pLng);
      if (d < best) { best = d; bestIdx = i; }
    }
    return { idx: bestIdx, dist: best };
  }

  function sliceManualPath(i, j){
    if (i === j) return null;
    const a = Math.min(i, j), b = Math.max(i, j);
    return CAMPUS_MANUAL_PATH.slice(a, b+1);
  }

  // Ngưỡng snap lên tuyến tím (nới lỏng để ưu tiên tuyến nội bộ)
  const MANUAL_SNAP_THRESHOLD_M = 800;

  // Xây coords theo kiểu: [start] + [đoạn tuyến tím giữa 2 nút gần nhất] + [end]
  function buildSnappedManualRouteCoords(s, e){
    if (!Array.isArray(s) || !Array.isArray(e)) return null;
    const ns = nearestIndexAndDistanceOnManualPath(s[0], s[1]);
    const ne = nearestIndexAndDistanceOnManualPath(e[0], e[1]);
    if (ns.idx < 0 || ne.idx < 0) return null;
    const bothFar = ns.dist > MANUAL_SNAP_THRESHOLD_M && ne.dist > MANUAL_SNAP_THRESHOLD_M;
    if (bothFar) return null;
    if (ns.idx === ne.idx) {
      const node = CAMPUS_MANUAL_PATH[ns.idx];
      if (!node) return null;
      return [ [s[0], s[1]], [node[0], node[1]], [e[0], e[1]] ];
    }
    const seg = sliceManualPath(ns.idx, ne.idx);
    if (!Array.isArray(seg) || seg.length < 2) return [ [s[0], s[1]], [e[0], e[1]] ];
    return [ [s[0], s[1]], ...seg, [e[0], e[1]] ];
  }

  function _normLabel(s){
    return String(s||'')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .trim().toLowerCase();
  }

  // Nếu tên start/end trùng các điểm trong CAMPUS_PATH_ORDER, xây dựng polyline đi theo thứ tự đã định.
  function buildManualPathFromLabels(startLabel, endLabel){
    const a = _normLabel(startLabel), b = _normLabel(endLabel);
    if (!a || !b) return null;
    const i = CAMPUS_PATH_ORDER.findIndex(p => _normLabel(p.name) === a);
    const j = CAMPUS_PATH_ORDER.findIndex(p => _normLabel(p.name) === b);
    if (i === -1 || j === -1 || i === j) return null;
    const segment = i <= j ? CAMPUS_PATH_ORDER.slice(i, j+1) : CAMPUS_PATH_ORDER.slice(j, i+1).reverse();
    return segment.map(p => [p.lat, p.lng]);
  }

  function haversineMeters(lat1, lon1, lat2, lon2){
    const R = 6371000; // m
    const toRad = (x) => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const la1 = toRad(lat1); const la2 = toRad(lat2);
    const h = Math.sin(dLat/2)**2 + Math.cos(la1)*Math.cos(la2)*Math.sin(dLon/2)**2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function totalPathDistanceMeters(coords){
    let sum = 0;
    for (let k=1;k<coords.length;k++){
      const [aLat, aLng] = coords[k-1];
      const [bLat, bLng] = coords[k];
      sum += haversineMeters(aLat, aLng, bLat, bLng);
    }
    return sum;
  }

  function drawManualRouteCoords(coords){
    if (!Array.isArray(coords) || coords.length < 2) return;
    if (routeLine) { removeLayerIfExists(routeLine); routeLine = null; }
    routeLine = L.polyline(coords, { color: '#7c3aed', weight: 6, opacity: 0.9 }).addTo(map);
    const b = routeLine.getBounds();
    if (b && typeof b.isValid === 'function' && b.isValid()) map.fitBounds(b, { padding: [28, 28] });
    const dist = totalPathDistanceMeters(coords);
    const speedMps = 1.2; // ~4.3 km/h
    const dur = dist / speedMps;
    renderRouteInfo({ distance: dist, duration: dur });
    if (startMarker) { removeLayerIfExists(startMarker); startMarker = null; }
    if (endMarker) { removeLayerIfExists(endMarker); endMarker = null; }
  }

  // Tính toán và vẽ lộ trình (OSRM)
  async function computeAndRenderRoute() {
    reachedDestination = false;
    const s = await resolveInputCoords(startEl);
    const e = await resolveInputCoords(endEl);

    // Ưu tiên 0: Beeline A* n���i bộ khuôn viên (chỉ khi cả hai điểm gần khuôn viên)
    const campusCenter = { lat: 10.4209, lng: 105.6439 };
    const nearCampus = distanceMeters({lat:s[0],lng:s[1]}, campusCenter) < 1200 && distanceMeters({lat:e[0],lng:e[1]}, campusCenter) < 1200;
    if (nearCampus) {
      const gridCoords = tryBeelineGridRoute(s, e);
      if (Array.isArray(gridCoords) && gridCoords.length >= 2) {
        drawManualRouteCoords(gridCoords);
        return;
      }
    }

    
    if (!Array.isArray(s) || !Array.isArray(e)) throw new Error('Vui lòng nhập địa chỉ hoặc toạ độ hợp lệ cho cả hai điểm.');

    // Cập nhật marker start/end (không kích hoạt tìm lại trong khi đang tính)
    programmaticUpdate = true;
    setAsStart({ lat: s[0], lng: s[1] });
    setAsEnd({ lat: e[0], lng: e[1] });
    programmaticUpdate = false;

    if (routeLine) { removeLayerIfExists(routeLine); routeLine = null; }

    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${s[1]},${s[0]};${e[1]},${e[0]}`);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('alternatives', 'false');
    url.searchParams.set('steps', 'false');

    const data = await fetchJsonWithTimeout(url.toString());
    if (!data || data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length) {
      throw new Error('Không tìm thấy tuyến phù hợp.');
    }

    const route = data.routes[0];

    routeLine = L.geoJSON(route.geometry, { style: { color: '#22d3ee', weight: 6, opacity: 0.9 } }).addTo(map);

    const b = routeLine.getBounds();
    if (b && typeof b.isValid === 'function' && b.isValid()) map.fitBounds(b, { padding: [28, 28] });

    renderRouteInfo({ distance: route.distance, duration: route.duration });

    // Ẩn chấm start/end sau khi có tuyến để chỉ còn lại đường đi
    if (startMarker) { removeLayerIfExists(startMarker); startMarker = null; }
    if (endMarker) { removeLayerIfExists(endMarker); endMarker = null; }
  }

  // Đưa map về khu vực khuôn viên
  async function centerToCampus() {
    try {
      const pref = await geocodeDetails('Đại học Đồng Tháp, Cao Lãnh, Đồng Tháp, Việt Nam');
      if (pref.boundingbox?.length === 4) {
        const [south, north, west, east] = pref.boundingbox.map(parseFloat);
        map.fitBounds([[south, west], [north, east]], { maxZoom: 18, padding: [20, 20] });
        return;
      }
      map.setView([parseFloat(pref.lat), parseFloat(pref.lon)], 17);
    } catch {
      map.setView([10.455900, 105.633100], 17);
    }
  }

  // Liên hệ: mở form và gửi mailto (chuyển từ HTML sang JS)
  (function(){
  const openBtn = document.getElementById('open-contact');
  const scrim = document.getElementById('contact-overlay-scrim');
  const card = document.getElementById('contact-overlay-card');
  const closeBtn = document.getElementById('contact-close');
  const cancelBtn = document.getElementById('contact-cancel');

  // Helper: loading overlay khi gửi liên hệ
  let noticeTimer = null;
  function ensureContactLoader(){
    let el = document.getElementById('contact-loading');
    if (!el) {
      el = document.createElement('div');
      el.id = 'contact-loading';
      el.style.cssText = 'position:fixed;inset:0;z-index:10003;background:rgba(0,0,0,.35);display:none;align-items:center;justify-content:center;';
      const box = document.createElement('div');
      box.style.cssText = 'background:#0b1220;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 30px rgba(0,0,0,.35);';
      const sp = document.createElement('div');
      sp.style.cssText = 'width:28px;height:28px;border-radius:50%;border:3px solid rgba(255,255,255,.2);border-top-color:#22d3ee;animation:glspin .9s linear infinite;';
      const tx = document.createElement('div');
      tx.textContent = 'Đang gửi...';
      tx.style.cssText = 'color:#e5e7eb;font-weight:600;';
      box.appendChild(sp); box.appendChild(tx);
      el.appendChild(box);
      document.body.appendChild(el);
    }
    // Đảm bảo @keyframes cho spinner luôn tồn tại (trường hợp chưa dùng loader tìm đường)
    if (!document.getElementById('global-loader-style')) {
      const st = document.createElement('style');
      st.id = 'global-loader-style';
      st.textContent = '@keyframes glspin { to { transform: rotate(360deg); } }';
      document.head.appendChild(st);
    }
    return el;
  }
  function setContactLoading(on){ const el = ensureContactLoader(); el.style.display = on ? 'flex' : 'none'; }

  // Helper: thông báo ở giữa màn hình
  function ensureCenterNotice(){
    let el = document.getElementById('center-notice');
    if (!el) {
      el = document.createElement('div');
      el.id = 'center-notice';
      el.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:10004;display:none;';
      const box = document.createElement('div');
      box.id = 'center-notice-box';
      box.style.cssText = 'min-width:260px;max-width:80vw;background:#0b1220;color:#e5e7eb;border:1px solid rgba(255,255,255,.08);border-radius:12px;box-shadow:0 12px 30px rgba(0,0,0,.45);padding:14px 16px;text-align:center;font-weight:600;';
      el.appendChild(box);
      document.body.appendChild(el);
    }
    return el;
  }
  function showCenterNotice(message, kind){
    const host = ensureCenterNotice();
    const box = document.getElementById('center-notice-box');
    box.textContent = message || '';
    if (kind === 'success') { box.style.borderColor = 'rgba(16,185,129,.45)'; box.style.background = 'linear-gradient(180deg,#0b1220,#0f172a)'; }
    else if (kind === 'error') { box.style.borderColor = 'rgba(239,68,68,.45)'; box.style.background = 'linear-gradient(180deg,#0b1220,#111827)'; }
    else { box.style.borderColor = 'rgba(234,179,8,.45)'; box.style.background = 'linear-gradient(180deg,#0b1220,#111827)'; }
    host.style.display = 'block';
    try { if (noticeTimer) clearTimeout(noticeTimer); } catch {}
    noticeTimer = setTimeout(() => { host.style.display = 'none'; }, 2200);
  }

  function open(){ if(scrim) scrim.style.display='block'; if(card) card.style.display='block'; }
  function close(){ if(scrim) scrim.style.display='none'; if(card) card.style.display='none'; }

  if (openBtn) openBtn.addEventListener('click', open);
  if (scrim) scrim.addEventListener('click', (e)=>{ if(e.target===scrim) close(); });
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (cancelBtn) cancelBtn.addEventListener('click', close);
  document.addEventListener('keydown', (e)=>{ if (scrim && scrim.style.display==='block' && e.key==='Escape') close(); });

  const form = document.getElementById('contact-form');
  if (form) form.addEventListener('submit', function(ev){
    ev.preventDefault();
    const name = document.getElementById('cf-name')?.value?.trim() || '';
    const email = document.getElementById('cf-email')?.value?.trim() || '';
    const phone = document.getElementById('cf-phone')?.value?.trim() || '';
    const msg = document.getElementById('cf-message')?.value?.trim() || '';
    if (!name || !msg) { showCenterNotice('Vui lòng nhập Họ tên và Nội dung.', 'warn'); return; }

    setContactLoading(true);
      fetch('https://mappdthu.onrender.com/api/contact', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', 
        'X-CSRFToken': getCookie('csrftoken') 
      },
      body: JSON.stringify({ name, email, phone, message: msg })
    })
    .then(res => res.text())
    .then(text => {
      console.log("Phản hồi server:", text);

      let data = {};
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.warn("Không phải JSON:", text);
      }

      if (data.ok) {
        showCenterNotice('Gửi thành công!', 'success');
        try {
          document.getElementById('cf-name').value = '';
          document.getElementById('cf-email').value = '';
          document.getElementById('cf-phone').value = '';
          document.getElementById('cf-message').value = '';
        } catch {}
        close();
      } else {
        showCenterNotice('Gửi thất bại, vui lòng thử lại.', 'error');
      }

      setContactLoading(false);
    })
    .catch(err => {
      console.error("Fetch error:", err);
      setContactLoading(false);
      showCenterNotice('Có lỗi khi gửi.', 'error');
    });
  });

  // Hàm lấy CSRF token
  function getCookie(name) {
    let cookieValue = null;
    if (document.cookie && document.cookie !== '') {
      const cookies = document.cookie.split(';');
      for (let i = 0; i < cookies.length; i++) {
        const cookie = cookies[i].trim();
        if (cookie.substring(0, name.length + 1) === (name + '=')) {
          cookieValue = decodeURIComponent(cookie.substring(name.length + 1));
          break;
        }
      }
    }
    return cookieValue;
  }
})();

});
