// client/map_client.js — Navigation System v2 (Google Maps-style)

// ====================================================
// GLOBAL STATE
// ====================================================
let map;
let startMarker, endMarker, userMarker, userAccuracyCircle;
let routePolylineBg, routePolyline;      // bg = white shadow underneath
let debugGraphLayer = null;              // Layer group for debugging nodes/edges
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
const GPS_LOW_ACCURACY_THRESHOLD_M = 15; // Ngưỡng sai số định vị (m) - lớn hơn mức này sẽ báo GPS yếu

// Parse JSON payloads from Django template
const campusLocations = JSON.parse(document.getElementById('locations-data').textContent);
const campusNodes     = JSON.parse(document.getElementById('nodes-data').textContent);
const campusEdges     = JSON.parse(document.getElementById('edges-data').textContent);
const campusBuildingPolygons = JSON.parse(document.getElementById('building-polygons-data').textContent);

// ====================================================
// SHARED POLYGON STYLE (buildings + sports areas)
// ====================================================
const POLYGON_STYLE = {
    color: '#2563EB',
    weight: 2,
    opacity: 1,
    fillColor: '#60A5FA',
    fillOpacity: 0.15,
    interactive: false
};

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

    // Draw Building & Sports Area Polygons (shared blue style)
    if (typeof campusBuildingPolygons !== 'undefined' && campusBuildingPolygons) {
        campusBuildingPolygons.forEach((poly) => {
            L.polygon(poly, POLYGON_STYLE).addTo(map);
        });
    }

    document.getElementById('my-location-btn').addEventListener('click', handleMyLocationClick);
    document.getElementById('calculate-btn').addEventListener('click', calculateSmartRoute);
    document.getElementById('reset-btn').addEventListener('click', resetRoutingState);
    document.getElementById('nav-recenter-btn').addEventListener('click', recenterOnUser);
    document.getElementById('nav-recalculate-btn').addEventListener('click', triggerManualRecalculate);

    const debugSwitch = document.getElementById('debug-graph-switch');
    if (debugSwitch) {
        debugSwitch.addEventListener('change', toggleDebugGraph);
    }

    const editorSwitch = document.getElementById('editor-mode-switch');
    if (editorSwitch) {
        editorSwitch.addEventListener('change', toggleEditorMode);
    }

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
            stopGPSTracking();
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
    if (editorMode && handleEditorMapClick(e)) return;
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    L.popup()
        .setLatLng([lat, lng])
        .setContent(buildPopupHtml('Tọa độ đã chọn', `${lat.toFixed(5)}, ${lng.toFixed(5)}`, `Vĩ độ: ${lat.toFixed(6)}<br>Kinh độ: ${lng.toFixed(6)}`, lat, lng))
        .openOn(map);
}

// ====================================================
// RESET
// ====================================================
function resetRoutingState() {
    stopGPSTracking();
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

    // Exit editor mode if active
    if (editorMode) {
        const switchEl = document.getElementById('editor-mode-switch');
        if (switchEl) switchEl.checked = false;
        toggleEditorMode();
    }

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

function stopGPSTracking() {
    if (watchId !== null) {
        navigator.geolocation.clearWatch(watchId);
        watchId = null;
    }
    const btn = document.getElementById('my-location-btn');
    if (btn) {
        btn.innerHTML = `<i class="fa-solid fa-location-crosshairs" id="gps-btn-icon"></i>`;
    }
    if (userAccuracyCircle) {
        map.removeLayer(userAccuracyCircle);
        userAccuracyCircle = null;
    }
    if (userMarker) {
        map.removeLayer(userMarker);
        userMarker = null;
    }
    document.getElementById('gps-status-panel').classList.add('d-none');
    showCenterBtn(false);
    gpsInitialized = false;
    gpsInitSamples = [];
}

/**
 * Snap a raw GPS coordinate to the nearest campus building/location.
 * Returns { lat, lng, name } of the closest campusLocation entry.
 */
function snapToNearestBuilding(lat, lng) {
    if (!campusLocations || campusLocations.length === 0) return null;
    let best = null, bestDist = Infinity;
    campusLocations.forEach(loc => {
        if (!loc.latitude || !loc.longitude) return;
        const d = haversineDistanceM(lat, lng, parseFloat(loc.latitude), parseFloat(loc.longitude));
        if (d < bestDist) {
            bestDist = d;
            best = { lat: parseFloat(loc.latitude), lng: parseFloat(loc.longitude), name: loc.name, dist: d };
        }
    });
    return best;
}

let _buildingConfirmShown = false; // prevent repeated confirmation popups

function onGPSUpdate(position, btn) {
    let lat = position.coords.latitude;
    let lng = position.coords.longitude;
    const acc = position.coords.accuracy;

    const inCampus = lat >= CAMPUS_BOUNDS.minLat && lat <= CAMPUS_BOUNDS.maxLat &&
                     lng >= CAMPUS_BOUNDS.minLng && lng <= CAMPUS_BOUNDS.maxLng;

    // --- GPS Quality Gate ---
    let usingMock = false;
    if (!inCampus) {
        // Outside campus → use mock located inside DTHU campus
        showToastNotification('Bạn ở ngoài campus. Đang dùng GPS mô phỏng tại khuôn viên DTHU!');
        lat = MOCK_LAT;
        lng = MOCK_LNG;
        usingMock = true;
    } else if (acc > GPS_LOW_ACCURACY_THRESHOLD_M) {
        // --- Smart Building Snap ---
        // GPS accuracy too poor to pinpoint exact position → snap to nearest building
        // and ask the user to confirm, so a stranger can understand where they are.
        const nearest = snapToNearestBuilding(lat, lng);
        if (nearest) {
            lat = nearest.lat;
            lng = nearest.lng;

            if (!_buildingConfirmShown) {
                _buildingConfirmShown = true;
                const popupContent = `
                    <div style="font-family:sans-serif;min-width:200px">
                        <div style="font-weight:700;font-size:14px;margin-bottom:6px">📍 Vị trí của bạn</div>
                        <div style="margin-bottom:8px">GPS phát hiện bạn đang gần:<br><b>${nearest.name}</b></div>
                        <div style="font-size:12px;color:#666;margin-bottom:10px">Sai số GPS: ~${Math.round(acc)}m</div>
                        <div style="display:flex;gap:6px">
                            <button onclick="confirmBuildingLocation(${nearest.lat},${nearest.lng},'${nearest.name.replace(/'/g, "&#39;")}')"
                                style="flex:1;padding:6px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px">✅ Đúng rồi</button>
                            <button onclick="openBuildingSelector()"
                                style="flex:1;padding:6px;background:#f3f4f6;color:#111;border:1px solid #d1d5db;border-radius:6px;cursor:pointer;font-size:12px">❌ Sai, chọn lại</button>
                        </div>
                    </div>
                `;
                L.popup({ closeButton: true, autoClose: false, closeOnClick: false })
                    .setLatLng([nearest.lat, nearest.lng])
                    .setContent(popupContent)
                    .openOn(map);
                map.setView([nearest.lat, nearest.lng], 18, { animate: true });
            }
        } else {
            showToastNotification(`⚠️ GPS yếu (${Math.round(acc)}m). Vị trí có thể lệch.`);
        }
    }

    // B. Multi-sample calibration: collect best 5 samples, use the most accurate one
    if (!gpsInitialized) {
        gpsInitSamples.push({ lat, lng, acc });

        // Show the best-accuracy sample seen so far
        const sortedSamples = gpsInitSamples.slice().sort((a, b) => a.acc - b.acc);
        const currentBest = sortedSamples[0];
        lat = currentBest.lat;
        lng = currentBest.lng;

        if (gpsInitSamples.length >= 5) {
            gpsInitialized = true;
            gpsInitSamples = [];
            const displayAcc = usingMock ? '~mô phỏng' : Math.round(currentBest.acc) + 'm';
            showToastNotification('✅ Đã định vị! Độ chính xác: ' + displayAcc);
        }
    }

    // C. Kalman Filter smoothing (clamp accuracy to avoid extreme noise weights)
    const effectiveAcc = Math.min(acc, 50);
    const kLat = kalmanLat.filter(lat, effectiveAcc);
    const kLng = kalmanLng.filter(lng, effectiveAcc);

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

/**
 * Called when user confirms the auto-snapped building is correct.
 * Locks in that position as the routing start point.
 */
function confirmBuildingLocation(lat, lng, name) {
    map.closePopup();
    setRoutingPoint('start', lat, lng, name);
    showToastNotification(`✅ Đã xác nhận vị trí: ${name}`);
}

/**
 * Called when user says the auto-snapped building is wrong.
 * Opens a searchable list of all campus locations for manual selection.
 */
function openBuildingSelector() {
    map.closePopup();
    _buildingConfirmShown = false; // allow popup again after manual select

    // Build a scrollable modal-like popup at campus center
    const items = campusLocations.map((loc, i) =>
        `<div onclick="selectBuildingManually(${parseFloat(loc.latitude)},${parseFloat(loc.longitude)},'${loc.name.replace(/'/g,'&#39;')}')"
              style="padding:7px 10px;cursor:pointer;border-bottom:1px solid #eee;font-size:13px"
              onmouseover="this.style.background='#f0f9ff'" onmouseout="this.style.background=''">${loc.name}</div>`
    ).join('');

    const html = `
        <div style="font-family:sans-serif;width:240px;max-height:300px;overflow-y:auto">
            <div style="font-weight:700;padding:8px 10px;border-bottom:2px solid #2563eb;font-size:14px">🏛️ Chọn tòa nhà của bạn</div>
            ${items}
        </div>
    `;
    L.popup({ closeButton: true, maxWidth: 260 })
        .setLatLng(campusCenter)
        .setContent(html)
        .openOn(map);
}

/** Select a building manually from the list popup. */
function selectBuildingManually(lat, lng, name) {
    map.closePopup();
    updateUserMarker(lat, lng, 5, 0);
    setRoutingPoint('start', lat, lng, name);
    showToastNotification(`📍 Đã đặt vị trí: ${name}`);
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

    // Xóa polyline cũ ngay trước khi gọi API
    clearRoutePolylines();

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

        if (!response.ok) {
            // Hiển thị lỗi từ backend (ví dụ: "Không tìm thấy đường đi")
            showToastNotification('❌ ' + (data.error || 'Lỗi tính toán đường đi.'));
            return;
        }

        const geometry = data.primary.geometry;
        if (!geometry || geometry.length < 2) {
            showToastNotification('❌ Không tìm thấy đường đi giữa hai điểm này.');
            return;
        }

        console.log('[Route] Geometry points:', geometry.length, geometry);
        drawRoutePolyline(geometry);

        document.getElementById('route-result-panel').classList.remove('d-none');
        document.getElementById('route-distance').innerText =
            `${data.primary.distance_m} mét (${data.primary.distance_km} km)`;
        const m = Math.floor(data.primary.duration_s / 60),
              s = Math.round(data.primary.duration_s % 60);
        document.getElementById('route-duration').innerText = `${m} phút ${s} giây`;

        populateAlgorithmComparison(data);
        showNavHud(document.getElementById('end-input').value,
                   data.primary.distance_m, data.primary.duration_s);
    } catch (err) {
        console.error('Route calculation failed', err);
        showToastNotification('❌ Lỗi kết nối tới máy chủ Django.');
    } finally {
        calcBtn.disabled = false;
        calcBtn.innerHTML = `<i class="fa-solid fa-compass me-1"></i>Tìm đường`;
    }
}

// ====================================================
// ROUTE POLYLINE DRAWING
// ====================================================
function clearRoutePolylines() {
    // Luôn xóa sạch cả 2 layer trước khi vẽ mới
    if (routePolylineBg) {
        try { map.removeLayer(routePolylineBg); } catch(e) {}
        routePolylineBg = null;
    }
    if (routePolyline) {
        try { map.removeLayer(routePolyline); } catch(e) {}
        routePolyline = null;
    }
}

/**
 * Vẽ đúng một polyline từ geometry [[lat,lng],...] do backend trả về.
 * Geometry đã được xử lý: start_user → node path → end_user.
 * Không vẽ thêm bất kỳ layer nào khác.
 */
function drawRoutePolyline(geometry) {
    // Bước 1: Xóa polyline cũ
    clearRoutePolylines();

    if (!geometry || geometry.length < 2) {
        console.warn('[Route] Geometry rỗng hoặc quá ngắn, bỏ qua vẽ.');
        return;
    }

    // Bước 2: Lưu geometry cho live navigation
    navRouteGeometry     = geometry.slice();
    navRemainingGeometry = geometry.slice();

    // Bước 3: Vẽ shadow trắng phía dưới (hiệu ứng viền)
    routePolylineBg = L.polyline(geometry, {
        color: '#ffffff', weight: 9, opacity: 0.35,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 1
    }).addTo(map);

    // Bước 4: Vẽ đường màu xanh chính — ĐÂY LÀ POLYLINE DUY NHẤT
    routePolyline = L.polyline(geometry, {
        color: '#3b82f6', weight: 5, opacity: 0.95,
        lineCap: 'round', lineJoin: 'round', smoothFactor: 1
    }).addTo(map);

    // Bước 5: Zoom bản đồ vào đường đi
    map.fitBounds(routePolyline.getBounds(), { padding: [50, 50], animate: true });

    // Bước 6: Bắt đầu live navigation
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
// EDITOR MODE (Quản lý RouteNode & RouteEdge)
// ====================================================
let editorMode = false;
let editorTool = null;         // 'add_node' | 'delete_node' | 'move_node' | 'add_edge' | 'delete_edge'
let editorEdgeFirstNode = null; // First node selected for edge creation
let editorLayers = null;        // L.layerGroup for editor markers/edges
let editorNodeMarkers = {};     // { nodeId: L.marker }
let editorEdgeLines = {};       // { edgeId: L.polyline }

/**
 * Toggle editor mode on/off.
 */
function toggleEditorMode() {
    editorMode = !editorMode;
    const panel = document.getElementById('editor-panel');
    const switchEl = document.getElementById('editor-mode-switch');

    if (editorMode) {
        panel.classList.remove('d-none');
        editorLayers = L.layerGroup().addTo(map);
        loadEditorGraph();
        map.getContainer().style.cursor = 'crosshair';
        showToastNotification('🔧 Chế độ Editor đã bật. Chọn công cụ để chỉnh sửa đồ thị.');
    } else {
        panel.classList.add('d-none');
        if (editorLayers) { map.removeLayer(editorLayers); editorLayers = null; }
        editorNodeMarkers = {};
        editorEdgeLines = {};
        editorEdgeFirstNode = null;
        editorTool = null;
        map.getContainer().style.cursor = '';
        document.querySelectorAll('.editor-tool-btn').forEach(b => b.classList.remove('active'));
        // Reload page to sync graph data with routing
        window.location.reload();
    }
}

/**
 * Set the active editor tool.
 */
function setEditorTool(tool) {
    editorTool = tool;
    editorEdgeFirstNode = null;
    document.querySelectorAll('.editor-tool-btn').forEach(b => b.classList.remove('active'));
    const btn = document.getElementById('editor-tool-' + tool);
    if (btn) btn.classList.add('active');

    if (tool === 'add_edge') {
        showToastNotification('🔗 Chọn 2 RouteNode để tạo cạnh. Nhấn node thứ nhất, rồi node thứ hai.');
    } else if (tool === 'delete_edge') {
        showToastNotification('🗑️ Click vào cạnh cần xóa.');
    } else if (tool === 'add_node') {
        showToastNotification('➕ Click trên bản đồ để thêm RouteNode mới.');
    } else if (tool === 'delete_node') {
        showToastNotification('🗑️ Click vào RouteNode cần xóa.');
    } else if (tool === 'move_node') {
        showToastNotification('✋ Kéo RouteNode để di chuyển.');
    }
}

/**
 * Load all nodes and edges into the editor layer.
 */
function loadEditorGraph() {
    if (!editorLayers) return;
    editorLayers.clearLayers();
    editorNodeMarkers = {};
    editorEdgeLines = {};

    // Draw edges
    campusEdges.forEach(edge => {
        const nodeA = campusNodes.find(n => n.id === edge.node_a);
        const nodeB = campusNodes.find(n => n.id === edge.node_b);
        if (nodeA && nodeB) {
            const line = L.polyline([[nodeA.lat, nodeA.lng], [nodeB.lat, nodeB.lng]], {
                color: '#60a5fa', weight: 3, opacity: 0.8
            });
            line.edgeId = edge.id;
            line.edgeData = edge;
            line.bindTooltip(`Edge #${edge.id}`, { sticky: true });
            line.on('click', function (e) {
                L.DomEvent.stop(e);
                handleEditorEdgeClick(this);
            });
            line.addTo(editorLayers);
            editorEdgeLines[edge.id] = line;
        }
    });

    // Draw nodes
    campusNodes.forEach(node => {
        const marker = L.circleMarker([node.lat, node.lng], {
            radius: 7,
            fillColor: '#f59e0b',
            color: '#ffffff',
            weight: 2,
            fillOpacity: 1.0,
            zIndexOffset: 2000
        });
        marker.nodeId = node.id;
        marker.nodeData = node;
        marker.bindTooltip(`Node #${node.id}: ${node.name || 'Chưa đặt tên'}`, {
            permanent: false, direction: 'top', offset: [0, -8]
        });
        marker.on('click', function (e) {
            L.DomEvent.stop(e);
            handleEditorNodeClick(this);
        });
        // Drag for move_node tool
        marker.dragging();
        marker.on('dragstart', function () {
            if (editorTool !== 'move_node') {
                marker.dragging._draggable.disable();
            }
        });
        marker.on('dragend', function (e) {
            if (editorTool === 'move_node') {
                handleEditorNodeMove(this);
            }
        });
        marker.addTo(editorLayers);
        editorNodeMarkers[node.id] = marker;
    });
}

/**
 * Handle click on a node in editor mode.
 */
function handleEditorNodeClick(marker) {
    if (!editorTool) return;

    if (editorTool === 'delete_node') {
        if (!confirm(`Xóa RouteNode #${marker.nodeId}? Cạnh liên quan cũng sẽ bị xóa.`)) return;
        deleteEditorNode(marker.nodeId);
    } else if (editorTool === 'add_edge') {
        if (!editorEdgeFirstNode) {
            editorEdgeFirstNode = marker;
            marker.setStyle({ fillColor: '#22c55e', color: '#22c55e' });
            showToastNotification(`✅ Đã chọn node #${marker.nodeId}. Chọn node thứ hai để tạo cạnh.`);
        } else {
            if (editorEdgeFirstNode.nodeId === marker.nodeId) {
                showToastNotification('⚠️ Không thể tạo cạnh từ node đến chính nó.');
                return;
            }
            createEditorEdge(editorEdgeFirstNode.nodeId, marker.nodeId);
            editorEdgeFirstNode.setStyle({ fillColor: '#f59e0b', color: '#ffffff' });
            editorEdgeFirstNode = null;
        }
    } else if (editorTool === 'move_node') {
        // Enable drag
        marker.dragging._draggable.enable();
    }
}

/**
 * Handle click on an edge in editor mode.
 */
function handleEditorEdgeClick(line) {
    if (editorTool === 'delete_edge') {
        if (!confirm(`Xóa cạnh #${line.edgeId}?`)) return;
        deleteEditorEdge(line.edgeId);
    }
}

/**
 * Handle node move (drag end).
 */
async function handleEditorNodeMove(marker) {
    const lat = marker.getLatLng().lat;
    const lng = marker.getLatLng().lng;
    try {
        const res = await fetch(`/api/route-nodes/${marker.nodeId}/`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ latitude: lat.toFixed(6), longitude: lng.toFixed(6) })
        });
        if (res.ok) {
            // Update local data
            const node = campusNodes.find(n => n.id === marker.nodeId);
            if (node) { node.lat = lat; node.lng = lng; }
            showToastNotification(`✅ Đã di chuyển Node #${marker.nodeId} đến (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
            loadEditorGraph();
        } else {
            const data = await res.json();
            showToastNotification('❌ Lỗi: ' + (data.detail || JSON.stringify(data)));
            loadEditorGraph(); // Reset position
        }
    } catch (e) {
        showToastNotification('❌ Lỗi kết nối server.');
        loadEditorGraph();
    }
}

/**
 * Add a new RouteNode via API.
 */
async function addEditorNode(lat, lng) {
    const name = prompt('Nhập tên cho RouteNode mới (bỏ trống nếu không cần):', '');
    try {
        const res = await fetch('/api/route-nodes/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({ latitude: lat.toFixed(6), longitude: lng.toFixed(6), name: name || '' })
        });
        if (res.ok) {
            const data = await res.json();
            campusNodes.push({ id: data.id, lat: lat, lng: lng, name: name || '', is_on_walkway: true });
            showToastNotification(`✅ Đã thêm Node #${data.id} (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
            loadEditorGraph();
        } else {
            const data = await res.json();
            const msg = typeof data === 'string' ? data : (data.detail || data.non_field_errors?.[0] || JSON.stringify(data));
            showToastNotification('❌ Lỗi: ' + msg);
        }
    } catch (e) {
        showToastNotification('❌ Lỗi kết nối server.');
    }
}

/**
 * Delete a RouteNode via API.
 */
async function deleteEditorNode(nodeId) {
    try {
        const res = await fetch(`/api/route-nodes/${nodeId}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });
        if (res.ok) {
            // Remove from local data
            const idx = campusNodes.findIndex(n => n.id === nodeId);
            if (idx !== -1) campusNodes.splice(idx, 1);
            // Remove related edges from local data
            for (let i = campusEdges.length - 1; i >= 0; i--) {
                if (campusEdges[i].node_a === nodeId || campusEdges[i].node_b === nodeId) {
                    campusEdges.splice(i, 1);
                }
            }
            showToastNotification(`✅ Đã xóa Node #${nodeId}`);
            loadEditorGraph();
        } else {
            showToastNotification('❌ Lỗi xóa node.');
        }
    } catch (e) {
        showToastNotification('❌ Lỗi kết nối server.');
    }
}

/**
 * Create a new RouteEdge between two nodes via API.
 */
async function createEditorEdge(nodeAId, nodeBId) {
    const nodeA = campusNodes.find(n => n.id === nodeAId);
    const nodeB = campusNodes.find(n => n.id === nodeBId);
    if (!nodeA || !nodeB) return;

    // Calculate distance via haversine
    const dist = haversineDistanceM(nodeA.lat, nodeA.lng, nodeB.lat, nodeB.lng);

    try {
        const res = await fetch('/api/route-edges/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCookie('csrftoken') },
            body: JSON.stringify({
                node_a: nodeAId,
                node_b: nodeBId,
                distance: Math.round(dist * 100) / 100,
                points: [[nodeA.lat, nodeA.lng], [nodeB.lat, nodeB.lng]],
                is_active: true
            })
        });
        if (res.ok) {
            const data = await res.json();
            // Add forward edge to local data
            campusEdges.push({
                id: data.id, node_a: nodeAId, node_b: nodeBId,
                distance: dist, is_valid: true
            });
            showToastNotification(`✅ Đã tạo cạnh #${data.id}: Node #${nodeAId} → Node #${nodeBId} (${Math.round(dist)}m)`);
            loadEditorGraph();
        } else {
            const data = await res.json();
            const msg = typeof data === 'string' ? data : (data.detail || data.non_field_errors?.[0] || JSON.stringify(data));
            showToastNotification('❌ ' + msg);
        }
    } catch (e) {
        showToastNotification('❌ Lỗi kết nối server.');
    }
}

/**
 * Delete a RouteEdge via API.
 */
async function deleteEditorEdge(edgeId) {
    try {
        const res = await fetch(`/api/route-edges/${edgeId}/`, {
            method: 'DELETE',
            headers: { 'X-CSRFToken': getCookie('csrftoken') }
        });
        if (res.ok) {
            // Remove from local data
            const idx = campusEdges.findIndex(e => e.id === edgeId);
            if (idx !== -1) campusEdges.splice(idx, 1);
            showToastNotification(`✅ Đã xóa cạnh #${edgeId}`);
            loadEditorGraph();
        } else {
            showToastNotification('❌ Lỗi xóa cạnh.');
        }
    } catch (e) {
        showToastNotification('❌ Lỗi kết nối server.');
    }
}

/**
 * Handle map click in editor mode.
 */
function handleEditorMapClick(e) {
    if (!editorMode) return false;
    if (editorTool === 'add_node') {
        addEditorNode(e.latlng.lat, e.latlng.lng);
        return true; // consumed
    }
    return false; // not consumed
}

// ====================================================
// DEBUG GRAPH LAYER
// ====================================================
function toggleDebugGraph(e) {
    const isChecked = e.target.checked;
    
    if (debugGraphLayer) {
        map.removeLayer(debugGraphLayer);
        debugGraphLayer = null;
    }
    
    if (!isChecked) return;
    
    debugGraphLayer = L.layerGroup();
    
    // 1. Draw Building Polygons removed as requested to clear red outlines around building markers
    
    // 2. Draw edges: gray for valid walkway edges, red for invalid (intersecting building)
    campusEdges.forEach(edge => {
        const nodeA = campusNodes.find(n => n.id === edge.node_a);
        const nodeB = campusNodes.find(n => n.id === edge.node_b);
        if (nodeA && nodeB) {
            const linePoints = [[nodeA.lat, nodeA.lng], [nodeB.lat, nodeB.lng]];
            
            const edgeLine = L.polyline(linePoints, {
                color: edge.is_valid ? '#9ca3af' : '#ef4444', // gray-400 vs red-500
                weight: 3,
                opacity: 0.8,
                dashArray: edge.is_valid ? null : '4, 4'
            });
            const textA = nodeA.name ? `${nodeA.name} (${nodeA.id})` : `Node ${nodeA.id}`;
            const textB = nodeB.name ? `${nodeB.name} (${nodeB.id})` : `Node ${nodeB.id}`;
            
            edgeLine.bindTooltip(`Edge ID: ${edge.id} | ${textA} ⇄ ${textB} (${edge.is_valid ? 'Hợp lệ' : 'Lỗi cắt nhà'})`, { sticky: true });
            edgeLine.addTo(debugGraphLayer);
        }
    });
    
    // 3. Draw nodes: red circle markers with tooltips & popups showing ID
    campusNodes.forEach(node => {
        const marker = L.circleMarker([node.lat, node.lng], {
            radius: 6,
            fillColor: '#ef4444', // red-500
            color: '#ffffff',
            weight: 1.5,
            fillOpacity: 1.0,
            zIndexOffset: 1000
        });
        
        const label = `Node ID: ${node.id} | ${node.name ? `<b>${node.name}</b>` : 'Nút không tên'}`;
        marker.bindTooltip(label, { 
            permanent: false, 
            direction: 'top',
            offset: [0, -6]
        });
        
        marker.bindPopup(`
            <div style="font-family:sans-serif; font-size:12px; min-width:140px; color:#ffffff;">
                <h6 style="margin:0 0 -5px 0; color:#ef4444; font-weight:bold; font-size:13px;">📍 Nút Đồ Thị (Node)</h6>
                <hr style="margin: 5px 0; border-color: #4b5563;">
                <b>ID:</b> ${node.id}<br>
                <b>Tên:</b> ${node.name || '<i>Chưa đặt tên</i>'}<br>
                <b>Vĩ độ:</b> ${node.lat.toFixed(6)}<br>
                <b>Kinh độ:</b> ${node.lng.toFixed(6)}
            </div>
        `);
        
        marker.addTo(debugGraphLayer);
    });
    
    debugGraphLayer.addTo(map);
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
