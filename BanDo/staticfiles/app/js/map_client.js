// client/map_client.js — Navigation System v2 (Google Maps-style)

// ====================================================
// GLOBAL STATE
// ====================================================
let map;
let startMarker, endMarker, userMarker, userAccuracyCircle;
let routePolylineBg, routePolyline;      // bg = white shadow underneath
let startCoords = null;
let endCoords   = null;
let watchId     = null;

// Navigation state
let navWatchId          = null;
let navRouteGeometry    = [];
let navRemainingGeometry = [];
let navIsActive         = false;
let navAutoFollow       = true;          // camera follows user
let navLastRecalcTime   = 0;            // throttle recalculation
let navGpsLastLat       = null;
let navGpsLastLng       = null;
let navHeading          = 0;            // degrees, 0 = north
let navUserArrowEl      = null;         // DOM reference to arrow div
let navGpsLogTimer      = 0;            // throttle GPS history log
let navSmoothedLat      = null;         // Kalman-smoothed lat
let navSmoothedLng      = null;         // Kalman-smoothed lng

// --- GPS Calibration & Kalman State ---
let gpsInitSamples = [];
let gpsInitialized = false;
let lastDisplayedLat = null;
let lastDisplayedLng = null;
let lastDisplayedAccuracy = 999;
let smoothedHeading = null;

class KalmanFilter {
    // Tighter noise values → faster convergence + higher precision
    constructor(processNoise = 0.0000015, measurementNoise = 0.000008, estimatedError = 1.0) {
        this.q = processNoise;
        this.r = measurementNoise;
        this.x = null;
        this.p = estimatedError;
    }
    filter(measurement, accuracy) {
        // Scale measurement noise directly with GPS accuracy (metres)
        const noise = Math.max(accuracy * accuracy * 0.00000005, 0.0000001);
        this.r = noise;
        if (this.x === null) {
            this.x = measurement;
            return measurement;
        }
        this.p = this.p + this.q;
        const k = this.p / (this.p + this.r);
        this.x = this.x + k * (measurement - this.x);
        this.p = (1 - k) * this.p;
        return this.x;
    }
    reset() {
        this.x = null;
        this.p = 1.0;
    }
}

const kalmanLat = new KalmanFilter();
const kalmanLng = new KalmanFilter();

const campusCenter = [10.4206, 105.6436];
const CAMPUS_BOUNDS = { minLat: 10.415, maxLat: 10.425, minLng: 105.638, maxLng: 105.648 };
const MOCK_LAT = 10.420601, MOCK_LNG = 105.643611, MOCK_ACC = 4.2;
const OFF_ROUTE_THRESHOLD_M = 30;       // trigger recalculation
const RECALC_COOLDOWN_MS    = 15000;    // min 15 sec between recalculations

// Parse JSON payloads from Django template
const campusLocations = JSON.parse(document.getElementById('locations-data').textContent);
const campusNodes     = JSON.parse(document.getElementById('nodes-data').textContent);
const campusEdges     = JSON.parse(document.getElementById('edges-data').textContent);

// ====================================================
// INIT
// ====================================================
document.addEventListener('DOMContentLoaded', function () {
    map = L.map('map', { fullscreenControl: false, zoomControl: false }).setView(campusCenter, 17);
    L.control.zoom({ position: 'topright' }).addTo(map);
    if (L.control.fullscreen) {
        L.control.fullscreen({ position: 'topright' }).addTo(map);
    }

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    L.control.scale({ imperial: false }).addTo(map);

    drawPoiMarkers();

    document.getElementById('my-location-btn').addEventListener('click', handleMyLocationClick);
    document.getElementById('calculate-btn').addEventListener('click', calculateSmartRoute);
    document.getElementById('reset-btn').addEventListener('click', resetRoutingState);
    document.getElementById('nav-recenter-btn').addEventListener('click', recenterOnUser);
    document.getElementById('nav-recalculate-btn').addEventListener('click', triggerManualRecalculate);

    map.on('click', handleMapClick);
    map.on('drag', () => { navAutoFollow = false; showCenterBtn(true); });

    const poiItems = document.querySelectorAll('.list-item-poi');
    poiItems.forEach(item => {
        item.addEventListener('click', function () {
            const lat = parseFloat(this.dataset.lat);
            const lng = parseFloat(this.dataset.lng);
            map.setView([lat, lng], 18);
            L.popup()
                .setLatLng([lat, lng])
                .setContent(buildPopupHtml(this.dataset.name, this.dataset.desc, this.dataset.address, lat, lng))
                .openOn(map);
        });
    });

    document.getElementById('search-address-btn').addEventListener('click', searchNominatimAddress);

    const stars = document.querySelectorAll('.star-btn');
    stars.forEach(star => {
        star.addEventListener('click', function () {
            const val = parseInt(this.dataset.val);
            document.getElementById('feedback-rating').value = val;
            stars.forEach(s => {
                const sVal = parseInt(s.dataset.val);
                s.classList.toggle('active', sVal <= val);
                if (sVal <= val) s.classList.replace('fa-regular', 'fa-solid');
                else s.classList.replace('fa-solid', 'fa-regular');
            });
        });
    });
    if (stars && stars.length >= 5) stars[4].click();

    const fbForm = document.getElementById('feedback-form');
    if (fbForm) fbForm.addEventListener('submit', submitFeedbackForm);
});

// ====================================================
// POI MARKERS
// ====================================================
function drawPoiMarkers() {
    campusLocations.forEach(loc => {
        let iconClass = 'fa-building';
        if (loc.category_slug.includes('cong'))      iconClass = 'fa-door-open';
        else if (loc.category_slug.includes('xe'))   iconClass = 'fa-square-parking';
        else if (loc.category_slug.includes('the-thao')) iconClass = 'fa-basketball';
        else if (loc.category_slug.includes('tien-ich'))  iconClass = 'fa-circle-info';

        const icon = L.divIcon({
            html: `<div class="p-1 bg-primary text-white rounded-circle shadow border border-white d-flex align-items-center justify-content-center" style="width:32px;height:32px;"><i class="fa-solid ${iconClass}" style="font-size:13px;"></i></div>`,
            className: 'custom-poi-marker-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });
        L.marker([loc.lat, loc.lng], { icon }).addTo(map)
            .bindPopup(buildPopupHtml(loc.name, loc.desc, loc.address, loc.lat, loc.lng));
    });
}

function buildPopupHtml(name, desc, address, lat, lng) {
    return `
        <div class="text-white p-2" style="max-width:250px;">
            <h6 class="fw-bold mb-1 border-bottom border-secondary pb-1 text-primary"><i class="fa-solid fa-location-dot me-1"></i>${name}</h6>
            ${desc    ? `<p class="small text-white mb-1"><strong>Mô tả:</strong> ${desc}</p>` : ''}
            ${address ? `<p class="small text-white-50 mb-2" style="font-size:11px;"><i class="fa-solid fa-map-pin me-1 text-success"></i>${address}</p>` : ''}
            <div class="d-flex gap-2">
                <button onclick="setRoutingPoint('start',${lat},${lng},'${name}')" class="btn btn-xs btn-primary p-1 text-white small px-2 rounded" style="font-size:11px;"><i class="fa-solid fa-flag-checkered me-1"></i>Điểm xuất phát</button>
                <button onclick="setRoutingPoint('end',${lat},${lng},'${name}')" class="btn btn-xs btn-success p-1 text-white small px-2 rounded" style="font-size:11px;"><i class="fa-solid fa-location-arrow me-1"></i>Điểm đến</button>
            </div>
        </div>`;
}

// ====================================================
// ROUTING POINT SETUP
// ====================================================
function setRoutingPoint(type, lat, lng, name) {
    if (type === 'start') {
        startCoords = { lat, lng };
        document.getElementById('start-input').value = name || `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (startMarker) {
            map.removeLayer(startMarker);
            startMarker = null;
        }
        
        // Only draw startMarker if it is NOT the user's live GPS location to avoid duplicate overlap with green arrow userMarker
        if (name !== 'Vị trí của tôi (GPS)') {
            startMarker = L.marker([lat, lng], {
                draggable: true,
                icon: L.divIcon({ html: `<i class="fa-solid fa-circle-play text-primary fs-3 shadow animate-pulse"></i>`, className: 'start-marker-icon', iconSize: [24, 24], iconAnchor: [12, 12] })
            }).addTo(map);
            startMarker.on('dragend', e => {
                const p = startMarker.getLatLng();
                startCoords = { lat: p.lat, lng: p.lng };
                document.getElementById('start-input').value = `Vị trí tùy chỉnh (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
                if (startCoords && endCoords) calculateSmartRoute();
            });
        }
    } else {
        endCoords = { lat, lng };
        document.getElementById('end-input').value = name || `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (endMarker) map.removeLayer(endMarker);
        endMarker = L.marker([lat, lng], {
            draggable: true,
            icon: L.divIcon({ html: `<i class="fa-solid fa-circle-stop text-success fs-3 shadow animate-pulse"></i>`, className: 'end-marker-icon', iconSize: [24, 24], iconAnchor: [12, 12] })
        }).addTo(map);
        endMarker.on('dragend', e => {
            const p = endMarker.getLatLng();
            endCoords = { lat: p.lat, lng: p.lng };
            document.getElementById('end-input').value = `Điểm đến tùy chỉnh (${p.lat.toFixed(5)}, ${p.lng.toFixed(5)})`;
            if (startCoords && endCoords) calculateSmartRoute();
        });
    }
    map.closePopup();
}

function handleMapClick(e) {
    if (!startCoords) setRoutingPoint('start', e.latlng.lat, e.latlng.lng);
    else if (!endCoords) setRoutingPoint('end', e.latlng.lat, e.latlng.lng);
}

// ====================================================
// RESET
// ====================================================
function resetRoutingState() {
    stopLiveNavigation();
    navRouteGeometry     = [];
    navRemainingGeometry = [];
    navAutoFollow        = true;

    startCoords = null;
    endCoords   = null;
    document.getElementById('start-input').value = '';
    document.getElementById('end-input').value   = '';

    if (startMarker)       map.removeLayer(startMarker);
    if (endMarker)         map.removeLayer(endMarker);
    clearRoutePolylines();

    document.getElementById('route-result-panel').classList.add('d-none');
    hideNavHud();
    showCenterBtn(false);
    map.setView(campusCenter, 17);
}

// ====================================================
// GPS TRACKING (watchPosition with calibration & Kalman filtering)
// ====================================================
// Maximum-accuracy GPS options — used for both watchPosition & getCurrentPosition
const GPS_OPTIONS = {
    enableHighAccuracy: true,   // force hardware GPS chip
    maximumAge:         0,      // never use cached position
    timeout:            6000    // fail fast so fallback triggers sooner
};

function startGPSTracking() {
    if (!navigator.geolocation) {
        alert('Trình duyệt không hỗ trợ định vị GPS.');
        return;
    }
    const btn = document.getElementById('my-location-btn');
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active text-primary" id="gps-btn-icon"></i>`;

    // Reset calibration and Kalman state
    gpsInitSamples = [];
    gpsInitialized = false;
    lastDisplayedLat = null;
    lastDisplayedLng = null;
    smoothedHeading = null;
    kalmanLat.reset();
    kalmanLng.reset();

    // Stop previous watcher
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }

    // Pre-warm: get a quick initial fix, then hand off to watchPosition
    navigator.geolocation.getCurrentPosition(
        pos => { onGPSUpdate(pos, btn); },
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 }
    );

    watchId = navigator.geolocation.watchPosition(
        pos => onGPSUpdate(pos, btn),
        err => onGPSFallback(btn),
        GPS_OPTIONS
    );
}

function getUserLocation() { startGPSTracking(); }   // alias for legacy calls

function onGPSUpdate(position, btn) {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;
    const acc = position.coords.accuracy;

    const inCampus = lat >= CAMPUS_BOUNDS.minLat && lat <= CAMPUS_BOUNDS.maxLat &&
                     lng >= CAMPUS_BOUNDS.minLng && lng <= CAMPUS_BOUNDS.maxLng;

    if (!inCampus) {
        lat = MOCK_LAT; lng = MOCK_LNG;
        showToastNotification('Phát hiện bạn ở ngoài trường. Đã kích hoạt GPS mô phỏng trong DTHU!');
    }

    // A. Reject readings with very poor accuracy (>80m = signal too weak)
    if (acc > 80) return;

    // Warn if accuracy is moderate
    if (acc > 25) {
        showToastNotification(`Tín hiệu định vị yếu (${Math.round(acc)}m). Vui lòng ra ngoài trời để cải thiện.`);
    }

    // B. Multi-sample calibration: collect best 3 samples, then lock in
    if (!gpsInitialized) {
        gpsInitSamples.push({ lat, lng, acc, position });

        // Always show the best-accuracy sample seen so far
        const sortedSamples = gpsInitSamples.slice().sort((a, b) => a.acc - b.acc);
        const currentBest = sortedSamples[0];
        lat = currentBest.lat;
        lng = currentBest.lng;

        if (gpsInitSamples.length >= 3) {
            gpsInitialized = true;
            gpsInitSamples = [];
            showToastNotification('✅ Đã định vị! Độ chính xác: ~' + Math.round(acc) + 'm');
        }
    }

    // C. Kalman Filter smoothing logic
    const kLat = kalmanLat.filter(lat, acc);
    const kLng = kalmanLng.filter(lng, acc);

    // D. Minimum movement threshold (ignore movements smaller than 2.5 meters unless accuracy improved significantly)
    let shouldUpdate = false;
    if (lastDisplayedLat === null) {
        shouldUpdate = true;
    } else {
        const movedMeters = haversineDistanceM(lastDisplayedLat, lastDisplayedLng, kLat, kLng);
        const accuracyImproved = acc < (lastDisplayedAccuracy - 3);
        if (movedMeters >= 1.0 || accuracyImproved) {
            shouldUpdate = true;
        }
    }

    if (!shouldUpdate) {
        return; // Ignore tiny coordinate jitter
    }

    lastDisplayedLat = kLat;
    lastDisplayedLng = kLng;
    lastDisplayedAccuracy = acc;

    // E. Rotation heading update priority
    let newHeading = navHeading || 0;
    if (position.coords.heading !== null && position.coords.heading !== undefined && position.coords.speed > 0.5) {
        newHeading = position.coords.heading;
    } else if (navGpsLastLat !== null) {
        const moved = haversineDistanceM(navGpsLastLat, navGpsLastLng, kLat, kLng);
        if (moved > 2) {
            newHeading = computeBearing(navGpsLastLat, navGpsLastLng, kLat, kLng);
        }
    }
    navGpsLastLat = kLat;
    navGpsLastLng = kLng;

    // Smooth heading using low pass filter
    if (smoothedHeading === null) {
        smoothedHeading = newHeading;
    } else {
        let diff = newHeading - smoothedHeading;
        if (diff > 180) diff -= 360;
        if (diff < -180) diff += 360;
        smoothedHeading = (smoothedHeading + 0.3 * diff + 360) % 360;
    }

    updateUserMarker(kLat, kLng, acc, smoothedHeading);
    updateGPSPanel(kLat, kLng, acc);

    if (btn) btn.innerHTML = `<i class="fa-solid fa-location-crosshairs text-success" id="gps-btn-icon"></i>`;

    setRoutingPoint('start', kLat, kLng, 'Vị trí của tôi (GPS)');

    if (navAutoFollow) {
        map.setView([kLat, kLng], map.getZoom(), { animate: true, duration: 0.5 });
    }
    showCenterBtn(true);

    const now = Date.now();
    if (document.body.dataset.auth === 'true' && now - navGpsLogTimer > 10000) {
        navGpsLogTimer = now;
        logGPSCoordinates(kLat, kLng, acc);
    }

    if (navIsActive && navRemainingGeometry.length >= 2) {
        updateNavigation(kLat, kLng);
    }
}

function onGPSFallback(btn) {
    const lat = MOCK_LAT, lng = MOCK_LNG, acc = MOCK_ACC;
    gpsInitialized = true;
    lastDisplayedLat = lat;
    lastDisplayedLng = lng;
    lastDisplayedAccuracy = acc;
    smoothedHeading = 0;
    updateUserMarker(lat, lng, acc, 0);
    updateGPSPanel(lat, lng, acc);
    setRoutingPoint('start', lat, lng, 'Vị trí của tôi (GPS)');
    if (btn) btn.innerHTML = `<i class="fa-solid fa-location-crosshairs text-success" id="gps-btn-icon"></i>`;
    showCenterBtn(true);
}

// ====================================================
// USER MARKER (directional arrow)
// ====================================================
function updateUserMarker(lat, lng, accuracy, heading) {
    // Update or create accuracy circle
    if (!userAccuracyCircle) {
        userAccuracyCircle = L.circle([lat, lng], {
            radius: accuracy,
            color: '#10b981', fillColor: '#10b981', fillOpacity: 0.12, weight: 1
        }).addTo(map);
    } else {
        userAccuracyCircle.setLatLng([lat, lng]);
        userAccuracyCircle.setRadius(accuracy);
    }

    // Arrow icon: teardrop shape rotated by heading
    const arrowHtml = `<div class="user-arrow-inner pulsing" style="transform: rotate(${heading - 45}deg);"></div>`;

    if (!userMarker) {
        const arrowIcon = L.divIcon({
            html: arrowHtml,
            className: 'user-arrow-marker',
            iconSize: [22, 22],
            iconAnchor: [11, 11]
        });
        userMarker = L.marker([lat, lng], { icon: arrowIcon, zIndexOffset: 500 }).addTo(map);
        navUserArrowEl = null;
    } else {
        userMarker.setLatLng([lat, lng]);
        // Update arrow rotation without recreating the DOM
        if (!navUserArrowEl) {
            navUserArrowEl = userMarker.getElement()?.querySelector('.user-arrow-inner');
        }
        if (navUserArrowEl) {
            navUserArrowEl.style.transform = `rotate(${heading - 45}deg)`;
        }
    }
}

function updateGPSPanel(lat, lng, acc) {
    document.getElementById('gps-status-panel').classList.remove('d-none');
    document.getElementById('gps-lat').innerText = lat.toFixed(6);
    document.getElementById('gps-lng').innerText = lng.toFixed(6);
    document.getElementById('gps-acc').innerText = `${acc.toFixed(1)}m`;
}

// ====================================================
// CALCULATE ROUTE
// ====================================================
async function calculateSmartRoute() {
    if (!startCoords || !endCoords) {
        alert('Vui lòng chọn đầy đủ Điểm đi và Điểm đến!');
        return;
    }
    const calcBtn = document.getElementById('calculate-btn');
    calcBtn.disabled = true;
    calcBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active me-1"></i>Đang tính toán...`;

    const algorithm = document.getElementById('algorithm-select').value;
    const csrfToken = getCookie('csrftoken');

    try {
        const response = await fetch('/api/routes/calculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrfToken },
            body: JSON.stringify({
                start_lat: startCoords.lat, start_lng: startCoords.lng,
                end_lat:   endCoords.lat,   end_lng:   endCoords.lng,
                algorithm,
                start_name: document.getElementById('start-input').value,
                end_name:   document.getElementById('end-input').value
            })
        });

        const data = await response.json();
        if (!response.ok) { alert(data.error || 'Lỗi tính toán đường đi.'); return; }

        drawRoutePolyline(data.primary.geometry);

        document.getElementById('route-result-panel').classList.remove('d-none');
        document.getElementById('route-distance').innerText = `${data.primary.distance_m} mét (${data.primary.distance_km} km)`;
        const m = Math.floor(data.primary.duration_s / 60), s = Math.round(data.primary.duration_s % 60);
        document.getElementById('route-duration').innerText = `${m} phút ${s} giây`;

        populateAlgorithmComparison(data);
        showNavHud(document.getElementById('end-input').value, data.primary.distance_m, data.primary.duration_s);
    } catch (err) {
        console.error('Route calculation failed', err);
        alert('Lỗi kết nối tới máy chủ Django.');
    } finally {
        calcBtn.disabled = false;
        calcBtn.innerHTML = `<i class="fa-solid fa-compass me-1"></i>Tìm đường`;
    }
}

// ====================================================
// ROUTE POLYLINE DRAWING
// ====================================================
function clearRoutePolylines() {
    if (routePolylineBg) { map.removeLayer(routePolylineBg); routePolylineBg = null; }
    if (routePolyline)   { map.removeLayer(routePolyline);   routePolyline   = null; }
}

function drawRoutePolyline(geometry) {
    clearRoutePolylines();

    // Geometry is already cleaned by backend (deduped + GPS prepend)
    navRouteGeometry     = geometry.slice();
    navRemainingGeometry = geometry.slice();

    // White shadow (outline) underneath
    routePolylineBg = L.polyline(geometry, {
        color: '#ffffff', weight: 9, opacity: 0.35,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 2
    }).addTo(map);

    // Main blue route
    routePolyline = L.polyline(geometry, {
        color: '#3b82f6', weight: 5, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 2
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds(), { padding: [50, 50], animate: true });

    // Begin live navigation
    startLiveNavigation();
}

function redrawRemainingRoute(geom) {
    clearRoutePolylines();
    if (geom.length < 2) return;
    routePolylineBg = L.polyline(geom, {
        color: '#ffffff', weight: 9, opacity: 0.35,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 2
    }).addTo(map);
    routePolyline = L.polyline(geom, {
        color: '#3b82f6', weight: 5, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 2
    }).addTo(map);
}

// ====================================================
// LIVE NAVIGATION ENGINE
// ====================================================
function startLiveNavigation() {
    navIsActive   = true;
    navAutoFollow = true;
}

function stopLiveNavigation() {
    navIsActive = false;
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }
}

function updateNavigation(lat, lng) {
    // 1. Check arrival
    if (endCoords) {
        const distToEnd = haversineDistanceM(lat, lng, endCoords.lat, endCoords.lng);
        if (distToEnd < 15) {
            stopLiveNavigation();
            clearRoutePolylines();
            hideNavHud();
            showToastNotification('🎉 Bạn đã đến nơi! Chúc mừng!');
            return;
        }
    }

    // 2. Check off-route (> 30m)
    const distToRoute = distanceToPolyline(lat, lng, navRemainingGeometry);
    const now = Date.now();
    if (distToRoute > OFF_ROUTE_THRESHOLD_M && (now - navLastRecalcTime) > RECALC_COOLDOWN_MS) {
        navLastRecalcTime = now;
        showToastNotification('📍 Đã lệch đường, đang tính lại tuyến đường...');
        autoRecalculateRoute(lat, lng);
        return;
    }

    // 3. Trim passed segments
    navRemainingGeometry = trimPassedSegments(lat, lng, navRemainingGeometry);
    // Prepend snapped user position as the polyline start
    const snap = snapToPolyline(lat, lng, navRemainingGeometry);
    const displayGeom = [[snap.lat, snap.lng], ...navRemainingGeometry.slice(1)];
    redrawRemainingRoute(displayGeom);

    // 4. Update HUD remaining distance/time
    const remaining = distanceAlongGeometry(navRemainingGeometry);
    const remMin = Math.floor(remaining / 1.2 / 60), remSec = Math.round((remaining / 1.2) % 60);
    document.getElementById('nav-remaining-dist').innerText =
        remaining > 1000 ? `${(remaining / 1000).toFixed(2)} km` : `${Math.round(remaining)} m`;
    document.getElementById('nav-remaining-time').innerText = `${remMin} phút ${remSec} giây`;

    // 5. Auto-follow camera
    if (navAutoFollow) {
        map.panTo([lat, lng], { animate: true, duration: 0.4, easeLinearity: 0.5 });
    }
}

async function autoRecalculateRoute(lat, lng) {
    if (!endCoords) return;
    try {
        const res = await fetch('/api/routes/recalculate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({
                user_lat: lat, user_lng: lng,
                end_lat: endCoords.lat, end_lng: endCoords.lng,
                end_name: document.getElementById('end-input').value
            })
        });
        if (!res.ok) return;
        const data = await res.json();
        navRemainingGeometry = data.geometry.slice();
        navRouteGeometry     = data.geometry.slice();
        redrawRemainingRoute(data.geometry);
        showNavHud(data.end_name, data.distance_m, data.duration_s);
    } catch (e) {
        console.warn('Recalculate failed', e);
    }
}

async function triggerManualRecalculate() {
    if (!userMarker || !endCoords) return;
    const ll = userMarker.getLatLng();
    navLastRecalcTime = 0;    // allow immediate
    await autoRecalculateRoute(ll.lat, ll.lng);
    showToastNotification('🔄 Đã tính lại tuyến đường từ vị trí hiện tại!');
}

// ====================================================
// NAV HUD
// ====================================================
function showNavHud(destName, distM, durS) {
    const hud = document.getElementById('nav-hud');
    hud.classList.remove('d-none');
    document.getElementById('nav-dest-name').innerText = destName || '--';
    const m = Math.floor(durS / 60), s = Math.round(durS % 60);
    document.getElementById('nav-remaining-dist').innerText =
        distM > 1000 ? `${(distM / 1000).toFixed(2)} km` : `${Math.round(distM)} m`;
    document.getElementById('nav-remaining-time').innerText = `${m} phút ${s} giây`;
}

function hideNavHud() {
    document.getElementById('nav-hud').classList.add('d-none');
}

function handleMyLocationClick() {
    if (watchId === null) {
        startGPSTracking();
    } else {
        recenterOnUser();
    }
}

function showCenterBtn(show) {
    const icon = document.getElementById('gps-btn-icon');
    if (!icon) return;
    if (show) {
        icon.classList.remove('text-success');
    } else {
        icon.classList.add('text-success');
    }
}

function recenterOnUser() {
    navAutoFollow = true;
    showCenterBtn(false);
    if (userMarker) {
        const ll = userMarker.getLatLng();
        map.setView([ll.lat, ll.lng], 18, { animate: true, duration: 0.6 });
    }
}

// ====================================================
// GEOMETRY HELPERS
// ====================================================
function snapToPolyline(lat, lng, geometry) {
    if (!geometry || geometry.length === 0) return { lat, lng };
    let bestLat = geometry[0][0], bestLng = geometry[0][1], bestDist = Infinity;
    for (let i = 0; i < geometry.length - 1; i++) {
        const s = closestPointOnSegment(lat, lng, geometry[i][0], geometry[i][1], geometry[i+1][0], geometry[i+1][1]);
        const d = haversineDistanceM(lat, lng, s.lat, s.lng);
        if (d < bestDist) { bestDist = d; bestLat = s.lat; bestLng = s.lng; }
    }
    return { lat: bestLat, lng: bestLng };
}

function closestPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
    const dx = bLng - aLng, dy = bLat - aLat;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { lat: aLat, lng: aLng };
    let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { lat: aLat + t * dy, lng: aLng + t * dx };
}

function distanceToPolyline(lat, lng, geometry) {
    if (!geometry || geometry.length < 2) return Infinity;
    let minD = Infinity;
    for (let i = 0; i < geometry.length - 1; i++) {
        const s = closestPointOnSegment(lat, lng, geometry[i][0], geometry[i][1], geometry[i+1][0], geometry[i+1][1]);
        const d = haversineDistanceM(lat, lng, s.lat, s.lng);
        if (d < minD) minD = d;
    }
    return minD;
}

function trimPassedSegments(lat, lng, geometry) {
    if (!geometry || geometry.length < 2) return geometry;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < geometry.length - 1; i++) {
        const s = closestPointOnSegment(lat, lng, geometry[i][0], geometry[i][1], geometry[i+1][0], geometry[i+1][1]);
        const d = haversineDistanceM(lat, lng, s.lat, s.lng);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    return geometry.slice(bestIdx);
}

function distanceAlongGeometry(geometry) {
    let total = 0;
    for (let i = 0; i < geometry.length - 1; i++)
        total += haversineDistanceM(geometry[i][0], geometry[i][1], geometry[i+1][0], geometry[i+1][1]);
    return total;
}

function haversineDistanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLat = r(lat2 - lat1), dLng = r(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function computeBearing(lat1, lng1, lat2, lng2) {
    const r = x => x * Math.PI / 180;
    const dLng = r(lng2 - lng1);
    const y = Math.sin(dLng) * Math.cos(r(lat2));
    const x = Math.cos(r(lat1)) * Math.sin(r(lat2)) - Math.sin(r(lat1)) * Math.cos(r(lat2)) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

// ====================================================
// DEVICE ORIENTATION (heading from compass when available)
// ====================================================
if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientationabsolute', e => {
        if (e.alpha !== null) {
            navHeading = (360 - e.alpha) % 360;
            if (navUserArrowEl) navUserArrowEl.style.transform = `rotate(${navHeading - 45}deg)`;
        }
    }, true);
}

// ====================================================
// NOMINATIM SEARCH
// ====================================================
async function searchNominatimAddress() {
    const query = document.getElementById('search-address-input').value.trim();
    if (!query) return;
    const btn = document.getElementById('search-address-btn');
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active text-primary"></i>`;
    try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`, { headers: { 'Accept-Language': 'vi,en;q=0.8' } });
        const data = await res.json();
        if (data.length > 0) {
            setRoutingPoint('end', parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].name || query);
            map.setView([parseFloat(data[0].lat), parseFloat(data[0].lon)], 17);
        } else {
            alert('Không tìm thấy địa chỉ này trên bản đồ.');
        }
    } catch { alert('Có lỗi khi tìm kiếm địa chỉ.'); }
    finally { btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i>`; }
}

// ====================================================
// ALGORITHM COMPARISON TABLE
// ====================================================
function populateAlgorithmComparison(data) {
    const tb = document.getElementById('metrics-table-body');
    tb.innerHTML = '';
    const d = data.dijkstra, a = data.a_star;
    tb.innerHTML += `<tr><td class="text-start text-white-50">Số nút đã duyệt</td><td class="font-monospace fw-semibold text-danger">${d ? d.visited_nodes + ' nút' : '--'}</td><td class="font-monospace fw-semibold text-success">${a ? a.visited_nodes + ' nút' : '--'}</td></tr>`;
    tb.innerHTML += `<tr><td class="text-start text-white-50">Thời gian chạy (Python)</td><td class="font-monospace text-danger">${d ? d.exec_time_ms.toFixed(4) + ' ms' : '--'}</td><td class="font-monospace text-success">${a ? a.exec_time_ms.toFixed(4) + ' ms' : '--'}</td></tr>`;
    tb.innerHTML += `<tr><td class="text-start text-white-50">Số nút trên tuyến</td><td class="font-monospace">${d ? d.path_nodes.length + ' nút' : '--'}</td><td class="font-monospace">${a ? a.path_nodes.length + ' nút' : '--'}</td></tr>`;
    document.getElementById('path-diagram').innerText = data.primary.text_diagram;
    if (data.comparison) {
        let explain = `Cả hai thuật toán đều tìm ra cùng một khoảng cách tối ưu (${data.primary.distance_m}m). `;
        explain += data.comparison.a_star_visited < data.comparison.dijkstra_visited
            ? `Thuật toán A* duyệt ít hơn Dijkstra ${data.comparison.dijkstra_visited - data.comparison.a_star_visited} nút (hiệu quả hơn ${data.comparison.efficiency_gain}%).`
            : `Do đồ thị nhỏ, số lượng nút duyệt của A* và Dijkstra là tương đương nhau.`;
        document.getElementById('algo-explanation-text').innerText = explain;
    } else {
        document.getElementById('algo-explanation-text').innerText = `Tuyến đường được tính toán thành công bằng ${data.primary.algorithm}.`;
    }
}

// ====================================================
// TOAST NOTIFICATION
// ====================================================
function showToastNotification(message) {
    document.querySelectorAll('.custom-map-toast').forEach(e => e.remove());
    const toast = document.createElement('div');
    toast.className = 'custom-map-toast alert alert-warning border-0 bg-warning text-dark shadow position-fixed start-50 translate-middle-x p-3 rounded text-center fw-bold small';
    toast.style.cssText = 'top:20px;z-index:9999;min-width:320px;max-width:90%;border-radius:30px!important;box-shadow:0 10px 25px rgba(0,0,0,.5)!important;';
    toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2 animate-pulse"></i> ${message}`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transition = 'all 0.5s ease'; toast.style.opacity = '0'; toast.style.transform = 'translate(-50%,-20px)'; setTimeout(() => toast.remove(), 500); }, 4500);
}

// ====================================================
// GPS HISTORY LOG
// ====================================================
async function logGPSCoordinates(lat, lng, accuracy) {
    try {
        await fetch('/api/history/gps/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), accuracy })
        });
    } catch {}
}

// ====================================================
// FEEDBACK FORM
// ====================================================
async function submitFeedbackForm(e) {
    e.preventDefault();
    const subject = document.getElementById('feedback-subject').value.trim();
    const message = document.getElementById('feedback-message').value.trim();
    const rating  = document.getElementById('feedback-rating').value;
    try {
        const res = await fetch('/api/feedbacks/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ subject, message, rating })
        });
        if (res.ok) {
            alert('Cảm ơn bạn đã gửi ý kiến đóng góp cho hệ thống!');
            document.getElementById('feedback-subject').value = '';
            document.getElementById('feedback-message').value = '';
            const stars = document.querySelectorAll('.star-btn');
            if (stars.length >= 5) stars[4].click();
        } else {
            const d = await res.json();
            alert(d.detail || 'Lỗi gửi phản hồi.');
        }
    } catch { alert('Lỗi kết nối tới máy chủ Django khi gửi phản hồi.'); }
}

// ====================================================
// CSRF COOKIE HELPER
// ====================================================
function getCookie(name) {
    if (!document.cookie) return null;
    for (const raw of document.cookie.split(';')) {
        const cookie = raw.trim();
        if (cookie.startsWith(name + '=')) return decodeURIComponent(cookie.slice(name.length + 1));
    }
    return null;
}

// ====================================================
// ROUTING POINT SETTERS (used by popup buttons)
// ====================================================
// setRoutingPoint is already defined above (used globally via onclick="")
