// HiperTracker live map. root_element is provided by Frappe for Custom HTML Blocks.
(function () {
  const R = root_element;
  const el = (name) => R.querySelector('[data-el="' + name + '"]');

  const COLORS = { online: '#16a34a', offline: '#dc2626', gps_off: '#d97706', unknown: '#6b7280' };
  const LABELS = { online: 'Online', offline: 'Offline', gps_off: 'GPS Off', unknown: 'No data' };
  const ICONS = {
    Person: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z"/></svg>',
    Vehicle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/></svg>'
  };

  let state = { data: null, map: null, markers: {}, selected: null, fitted: false, base: null, sat: null };

  // stop any timer left from an earlier render of this block
  if (window.__hipertrackerTimer) { clearInterval(window.__hipertrackerTimer); window.__hipertrackerTimer = null; }

  const esc = (s) => frappe.utils.escape_html(s == null ? '' : String(s));
  const ago = (min) => {
    if (min == null) return '—';
    if (min < 1) return 'just now';
    if (min < 60) return Math.round(min) + ' min ago';
    if (min < 1440) return Math.round(min / 60) + ' h ago';
    return Math.round(min / 1440) + ' d ago';
  };
  const place = (d) => d.address || (d.lat != null ? (Number(d.lat).toFixed(5) + ', ' + Number(d.lon).toFixed(5)) : '—');

  function loadLeaflet() {
    // the block lives in a shadow root, so Leaflet's stylesheet has to be added inside it
    if (!R.querySelector('link[data-ht-css]')) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      css.setAttribute('data-ht-css', '1');
      R.insertBefore(css, R.firstChild);
    }
    return new Promise((resolve, reject) => {
      if (window.L && window.L.map) return resolve();
      let s = document.getElementById('ht-leaflet-js');
      if (!s) {
        s = document.createElement('script');
        s.id = 'ht-leaflet-js';
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
        document.head.appendChild(s);
      }
      s.addEventListener('load', () => resolve());
      s.addEventListener('error', () => reject(new Error('Map library could not load')));
      const t = setInterval(() => { if (window.L && window.L.map) { clearInterval(t); resolve(); } }, 200);
    });
  }

  function initMap(settings) {
    const L = window.L;
    const map = L.map(el('map'), { zoomControl: true, attributionControl: true }).setView(settings.center, settings.zoom);
    state.base = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
    state.sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, attribution: 'Imagery &copy; Esri' });
    map.zoomControl.setPosition('bottomright');
    map.on('click', () => select(null));
    state.map = map;
    setTimeout(() => map.invalidateSize(), 300);
  }

  function chipHtml(d, selected) {
    const color = COLORS[d.status] || COLORS.unknown;
    const sub = d.status === 'gps_off' ? '<small style="color:' + color + '">GPS switched off</small>'
      : d.status === 'online' ? '<small style="color:' + color + '">' + (d.speed || 0) + ' km/h</small>'
      : '<small style="color:' + color + '">' + (d.speed || 0) + ' km/h • ' + ago(d.age_minutes) + '</small>';
    return '<div style="position:relative">' +
      '<span class="ht-dot ' + (d.status === 'gps_off' ? 'ht-pulse' : '') + '" style="background:' + color + '"></span>' +
      '<div class="ht-chip' + (selected ? ' sel' : '') + '"><span style="color:' + color + '">' + (ICONS[d.tracks] || ICONS.Person) + '</span>' +
      '<div><b>' + esc(d.label) + '</b>' + sub + '</div></div></div>';
  }

  function renderMarkers() {
    const L = window.L, map = state.map, devices = state.data.devices;
    const keep = {};
    devices.forEach((d) => {
      if (d.lat == null || d.lon == null) return;
      const key = String(d.traccar_id);
      keep[key] = true;
      const icon = L.divIcon({ className: 'ht-icon', html: chipHtml(d, state.selected === key), iconSize: [0, 0] });
      let m = state.markers[key];
      if (m) { m.setLatLng([d.lat, d.lon]); m.setIcon(icon); }
      else {
        m = L.marker([d.lat, d.lon], { icon: icon, riseOnHover: true }).addTo(map);
        m.on('click', (e) => { L.DomEvent.stopPropagation(e); select(key, true); });
        state.markers[key] = m;
      }
      m.setZIndexOffset(state.selected === key ? 1000 : (d.status === 'gps_off' ? 500 : 0));
    });
    Object.keys(state.markers).forEach((k) => { if (!keep[k]) { map.removeLayer(state.markers[k]); delete state.markers[k]; } });
    if (!state.fitted) {
      const pts = devices.filter((d) => d.lat != null).map((d) => [d.lat, d.lon]);
      if (pts.length > 1) map.fitBounds(pts, { padding: [60, 60], maxZoom: 13 });
      else if (pts.length === 1) map.setView(pts[0], 13);
      state.fitted = true;
    }
  }

  function renderKpis() {
    const ds = state.data.devices;
    const c = { total: ds.length, online: 0, offline: 0, gps_off: 0 };
    let sp = 0, n = 0;
    ds.forEach((d) => {
      if (d.status === 'online') c.online++; else if (d.status === 'gps_off') c.gps_off++; else c.offline++;
      if (d.status === 'online' && d.speed > 2) { sp += d.speed; n++; }
    });
    c.avg = n ? Math.round(sp / n) + ' km/h' : '0 km/h';
    Object.keys(c).forEach((k) => { const b = R.querySelector('[data-k="' + k + '"]'); if (b) b.textContent = c[k]; });
  }

  function filtered() {
    const q = (el('search').value || '').toLowerCase().trim();
    const st = el('status').value;
    return state.data.devices.filter((d) => {
      if (st === 'unassigned' && d.mapped) return false;
      if (st && st !== 'unassigned') {
        if (st === 'offline' && !(d.status === 'offline' || d.status === 'unknown')) return false;
        if (st !== 'offline' && d.status !== st) return false;
      }
      if (!q) return true;
      return [d.label, d.employee_name, d.department, d.vehicle, d.address, d.identifier, d.traccar_name, d.head_name]
        .some((v) => v && String(v).toLowerCase().indexOf(q) >= 0);
    });
  }

  function renderTable() {
    const rows = filtered();
    el('listtitle').textContent = 'All Devices (' + state.data.devices.length + ')';
    if (!rows.length) {
      el('rows').innerHTML = '<tr><td colspan="7" class="ht-muted">' +
        (state.data.devices.length ? 'No devices match the filter.' : 'No devices yet. Add phones in Traccar, then press “Sync from Traccar”.') + '</td></tr>';
      return;
    }
    el('rows').innerHTML = rows.map((d) => {
      const key = String(d.traccar_id);
      const person = d.mapped ? (esc(d.employee_name) || '<span class="ht-muted">No employee set</span>')
        : '<span class="ht-link" data-assign="' + key + '">Link to a person</span>';
      return '<tr class="ht-row' + (state.selected === key ? ' sel' : '') + '" data-key="' + key + '">' +
        '<td><b>' + esc(d.label) + '</b><div class="ht-sub">ID ' + esc(d.identifier) + '</div></td>' +
        '<td>' + person + (d.head_name ? '<div class="ht-sub">Head: ' + esc(d.head_name) + '</div>' : '') + '</td>' +
        '<td><span class="ht-badge ht-b-' + d.status + '">' + LABELS[d.status] + '</span></td>' +
        '<td>' + (d.speed || 0) + ' km/h</td>' +
        '<td class="ht-loc" title="' + esc(place(d)) + '">' + esc(place(d)) + '</td>' +
        '<td>' + ago(d.age_minutes) + '</td>' +
        '<td><span class="ht-link" data-focus="' + key + '">Show on map</span></td></tr>';
    }).join('');
    const miss = state.data.not_in_traccar || [];
    const m = el('missing');
    if (miss.length) {
      m.style.display = '';
      m.innerHTML = 'Linked in ERP but not found in Traccar: ' + miss.map((x) =>
        '<span class="ht-link" data-record="' + esc(x.record) + '">' + esc(x.label) + (x.employee_name ? ' (' + esc(x.employee_name) + ')' : '') + '</span>').join(', ') +
        '. Check the identifier matches the one on the phone.';
    } else m.style.display = 'none';
  }

  function renderPanel() {
    const p = el('panel');
    const d = state.data && state.data.devices.find((x) => String(x.traccar_id) === state.selected);
    if (!d) { p.style.display = 'none'; return; }
    const rows = [];
    const add = (k, v) => { if (v !== null && v !== undefined && v !== '') rows.push('<dt>' + k + '</dt><dd>' + v + '</dd>'); };
    add('Person', d.mapped ? (esc(d.employee_name) || '<span class="ht-muted">Not set</span>') : '<span class="ht-link" data-assign="' + d.traccar_id + '">Link to a person</span>');
    add('Department', esc(d.department));
    add('Vehicle', esc(d.vehicle));
    add('Head', esc(d.head_name));
    add('Phone', d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>' : '');
    add('Speed', (d.speed || 0) + ' km/h');
    add('Location', esc(place(d)));
    add('Last update', esc(d.last_update ? frappe.datetime.str_to_user(d.last_update) : '—') + ' <span class="ht-muted">(' + ago(d.age_minutes) + ')</span>');
    if (d.status === 'gps_off') add('GPS', '<b style="color:' + COLORS.gps_off + '">Switched off on the phone</b>');
    if (d.ignition != null) add('Ignition', d.ignition ? '<span class="ht-badge ht-b-online">ON</span>' : '<span class="ht-badge ht-b-unknown">OFF</span>');
    if (d.battery != null) add('Battery', Math.round(d.battery) + '%' + (d.charging ? ' (charging)' : ''));
    if (d.odometer != null) add('Odometer', (Math.round(d.odometer / 100) / 10).toLocaleString() + ' km');
    if (d.alarm) add('Last alarm', esc(d.alarm));
    add('Identifier', esc(d.identifier));
    const traccar = state.data.settings.traccar_url;
    p.innerHTML = '<button class="ht-close" data-act="close">&times;</button>' +
      '<h3>' + esc(d.label) + '</h3>' +
      '<span class="ht-badge ht-b-' + d.status + '">' + LABELS[d.status] + '</span>' +
      '<dl>' + rows.join('') + '</dl>' +
      '<div class="ht-btns">' +
      (d.record ? '<button class="btn btn-primary btn-sm" data-record="' + esc(d.record) + '">Open Record</button>'
        : '<button class="btn btn-primary btn-sm" data-assign="' + d.traccar_id + '">Link to a Person</button>') +
      (d.lat != null ? '<a class="btn btn-default btn-sm" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + d.lat + ',' + d.lon + '">Directions</a>' : '') +
      (traccar ? '<a class="btn btn-default btn-sm" target="_blank" rel="noopener" href="' + esc(traccar) + '/replay">Route History</a>' : '') +
      '</div>';
    p.style.display = '';
  }

  function select(key, fromMap) {
    state.selected = key;
    renderMarkers(); renderTable(); renderPanel();
    if (key && !fromMap) {
      const m = state.markers[key];
      if (m) state.map.setView(m.getLatLng(), Math.max(state.map.getZoom(), 14));
    }
  }

  function assign(key) {
    const d = state.data.devices.find((x) => String(x.traccar_id) === String(key));
    if (!d) return;
    frappe.new_doc('HiperTracker Device', { traccar_identifier: d.identifier, device_label: d.traccar_name || d.label, phone: d.phone || '' });
  }

  function showAlert(msg, isErr) {
    const a = el('alert');
    if (!msg) { a.style.display = 'none'; return; }
    a.className = 'ht-alert' + (isErr ? ' ht-alert-err' : '');
    a.innerHTML = msg;
    a.style.display = '';
  }

  function load(sync) {
    return frappe.call({ method: 'hipertracker.api.live', args: { sync: sync ? 1 : 0 } }).then((r) => {
      const data = r.message || {};
      state.data = data;
      data.devices = data.devices || [];
      R.querySelectorAll('.ht-mgr').forEach((b) => { b.style.display = data.is_manager ? '' : 'none'; });
      if (!state.map) initMap(data.settings);
      if (data.error) {
        showAlert(esc(data.error) + (data.is_manager ? ' <span class="ht-link" data-act="settings">Open Settings</span>' : ''), true);
      } else {
        const gps = data.devices.filter((d) => d.status === 'gps_off');
        const msgs = [];
        if (gps.length) msgs.push('<b>GPS switched off:</b> ' + gps.map((d) => esc(d.label) + (d.employee_name ? ' (' + esc(d.employee_name) + ')' : '')).join(', '));
        if (data.is_manager && data.unmapped_count) msgs.push(data.unmapped_count + ' device(s) are not linked to a person yet — filter by “Not linked to a person” to link them.');
        if (sync && data.created) msgs.push(data.created + ' new device(s) added from Traccar.');
        showAlert(msgs.join('<br>'), false);
      }
      renderKpis(); renderMarkers(); renderTable(); renderPanel();
      el('updated').textContent = 'Updated ' + frappe.datetime.now_time().slice(0, 5);
      return data;
    });
  }

  // ---- events ----
  R.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act],[data-layer],[data-assign],[data-record],[data-focus],tr.ht-row');
    if (!t) return;
    if (t.dataset.act === 'refresh') return load(false);
    if (t.dataset.act === 'sync') { frappe.show_alert({ message: 'Syncing devices from Traccar…', indicator: 'blue' }); return load(true); }
    if (t.dataset.act === 'settings') return frappe.set_route('Form', 'HiperTracker Settings');
    if (t.dataset.act === 'close') return select(null);
    if (t.dataset.act === 'fullscreen') {
      R.querySelector('.ht-mapwrap').classList.toggle('ht-full');
      return setTimeout(() => state.map && state.map.invalidateSize(), 200);
    }
    if (t.dataset.layer) {
      R.querySelectorAll('[data-layer]').forEach((b) => b.classList.toggle('on', b === t));
      if (t.dataset.layer === 'sat') { state.map.removeLayer(state.base); state.sat.addTo(state.map); }
      else { state.map.removeLayer(state.sat); state.base.addTo(state.map); }
      return;
    }
    if (t.dataset.assign) { e.stopPropagation(); return assign(t.dataset.assign); }
    if (t.dataset.record) { e.stopPropagation(); return frappe.set_route('Form', 'HiperTracker Device', t.dataset.record); }
    if (t.dataset.focus) { e.stopPropagation(); return select(t.dataset.focus); }
    if (t.dataset.key) return select(t.dataset.key);
  });
  el('search').addEventListener('input', () => state.data && renderTable());
  el('status').addEventListener('change', () => state.data && renderTable());

  loadLeaflet().then(() => load(false)).then((data) => {
    const every = ((data && data.settings && data.settings.refresh) || 30) * 1000;
    window.__hipertrackerTimer = setInterval(() => {
      if (!R.isConnected) { clearInterval(window.__hipertrackerTimer); window.__hipertrackerTimer = null; return; }
      if (document.visibilityState === 'visible') load(false);
    }, every);
  }).catch((err) => {
    showAlert('Could not load the map: ' + esc(err && err.message ? err.message : err), true);
  });
})();
