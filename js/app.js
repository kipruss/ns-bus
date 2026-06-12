/**
 * NS Bus — Main Application
 * 
 * Interactive map of Novi Sad bus routes using Leaflet + OpenStreetMap
 * Sidebar with route list, search, and schedule panel
 */

// ─── State ──────────────────────────────────────────────────

let map;
let routesData = [];
let schedulesData = {};
let activeRoutes = new Map(); // routeId → { polyline, stopMarkers[] }
let currentScheduleGroup = null;
let currentDay = 'R';

// ─── Initialization ─────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadData();
  renderRouteList();
  bindEvents();
});

function initMap() {
  map = L.map('map', {
    center: [45.2573, 19.8168],
    zoom: 13,
    zoomControl: true,
  });

  // Dark map tiles (CartoDB Dark Matter)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19,
  }).addTo(map);
}

async function loadData() {
  try {
    const [routesRes, schedulesRes] = await Promise.all([
      fetch('data/routes.json'),
      fetch('data/schedules.json'),
    ]);

    if (!routesRes.ok || !schedulesRes.ok) {
      throw new Error('Failed to load data files');
    }

    routesData = await routesRes.json();
    schedulesData = await schedulesRes.json();

    console.log(`Loaded ${routesData.length} routes, ${Object.keys(schedulesData).length} schedule groups`);
  } catch (e) {
    console.error('Error loading data:', e);
    document.getElementById('route-list').innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <p>Greška pri učitavanju podataka.<br>Pokrenite scraper prvo.</p>
      </div>
    `;
  }
}

// ─── Route List Rendering ────────────────────────────────────

function renderRouteList() {
  const container = document.getElementById('route-list');
  if (!routesData.length) return;

  // Group routes by base line number
  const groups = groupRoutes(routesData);
  container.innerHTML = '';

  for (const [groupKey, routes] of groups) {
    const groupEl = createRouteGroup(groupKey, routes);
    container.appendChild(groupEl);
  }
}

function groupRoutes(routes) {
  const groups = new Map();

  for (const route of routes) {
    // Extract base line number (leading digits)
    const match = route.name.match(/^(\d+)/);
    const groupKey = match ? match[1] : route.name;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(route);
  }

  // Sort groups numerically
  return new Map(
    [...groups.entries()].sort((a, b) => parseInt(a[0]) - parseInt(b[0]))
  );
}

function createRouteGroup(groupKey, routes) {
  const group = document.createElement('div');
  group.className = 'route-group';
  group.dataset.group = groupKey;

  // Find the primary A route for the group description
  const primaryRoute = routes.find(r => r.name === groupKey + 'A') || routes[0];
  const color = primaryRoute.color;

  // Group header
  const header = document.createElement('div');
  header.className = 'route-group-header';
  header.innerHTML = `
    <div class="route-group-number" style="background: ${color}">${groupKey}</div>
    <div class="route-group-info">
      <div class="route-group-name">Linija ${groupKey}</div>
      <div class="route-group-desc">${primaryRoute.title}</div>
    </div>
    <div class="route-group-toggle">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
    </div>
  `;

  header.addEventListener('click', () => {
    group.classList.toggle('expanded');
  });

  // Route items
  const items = document.createElement('div');
  items.className = 'route-items';

  for (const route of routes) {
    const item = createRouteItem(route);
    items.appendChild(item);
  }

  group.appendChild(header);
  group.appendChild(items);

  return group;
}

function createRouteItem(route) {
  const item = document.createElement('div');
  item.className = 'route-item';
  item.dataset.routeId = route.id;

  item.innerHTML = `
    <div class="route-item-badge" style="background: ${route.color}">${route.name}</div>
    <div class="route-item-title" title="${route.title}">${route.title}</div>
    <button class="route-item-schedule-btn" title="Red vožnje" data-schedule-group="${route.scheduleGroup || ''}">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
    </button>
  `;

  // Click to toggle route on map
  item.addEventListener('click', (e) => {
    if (e.target.closest('.route-item-schedule-btn')) return;
    toggleRoute(route.id);
  });

  // Schedule button
  const scheduleBtn = item.querySelector('.route-item-schedule-btn');
  scheduleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const group = route.scheduleGroup;
    if (group && schedulesData[group]) {
      showSchedule(group);
    }
  });

  return item;
}

// ─── Search ──────────────────────────────────────────────────

function filterRoutes(query) {
  const q = query.toLowerCase().trim();
  const groups = document.querySelectorAll('.route-group');

  groups.forEach(group => {
    const items = group.querySelectorAll('.route-item');
    let anyVisible = false;

    items.forEach(item => {
      const routeId = parseInt(item.dataset.routeId);
      const route = routesData.find(r => r.id === routeId);
      if (!route) return;

      const matches = !q ||
        route.name.toLowerCase().includes(q) ||
        route.title.toLowerCase().includes(q);

      item.style.display = matches ? '' : 'none';
      if (matches) anyVisible = true;
    });

    // Show/hide the whole group
    group.style.display = anyVisible ? '' : 'none';

    // Auto-expand groups when searching
    if (q && anyVisible) {
      group.classList.add('expanded');
    } else if (!q) {
      group.classList.remove('expanded');
    }
  });
}

// ─── Map Route Display ──────────────────────────────────────

function toggleRoute(routeId) {
  if (activeRoutes.has(routeId)) {
    removeRouteFromMap(routeId);
  } else {
    addRouteToMap(routeId);
  }
  updateRouteItemState(routeId);
}

function addRouteToMap(routeId) {
  const route = routesData.find(r => r.id === routeId);
  if (!route || !route.polyline.length) return;

  // Draw polyline
  const polyline = L.polyline(route.polyline, {
    color: route.color,
    weight: 4,
    opacity: 0.85,
    smoothFactor: 1,
  }).addTo(map);

  // Add stop markers
  const stopMarkers = [];
  for (const stop of route.stops) {
    const marker = L.circleMarker([stop.lat, stop.lng], {
      radius: 5,
      fillColor: route.color,
      color: '#fff',
      weight: 1.5,
      fillOpacity: 0.9,
    }).addTo(map);

    // Popup content
    const linesHtml = stop.lines
      .map(l => `<span>${l}</span>`)
      .join(' ');

    marker.bindPopup(`
      <div class="popup-stop-name">${stop.name}</div>
      ${stop.zone ? `<div class="popup-stop-zone">Zona ${stop.zone}</div>` : ''}
      <div class="popup-stop-lines">Linije: ${linesHtml}</div>
    `, { maxWidth: 280 });

    stopMarkers.push(marker);
  }

  activeRoutes.set(routeId, { polyline, stopMarkers });

  // Fit map to route bounds
  map.fitBounds(polyline.getBounds(), { padding: [50, 50] });
}

function removeRouteFromMap(routeId) {
  const data = activeRoutes.get(routeId);
  if (!data) return;

  map.removeLayer(data.polyline);
  data.stopMarkers.forEach(m => map.removeLayer(m));
  activeRoutes.delete(routeId);
}

function clearAllRoutes() {
  for (const [routeId] of activeRoutes) {
    removeRouteFromMap(routeId);
    updateRouteItemState(routeId);
  }
}

function updateRouteItemState(routeId) {
  const item = document.querySelector(`.route-item[data-route-id="${routeId}"]`);
  if (item) {
    item.classList.toggle('active', activeRoutes.has(routeId));
  }
}

// ─── Schedule Panel ──────────────────────────────────────────

function showSchedule(scheduleGroup) {
  currentScheduleGroup = scheduleGroup;
  const panel = document.getElementById('schedule-panel');
  panel.classList.remove('hidden');
  renderSchedule(scheduleGroup, currentDay);
}

function hideSchedule() {
  const panel = document.getElementById('schedule-panel');
  panel.classList.add('hidden');
  currentScheduleGroup = null;
}

function renderSchedule(scheduleGroup, dayType) {
  const schedule = schedulesData[scheduleGroup];
  if (!schedule) return;

  const dayData = schedule[dayType];
  if (!dayData) return;

  // Update title
  const titleEl = document.getElementById('schedule-title');
  titleEl.textContent = dayData.title
    ? `Linija ${dayData.title}`
    : `Linija ${scheduleGroup}`;

  // Update day tabs
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.day === dayType);
  });

  // Render schedule content
  const content = document.getElementById('schedule-content');
  content.innerHTML = '';

  // Direction A
  if (dayData.dirA && dayData.dirA.departures.length) {
    content.appendChild(createDirectionTable('A', dayData.dirA));
  }

  // Direction B
  if (dayData.dirB && dayData.dirB.departures.length) {
    content.appendChild(createDirectionTable('B', dayData.dirB));
  }

  // Legend
  const legendEl = document.getElementById('schedule-legend');
  if (dayData.legend) {
    legendEl.textContent = dayData.legend;
    legendEl.style.display = '';
  } else {
    legendEl.style.display = 'none';
  }
}

function createDirectionTable(dir, dirData) {
  const section = document.createElement('div');
  section.className = 'schedule-direction';

  // Header
  const header = document.createElement('div');
  header.className = 'schedule-direction-header';
  header.innerHTML = `
    <div class="schedule-dir-badge dir-${dir.toLowerCase()}">${dir}</div>
    <div class="schedule-dir-name">${dirData.name || `Smer ${dir}`}</div>
  `;

  // Group departures by hour
  const hourGroups = new Map();
  for (const dep of dirData.departures) {
    if (!hourGroups.has(dep.h)) {
      hourGroups.set(dep.h, []);
    }
    hourGroups.get(dep.h).push(dep);
  }

  // Current hour for highlighting
  const now = new Date();
  const currentHour = now.getHours();

  // Timetable
  const timetable = document.createElement('div');
  timetable.className = 'timetable';

  for (const [hour, deps] of hourGroups) {
    const row = document.createElement('div');
    row.className = 'timetable-row';
    if (hour === currentHour) row.classList.add('current-hour');

    const hourEl = document.createElement('div');
    hourEl.className = 'timetable-hour';
    hourEl.textContent = String(hour).padStart(2, '0');

    const minutesEl = document.createElement('div');
    minutesEl.className = 'timetable-minutes';

    for (const dep of deps) {
      const minEl = document.createElement('span');
      minEl.className = 'timetable-minute';
      if (dep.lowFloor) minEl.classList.add('low-floor');

      const minText = String(dep.m).padStart(2, '0');
      if (dep.note) {
        minEl.innerHTML = `${minText}<span class="timetable-note">${dep.note}</span>`;
      } else {
        minEl.textContent = minText;
      }

      minutesEl.appendChild(minEl);
    }

    row.appendChild(hourEl);
    row.appendChild(minutesEl);
    timetable.appendChild(row);
  }

  section.appendChild(header);
  section.appendChild(timetable);

  return section;
}

// ─── Event Bindings ──────────────────────────────────────────

function bindEvents() {
  // Search
  const searchInput = document.getElementById('search-input');
  searchInput.addEventListener('input', (e) => {
    filterRoutes(e.target.value);
  });

  // Clear all routes
  document.getElementById('btn-clear-all').addEventListener('click', clearAllRoutes);

  // Close schedule
  document.getElementById('btn-close-schedule').addEventListener('click', hideSchedule);

  // Day tabs
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      currentDay = tab.dataset.day;
      if (currentScheduleGroup) {
        renderSchedule(currentScheduleGroup, currentDay);
      }
    });
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideSchedule();
    }
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      searchInput.focus();
    }
  });

  // Auto-determine current day type
  const dayOfWeek = new Date().getDay();
  if (dayOfWeek === 0) {
    currentDay = 'N'; // Nedelja
  } else if (dayOfWeek === 6) {
    currentDay = 'S'; // Subota
  } else {
    currentDay = 'R'; // Radni dan
  }
  // Update default active tab
  document.querySelectorAll('.day-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.day === currentDay);
  });
}
