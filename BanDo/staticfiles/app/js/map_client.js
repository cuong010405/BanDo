// client/map_client.js - Main Leaflet controller and API broker

let map;
let startMarker, endMarker, userMarker, userAccuracyCircle, routePolyline;
let startCoords = null;
let endCoords = null;
let watchId = null;

// --- Live Navigation State ---
let navWatchId = null;            // watchPosition handle
let navRouteGeometry = [];        // Full route [[lat,lng],...]
let navRemainingGeometry = [];    // Trimmed remaining points
let navRemainingPolyline = null;  // Grey "done" trail
let navIsActive = false;

const campusCenter = [10.4206, 105.6436];

// Parse JSON data loaded from script tags
const campusLocations = JSON.parse(document.getElementById('locations-data').textContent);
const campusNodes = JSON.parse(document.getElementById('nodes-data').textContent);
const campusEdges = JSON.parse(document.getElementById('edges-data').textContent);

document.addEventListener("DOMContentLoaded", function () {
    // 1. Initialize Map
    map = L.map('map', {
        fullscreenControl: true
    }).setView(campusCenter, 17);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);

    L.control.scale({ imperial: false }).addTo(map);

    // 2. Render Campus POI Markers
    drawPoiMarkers();

    // 3. Attach User Geolocation Click Event
    document.getElementById('my-location-btn').addEventListener('click', getUserLocation);

    // 4. Attach Route Calculation Click Event
    document.getElementById('calculate-btn').addEventListener('click', calculateSmartRoute);

    // 5. Attach Reset Click Event
    document.getElementById('reset-btn').addEventListener('click', resetRoutingState);

    // 6. Map Clicks: set start/end markers dynamically if input fields are empty
    map.on('click', handleMapClick);

    // 7. Bind Explore Sidebar list items click
    const poiItems = document.querySelectorAll('.list-item-poi');
    poiItems.forEach(item => {
        item.addEventListener('click', function () {
            const lat = parseFloat(this.dataset.lat);
            const lng = parseFloat(this.dataset.lng);
            const name = this.dataset.name;
            const desc = this.dataset.desc;
            const address = this.dataset.address;
            
            // Pan map to POI and show details in tooltip/popup
            map.setView([lat, lng], 18);
            L.popup()
                .setLatLng([lat, lng])
                .setContent(buildPopupHtml(name, desc, address, lat, lng))
                .openOn(map);
        });
    });

    // 8. Bind Nominatim Address Search
    document.getElementById('search-address-btn').addEventListener('click', searchNominatimAddress);

    // 9. Bind Feedbacks Star Selection
    const stars = document.querySelectorAll('.star-btn');
    stars.forEach(star => {
        star.addEventListener('click', function() {
            const val = parseInt(this.dataset.val);
            document.getElementById('feedback-rating').value = val;
            
            stars.forEach(s => {
                const sVal = parseInt(s.dataset.val);
                if (sVal <= val) {
                    s.classList.add('active');
                    s.classList.replace('fa-regular', 'fa-solid');
                } else {
                    s.classList.remove('active');
                    s.classList.replace('fa-solid', 'fa-regular');
                }
            });
        });
    });

    // Preset active stars
    if (stars && stars.length >= 5) {
        stars[4].click(); // Set 5-stars default
    }

    // 10. Bind Feedback Form Submission
    const fbForm = document.getElementById('feedback-form');
    if (fbForm) {
        fbForm.addEventListener('submit', submitFeedbackForm);
    }
});

// Render campus POIs markers
function drawPoiMarkers() {
    campusLocations.forEach(loc => {
        // Create custom stylized marker using FontAwesome icons
        let iconHtml = `<div class="p-1 bg-primary text-white rounded-circle shadow border border-white d-flex align-items-center justify-content-center" style="width: 32px; height: 32px;">`;
        if (loc.category_slug.includes('cong')) {
            iconHtml += `<i class="fa-solid fa-door-open" style="font-size: 13px;"></i>`;
        } else if (loc.category_slug.includes('xe')) {
            iconHtml += `<i class="fa-solid fa-square-parking" style="font-size: 13px;"></i>`;
        } else if (loc.category_slug.includes('the-thao')) {
            iconHtml += `<i class="fa-solid fa-basketball" style="font-size: 13px;"></i>`;
        } else if (loc.category_slug.includes('tien-ich')) {
            iconHtml += `<i class="fa-solid fa-circle-info" style="font-size: 13px;"></i>`;
        } else {
            iconHtml += `<i class="fa-solid fa-building" style="font-size: 13px;"></i>`;
        }
        iconHtml += `</div>`;

        const customIcon = L.divIcon({
            html: iconHtml,
            className: 'custom-poi-marker-icon',
            iconSize: [32, 32],
            iconAnchor: [16, 16]
        });

        const marker = L.marker([loc.lat, loc.lng], { icon: customIcon }).addTo(map);
        marker.bindPopup(buildPopupHtml(loc.name, loc.desc, loc.address, loc.lat, loc.lng));
    });
}

// Build popup HTML structure with custom action triggers
function buildPopupHtml(name, desc, address, lat, lng) {
    return `
        <div class="text-white p-2" style="max-width: 250px;">
            <h6 class="fw-bold mb-1 border-bottom border-secondary pb-1 text-primary"><i class="fa-solid fa-location-dot me-1"></i>${name}</h6>
            ${desc ? `<p class="small text-white mb-1"><strong>Mô tả:</strong> ${desc}</p>` : ''}
            ${address ? `<p class="small text-white-50 mb-2" style="font-size: 11px;"><i class="fa-solid fa-map-pin me-1 text-success"></i>${address}</p>` : ''}
            <div class="d-flex gap-2">
                <button onclick="setRoutingPoint('start', ${lat}, ${lng}, '${name}')" class="btn btn-xs btn-primary p-1 text-white small px-2 rounded" style="font-size: 11px;">
                    <i class="fa-solid fa-flag-checkered me-1"></i>Điểm đi
                </button>
                <button onclick="setRoutingPoint('end', ${lat}, ${lng}, '${name}')" class="btn btn-xs btn-success p-1 text-white small px-2 rounded" style="font-size: 11px;">
                    <i class="fa-solid fa-location-arrow me-1"></i>Điểm đến
                </button>
            </div>
        </div>
    `;
}

// Set routing endpoints
function setRoutingPoint(type, lat, lng, name) {
    if (type === 'start') {
        startCoords = { lat, lng };
        document.getElementById('start-input').value = name || `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (startMarker) map.removeLayer(startMarker);
        
        startMarker = L.marker([lat, lng], {
            draggable: true,
            icon: L.divIcon({
                html: `<i class="fa-solid fa-circle-play text-primary fs-3 shadow animate-pulse"></i>`,
                className: 'start-marker-icon',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(map);

        // Listen for drags to adjust position and recalculate path
        startMarker.on('dragend', function(e) {
            const position = startMarker.getLatLng();
            startCoords = { lat: position.lat, lng: position.lng };
            document.getElementById('start-input').value = `Vị trí tùy chỉnh (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`;
            if (startCoords && endCoords) {
                calculateSmartRoute();
            }
        });
    } else {
        endCoords = { lat, lng };
        document.getElementById('end-input').value = name || `${lat.toFixed(5)},${lng.toFixed(5)}`;
        if (endMarker) map.removeLayer(endMarker);
        
        endMarker = L.marker([lat, lng], {
            draggable: true,
            icon: L.divIcon({
                html: `<i class="fa-solid fa-circle-stop text-success fs-3 shadow animate-pulse"></i>`,
                className: 'end-marker-icon',
                iconSize: [24, 24],
                iconAnchor: [12, 12]
            })
        }).addTo(map);

        // Listen for drags to adjust position and recalculate path
        endMarker.on('dragend', function(e) {
            const position = endMarker.getLatLng();
            endCoords = { lat: position.lat, lng: position.lng };
            document.getElementById('end-input').value = `Điểm đến tùy chỉnh (${position.lat.toFixed(5)}, ${position.lng.toFixed(5)})`;
            if (startCoords && endCoords) {
                calculateSmartRoute();
            }
        });
    }
    map.closePopup();
}

// Handle Map clicks directly
function handleMapClick(e) {
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    if (!startCoords) {
        setRoutingPoint('start', lat, lng);
    } else if (!endCoords) {
        setRoutingPoint('end', lat, lng);
    }
}

// Reset routing variables
function resetRoutingState() {
    stopLiveNavigation();
    navRouteGeometry = [];
    navRemainingGeometry = [];

    startCoords = null;
    endCoords = null;
    document.getElementById('start-input').value = '';
    document.getElementById('end-input').value = '';

    if (startMarker) map.removeLayer(startMarker);
    if (endMarker) map.removeLayer(endMarker);
    if (routePolyline) map.removeLayer(routePolyline);

    document.getElementById('route-result-panel').classList.add('d-none');
    map.setView(campusCenter, 17);
}

// Geolocation Browser API track
function getUserLocation() {
    if (!navigator.geolocation) {
        alert('Trình duyệt không hỗ trợ định vị GPS.');
        return;
    }

    const btn = document.getElementById('my-location-btn');
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active text-primary"></i>`;

    navigator.geolocation.getCurrentPosition(
        position => {
            let lat = position.coords.latitude;
            let lng = position.coords.longitude;
            let accuracy = position.coords.accuracy;

            // Campus boundary geofence check (DTHU campus box)
            const minLat = 10.4150;
            const maxLat = 10.4250;
            const minLng = 105.6380;
            const maxLng = 105.6480;

            if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) {
                // Out of school or testing on desktop PC. Snap mock location inside campus!
                lat = 10.420601;
                lng = 105.643611;
                accuracy = 4.2; // simulate high accuracy error of 4.2m
                
                showToastNotification("Phát hiện bạn đang ở ngoài trường (hoặc dùng PC). Đã tự động kích hoạt GPS mô phỏng trong khuôn viên DTHU để test định tuyến!");
            }

            // Update Form
            setRoutingPoint('start', lat, lng, 'Vị trí của tôi (GPS)');

            // Show status
            document.getElementById('gps-status-panel').classList.remove('d-none');
            document.getElementById('gps-lat').innerText = lat.toFixed(6);
            document.getElementById('gps-lng').innerText = lng.toFixed(6);
            document.getElementById('gps-acc').innerText = `${accuracy.toFixed(1)}m`;

            // Draw accuracy overlay circles
            if (userMarker) map.removeLayer(userMarker);
            if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

            userAccuracyCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.15
            }).addTo(map);

            userMarker = L.circleMarker([lat, lng], {
                radius: 8,
                color: '#ffffff',
                fillColor: '#10b981',
                fillOpacity: 1,
                weight: 2
            }).addTo(map);

            map.setView([lat, lng], 18);
            btn.innerHTML = `<i class="fa-solid fa-location-crosshairs text-success"></i>`;

            // Save GPS history log to DB in background if logged in
            if (typeof isUserAuthenticated !== 'undefined' && isUserAuthenticated) {
                logGPSCoordinates(lat, lng, accuracy);
            }
        },
        error => {
            console.error('GPS Geolocation failed', error);
            // Fallback to simulation immediately on geolocation error (e.g. permission denied on PC)
            const lat = 10.420601;
            const lng = 105.643611;
            const accuracy = 4.2;

            showToastNotification("Không nhận được tín hiệu định vị. Đã kích hoạt GPS mô phỏng trong khuôn viên DTHU!");
            
            setRoutingPoint('start', lat, lng, 'Vị trí của tôi (GPS)');

            document.getElementById('gps-status-panel').classList.remove('d-none');
            document.getElementById('gps-lat').innerText = lat.toFixed(6);
            document.getElementById('gps-lng').innerText = lng.toFixed(6);
            document.getElementById('gps-acc').innerText = `${accuracy.toFixed(1)}m`;

            if (userMarker) map.removeLayer(userMarker);
            if (userAccuracyCircle) map.removeLayer(userAccuracyCircle);

            userAccuracyCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#10b981',
                fillColor: '#10b981',
                fillOpacity: 0.15
            }).addTo(map);

            userMarker = L.circleMarker([lat, lng], {
                radius: 8,
                color: '#ffffff',
                fillColor: '#10b981',
                fillOpacity: 1,
                weight: 2
            }).addTo(map);

            map.setView([lat, lng], 18);
            btn.innerHTML = `<i class="fa-solid fa-location-crosshairs text-success"></i>`;
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Display high-end Toast notification alert
function showToastNotification(message) {
    // Clear any existing toasts first
    const existing = document.querySelectorAll('.custom-map-toast');
    existing.forEach(e => e.remove());

    const toast = document.createElement('div');
    toast.className = 'custom-map-toast alert alert-warning border-0 bg-warning text-dark shadow position-fixed start-50 translate-middle-x p-3 rounded text-center fw-bold small';
    toast.style.cssText = 'top: 20px; z-index: 9999; min-width: 320px; max-width: 90%; border-radius: 30px !important; box-shadow: 0 10px 25px rgba(0,0,0,0.5) !important;';
    toast.innerHTML = `<i class="fa-solid fa-triangle-exclamation me-2 animate-pulse"></i> ${message}`;
    document.body.appendChild(toast);
    
    setTimeout(() => {
        toast.style.transition = 'all 0.5s ease';
        toast.style.opacity = '0';
        toast.style.transform = 'translate(-50%, -20px)';
        setTimeout(() => toast.remove(), 500);
    }, 4500);
}

// Log current coordinates to GPSHistory model
async function logGPSCoordinates(lat, lng, accuracy) {
    const csrfToken = getCookie('csrftoken');
    // If not authenticated, we just skip silenty
    try {
        await fetch('/api/history/gps/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                latitude: lat.toFixed(6),
                longitude: lng.toFixed(6),
                accuracy: accuracy
            })
        });
    } catch (e) {
        // Silently capture
    }
}

// Geocode address via OpenStreetMap Nominatim API
async function searchNominatimAddress() {
    const query = document.getElementById('search-address-input').value.trim();
    if (!query) return;

    const btn = document.getElementById('search-address-btn');
    btn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active text-primary"></i>`;

    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
    try {
        const response = await fetch(url, {
            headers: { 'Accept-Language': 'vi,en;q=0.8' }
        });
        const data = await response.json();
        
        if (data.length > 0) {
            const result = data[0];
            const lat = parseFloat(result.lat);
            const lon = parseFloat(result.lon);

            setRoutingPoint('end', lat, lon, result.name || query);
            map.setView([lat, lon], 17);
        } else {
            alert('Không tìm thấy địa chỉ này trên bản đồ.');
        }
    } catch (error) {
        console.error('Nominatim query failed', error);
        alert('Có lỗi xảy ra khi kết nối tới dịch vụ tìm kiếm địa chỉ.');
    } finally {
        btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i>`;
    }
}

// Calculate route by calling Django backend API
async function calculateSmartRoute() {
    if (!startCoords || !endCoords) {
        alert('Vui lòng chọn đầy đủ Điểm đi và Điểm đến!');
        return;
    }

    const calcBtn = document.getElementById('calculate-btn');
    calcBtn.disabled = true;
    calcBtn.innerHTML = `<i class="fa-solid fa-spinner animate-spin active me-1"></i>Đang tính toán...`;

    const algorithm = document.getElementById('algorithm-select').value;
    const startName = document.getElementById('start-input').value;
    const endName = document.getElementById('end-input').value;
    const csrfToken = getCookie('csrftoken');

    try {
        const response = await fetch('/api/routes/calculate', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                start_lat: startCoords.lat,
                start_lng: startCoords.lng,
                end_lat: endCoords.lat,
                end_lng: endCoords.lng,
                algorithm: algorithm,
                start_name: startName,
                end_name: endName
            })
        });

        const data = await response.json();

        if (!response.ok) {
            alert(data.error || 'Lỗi tính toán đường đi.');
            return;
        }

        // Render optimal route polyline on map
        drawRoutePolyline(data.primary.geometry);

        // Update side stats panel
        document.getElementById('route-result-panel').classList.remove('d-none');
        document.getElementById('route-distance').innerText = `${data.primary.distance_m} mét (${data.primary.distance_km} km)`;
        
        const minutes = Math.floor(data.primary.duration_s / 60);
        const seconds = Math.round(data.primary.duration_s % 60);
        document.getElementById('route-duration').innerText = `${minutes} phút ${seconds} giây`;

        // Render complexity metrics table
        populateAlgorithmComparison(data);
    } catch (error) {
        console.error('Calculate route failed', error);
        alert('Lỗi kết nối tới máy chủ Django.');
    } finally {
        calcBtn.disabled = false;
        calcBtn.innerHTML = `<i class="fa-solid fa-compass me-1"></i>Tìm đường`;
    }
}

// Draw polyline on Leaflet and start live navigation
function drawRoutePolyline(geometry) {
    if (routePolyline) map.removeLayer(routePolyline);
    if (navRemainingPolyline) map.removeLayer(navRemainingPolyline);

    // Store geometry for navigation
    navRouteGeometry = geometry.slice();
    navRemainingGeometry = geometry.slice();

    routePolyline = L.polyline(geometry, {
        color: '#3b82f6',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
    }).addTo(map);

    map.fitBounds(routePolyline.getBounds());

    // Start live GPS navigation tracking
    startLiveNavigation();
}

// Render the metrics table comparing Dijkstra and A*
function populateAlgorithmComparison(data) {
    const tableBody = document.getElementById('metrics-table-body');
    tableBody.innerHTML = '';

    const hasDijkstra = data.dijkstra !== null;
    const hasAStar = data.a_star !== null;

    // Row 1: Visited nodes
    let dVisited = hasDijkstra ? `${data.dijkstra.visited_nodes} nút` : '--';
    let aVisited = hasAStar ? `${data.a_star.visited_nodes} nút` : '--';
    tableBody.innerHTML += `
        <tr>
            <td class="text-start text-white-50">Số nút đã duyệt</td>
            <td class="font-monospace fw-semibold text-danger">${dVisited}</td>
            <td class="font-monospace fw-semibold text-success">${aVisited}</td>
        </tr>
    `;

    // Row 2: Exec time
    let dTime = hasDijkstra ? `${data.dijkstra.exec_time_ms.toFixed(4)} ms` : '--';
    let aTime = hasAStar ? `${data.a_star.exec_time_ms.toFixed(4)} ms` : '--';
    tableBody.innerHTML += `
        <tr>
            <td class="text-start text-white-50">Thời gian chạy (Python)</td>
            <td class="font-monospace text-danger">${dTime}</td>
            <td class="font-monospace text-success">${aTime}</td>
        </tr>
    `;

    // Row 3: Total Path nodes count
    let dPathCount = hasDijkstra ? `${data.dijkstra.path_nodes.length} nút` : '--';
    let aPathCount = hasAStar ? `${data.a_star.path_nodes.length} nút` : '--';
    tableBody.innerHTML += `
        <tr>
            <td class="text-start text-white-50">Số nút trên tuyến</td>
            <td class="font-monospace">${dPathCount}</td>
            <td class="font-monospace">${aPathCount}</td>
        </tr>
    `;

    // Update diagram trace
    document.getElementById('path-diagram').innerText = data.primary.text_diagram;

    // Update verbal explanation text
    if (data.comparison) {
        let explain = `Cả hai thuật toán đều tìm ra cùng một khoảng cách tối ưu (${data.primary.distance_m}m). `;
        if (data.comparison.a_star_visited < data.comparison.dijkstra_visited) {
            explain += `Thuật toán A* duyệt ít hơn Dijkstra ${data.comparison.dijkstra_visited - data.comparison.a_star_visited} nút (hiệu quả hơn ${data.comparison.efficiency_gain}%).`;
        } else {
            explain += `Do đồ thị nhỏ, số lượng nút duyệt của A* và Dijkstra là tương đương nhau.`;
        }
        document.getElementById('algo-explanation-text').innerText = explain;
    } else {
        document.getElementById('algo-explanation-text').innerText = `Tuyến đường được tính toán thành công bằng ${data.primary.algorithm}.`;
    }
}

// POST Feedback submission
async function submitFeedbackForm(e) {
    e.preventDefault();

    const subject = document.getElementById('feedback-subject').value.trim();
    const message = document.getElementById('feedback-message').value.trim();
    const rating = document.getElementById('feedback-rating').value;
    const csrfToken = getCookie('csrftoken');

    try {
        const response = await fetch('/api/feedbacks/', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': csrfToken
            },
            body: JSON.stringify({
                subject: subject,
                message: message,
                rating: rating
            })
        });

        if (response.ok) {
            alert('Cảm ơn bạn đã gửi ý kiến đóng góp cho hệ thống!');
            document.getElementById('feedback-subject').value = '';
            document.getElementById('feedback-message').value = '';
            // Reset rating stars to 5
            document.querySelectorAll('.star-btn')[4].click();
        } else {
            const data = await response.json();
            alert(data.detail || 'Lỗi gửi phản hồi.');
        }
    } catch (error) {
        console.error('Feedback submit failed', error);
        alert('Lỗi kết nối tới máy chủ Django khi gửi phản hồi.');
    }
}

// Helper to retrieve Django CSRF Cookie
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

// ====================================================
// LIVE NAVIGATION ENGINE
// ====================================================

// Start watching GPS position for navigation
function startLiveNavigation() {
    if (!navigator.geolocation) return;

    // Stop any previous watcher
    stopLiveNavigation();
    navIsActive = true;

    navWatchId = navigator.geolocation.watchPosition(
        position => {
            if (!navIsActive) return;

            let lat = position.coords.latitude;
            let lng = position.coords.longitude;

            // Campus geofence: if outside, use last known or skip
            const minLat = 10.4150, maxLat = 10.4250;
            const minLng = 10.6380, maxLng = 105.6480;
            const inCampus = lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng;

            if (!inCampus && navRouteGeometry.length > 0) {
                // Use snapped position on route for simulation
                const snapped = snapToPolyline(lat, lng, navRemainingGeometry);
                lat = snapped.lat;
                lng = snapped.lng;
            }

            // Move user marker
            if (userMarker) {
                userMarker.setLatLng([lat, lng]);
            }
            if (userAccuracyCircle) {
                userAccuracyCircle.setLatLng([lat, lng]);
            }

            // Check arrival (within 15m of end)
            if (endCoords) {
                const distToEnd = haversineDistanceM(lat, lng, endCoords.lat, endCoords.lng);
                if (distToEnd < 15) {
                    stopLiveNavigation();
                    showToastNotification('🎉 Bạn đã đến nơi! Chúc mừng!');
                    if (routePolyline) {
                        map.removeLayer(routePolyline);
                        routePolyline = null;
                    }
                    return;
                }
            }

            // Trim passed segments from remaining geometry
            navRemainingGeometry = trimPassedSegments(lat, lng, navRemainingGeometry);

            // Redraw remaining route in bright blue
            if (routePolyline) map.removeLayer(routePolyline);
            if (navRemainingGeometry.length >= 2) {
                routePolyline = L.polyline(navRemainingGeometry, {
                    color: '#3b82f6',
                    weight: 6,
                    opacity: 0.85,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(map);
            }
        },
        err => console.warn('Nav GPS error', err),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 2000 }
    );
}

function stopLiveNavigation() {
    navIsActive = false;
    if (navWatchId !== null) {
        navigator.geolocation.clearWatch(navWatchId);
        navWatchId = null;
    }
}

// Find nearest point on a polyline to (lat, lng)
function snapToPolyline(lat, lng, geometry) {
    if (!geometry || geometry.length === 0) return { lat, lng };
    if (geometry.length === 1) return { lat: geometry[0][0], lng: geometry[0][1] };

    let bestLat = geometry[0][0];
    let bestLng = geometry[0][1];
    let bestDist = Infinity;

    for (let i = 0; i < geometry.length - 1; i++) {
        const A = geometry[i];
        const B = geometry[i + 1];
        const snapped = closestPointOnSegment(lat, lng, A[0], A[1], B[0], B[1]);
        const d = haversineDistanceM(lat, lng, snapped.lat, snapped.lng);
        if (d < bestDist) {
            bestDist = d;
            bestLat = snapped.lat;
            bestLng = snapped.lng;
        }
    }
    return { lat: bestLat, lng: bestLng };
}

// Find closest point on segment A-B to point P (all in lat/lng degrees)
function closestPointOnSegment(pLat, pLng, aLat, aLng, bLat, bLng) {
    const dx = bLng - aLng;
    const dy = bLat - aLat;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) return { lat: aLat, lng: aLng };

    let t = ((pLng - aLng) * dx + (pLat - aLat) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    return { lat: aLat + t * dy, lng: aLng + t * dx };
}

// Remove points from the front of geometry that the user has already passed
function trimPassedSegments(lat, lng, geometry) {
    if (!geometry || geometry.length < 2) return geometry;

    // Find index of nearest segment
    let bestIdx = 0;
    let bestDist = Infinity;

    for (let i = 0; i < geometry.length - 1; i++) {
        const A = geometry[i];
        const B = geometry[i + 1];
        const snapped = closestPointOnSegment(lat, lng, A[0], A[1], B[0], B[1]);
        const d = haversineDistanceM(lat, lng, snapped.lat, snapped.lng);
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    }

    // Keep geometry from nearest segment onwards, prepend user's snapped position
    const snappedPos = closestPointOnSegment(
        lat, lng,
        geometry[bestIdx][0], geometry[bestIdx][1],
        geometry[bestIdx + 1][0], geometry[bestIdx + 1][1]
    );

    return [[snappedPos.lat, snappedPos.lng], ...geometry.slice(bestIdx + 1)];
}

// Haversine distance in meters (JS version)
function haversineDistanceM(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = x => x * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
