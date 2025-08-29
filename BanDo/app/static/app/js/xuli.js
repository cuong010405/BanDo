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
  // Loader state
  let loadingStartedAt = 0;
  let loadingHideTimer = null;

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
      center: [10.762622, 106.660172],
      zoom: 5,
      minZoom: 2,
      maxZoom: 19
    });

    // Lớp nền OSM
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Vẽ polygon khuôn viên (ví dụ)
    const campusCoords = [
      [10.418770, 105.644008],
      [10.422369, 105.640698],
      [10.422487, 105.640934],
      [10.421848, 105.644982],
      [10.418997, 105.645239],
      [10.418680, 105.645049]
    ];
    campusPolygon = L.polygon(campusCoords, { color: '#22d3ee', weight: 2, fillOpacity: 0.05 }).addTo(map);

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
  function attachEventHandlers() {
    if (modeEl) {
      modeEl.addEventListener('change', () => { if (hasBothInputs()) guardedFindRoute(); });
    }

    [startEl, endEl].forEach((el) => {
      if (!el) return;
      el.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); guardedFindRoute(); }
      });
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
    const distanceKm = summary?.distance != null ? (summary.distance / 1000).toFixed(2) : '-';
    const durationMin = summary?.duration != null ? (summary.duration / 60).toFixed(1) : '-';
    const html = `<div><b>Khoảng cách:</b> ${distanceKm} km<br><b>Thời gian:</b> ${durationMin} phút</div>`;
    if (routeInfoEl) routeInfoEl.innerHTML = html;
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
  // Geolocation: bật/tắt theo dõi vị trí khi di chuyển (có mũi tên định hướng)
  function getCurrentLocation() {
    if (!navigator.geolocation) { alert('Trình duyệt không hỗ trợ định vị.'); return; }

    const geoBtn = document.querySelector('button[onclick="getCurrentLocation()"]');

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
      return;
    }

    // Bắt đầu theo dõi
    if (geoBtn && !geoBtn.dataset.originalText) {
      geoBtn.dataset.originalText = geoBtn.innerHTML;
    }
    if (geoBtn) geoBtn.innerHTML = '<i class="fa-solid fa-location-crosshairs"></i> Đang theo dõi (nhấn để dừng)';

    userWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : Infinity;

        const ll = L.latLng(lat, lng);

        // Bỏ qua fix quá kém khi khởi tạo lần đầu, đợi fix tốt hơn
        if (!initializedStartFromWatch && acc > 1000) {
          return;
        }
        // Nếu đã có vị trí trước đó: loại bỏ cập nhật bất thường với độ chính xác rất kém
        if (prevUserLatLng && acc > 1000) {
          const dist = distanceMeters(prevUserLatLng, ll);
          if (dist > 2000) return;
        }

        // Cảnh báo một lần nếu độ chính xác thấp
        if (!shownLowAccWarn && acc > 150 && acc < Infinity) {
          shownLowAccWarn = true;
          try {
            alert(`Độ chính xác định vị thấp (~${Math.round(acc)} m). Hãy bật GPS/Wi‑Fi và ra nơi thoáng để cải thiện.`);
          } catch {}
        }

        // Ưu tiên heading từ thiết bị; nếu thiếu, suy ra từ vector di chuyển
        let hdg = (typeof pos.coords.heading === 'number' && !isNaN(pos.coords.heading)) ? pos.coords.heading : null;
        if ((hdg == null || isNaN(hdg)) && prevUserLatLng) {
          const b = computeBearing(prevUserLatLng, ll);
          if (b != null && !isNaN(b)) hdg = b;
        }
        if (typeof hdg === 'number' && !isNaN(hdg)) {
          lastHeadingDeg = hdg;
        }

        // Tạo/cập nhật marker vị trí người dùng có mũi tên định hướng
        if (!userLocationMarker) {
          userLocationMarker = L.marker(ll, { icon: buildUserHeadingIcon(lastHeadingDeg) }).addTo(map);
        } else {
          userLocationMarker.setLatLng(ll);
          // Cập nhật icon theo heading hiện tại
          userLocationMarker.setIcon(buildUserHeadingIcon(lastHeadingDeg));
        }

        // Tạo/cập nhật vòng tròn độ chính xác
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

        // Sắp xếp lớp để marker ở trên, vòng chính xác ở dưới
        try { userAccuracyCircle && userAccuracyCircle.bringToBack(); } catch {}
        try { userLocationMarker && userLocationMarker.bringToFront(); } catch {}

        // Lưu lại vị trí trước đó để suy ra hướng nếu thiếu heading
        prevUserLatLng = ll;

        // Lần đầu: đặt làm điểm xuất phát (một lần), đưa map tới vị trí
        if (!initializedStartFromWatch) {
          programmaticUpdate = true;
          setAsStart({ lat, lng }, `${lat.toFixed(6)},${lng.toFixed(6)}`);
          programmaticUpdate = false;
          map.setView(ll, Math.max(map.getZoom(), 15));
          initializedStartFromWatch = true;
        }
      },
      (err) => {
        console.warn(err);
        alert(err.code === 1 ? 'Bạn đã từ chối quyền truy cập vị trí.' : 'Không thể lấy vị trí hiện tại.');
        // Khôi phục nút nếu thất bại
        if (geoBtn && geoBtn.dataset.originalText) geoBtn.innerHTML = geoBtn.dataset.originalText;
        userWatchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
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
    if (btnStart) btnStart.addEventListener('click', () => { setAsStart(latlng); closeOverlay(); });

    const btnEnd = document.getElementById('set-as-end');
    if (btnEnd) btnEnd.addEventListener('click', () => { setAsEnd(latlng); closeOverlay(); });

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
      { id: 'gate',    name: 'Cổng chính',    lat: 10.420480, lng: 105.642150, description: 'Cổng vào chính của khuôn viên trường.' },
      { id: 'hall-a',  name: 'Giảng đường A', lat: 10.420950, lng: 105.642800, description: 'Giảng đường lớn dành cho các lớp học tập trung.' },
      { id: 'library', name: 'Thư viện',      lat: 10.420200, lng: 105.641650, description: 'Thư viện trường, mở cửa từ 7:30 - 20:00.' },
      { id: 'dorm',    name: 'Ký túc xá',     lat: 10.419720, lng: 105.643700, description: 'Ký túc xá sinh viên.' },
      { id: 'parking', name: 'Nhà xe',        lat: 10.421250, lng: 105.643900, description: 'Khu vực gửi xe cho sinh viên và cán bộ.' }
    ];

    campusPOIs.forEach(p => {
      const inside = campusPolygon ? pointInPolygon([p.lat, p.lng], campusPolygon) : true;
      if (!inside) return;
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

  // Thu gọn step từ OSRM để hiển thị
  function extractStepsFromOSRM(route) {
    const result = [];
    if (!route || !Array.isArray(route.legs)) return result;
    route.legs.forEach(leg => {
      (leg.steps || []).forEach(step => {
        const man = step.maneuver || {};
        const parts = [];
        if (man.type) parts.push(man.type);
        if (man.modifier) parts.push(man.modifier);
        if (step.name) parts.push(step.name);
        result.push({ distance: step.distance, duration: step.duration, instruction: parts.join(' ') });
      });
    });
    return result;
  }

  // Tính toán và vẽ lộ trình (OSRM)
  async function computeAndRenderRoute() {
    const s = await resolveInputCoords(startEl);
    const e = await resolveInputCoords(endEl);

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
    // Gửi dữ liệu tới server Django
    fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
      body: JSON.stringify({ name, email, phone, message: msg })
    })
    .then(res => res.json())
    .then(data => {
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
    .catch(() => { setContactLoading(false); showCenterNotice('Có lỗi khi gửi.', 'error'); });
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
