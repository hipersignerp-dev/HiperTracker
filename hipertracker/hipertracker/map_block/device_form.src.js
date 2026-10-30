// HiperTracker Device form: live map of where this phone / vehicle is now.
var HT_METHOD = "hipertracker.api.live";

frappe.ui.form.on("HiperTracker Device", {
	refresh(frm) {
		ht_form_render(frm, true);
		if (frm.__ht_timer) clearInterval(frm.__ht_timer);
		frm.__ht_timer = setInterval(() => {
			const route = frappe.get_route();
			if (route[0] !== "Form" || route[1] !== frm.doctype || route[2] !== frm.doc.name) {
				clearInterval(frm.__ht_timer);
				frm.__ht_timer = null;
				return;
			}
			if (document.visibilityState === "visible") ht_form_render(frm, false);
		}, 30000);
	},
	traccar_identifier(frm) {
		ht_form_render(frm, true);
	},
});

function ht_form_render(frm, recenter) {
	const H = window.htmini;
	const field = frm.fields_dict.live_map;
	if (!field) return;
	const wrap = field.$wrapper;
	const ident = String(frm.doc.traccar_identifier || "").trim();
	if (!ident) {
		wrap.html('<div class="text-muted small">Enter the Identifier shown in the tracker app on the phone to see where it is.</div>');
		return;
	}
	if (!wrap.find(".ht-fmap").length) {
		wrap.html(
			'<div class="ht-finfo" style="display:flex;flex-wrap:wrap;gap:8px 18px;align-items:center;margin-bottom:10px;font-size:13px"></div>' +
				'<div class="ht-fmap" style="height:340px;border-radius:12px;overflow:hidden;border:1px solid var(--border-color)"></div>'
		);
	}
	const info = wrap.find(".ht-finfo");
	frappe.call({ method: HT_METHOD, args: { sync: 0 } }).then((r) => {
		const data = r.message || {};
		if (data.error) {
			info.html('<span class="text-danger">' + H.esc(data.error) + "</span>");
			wrap.find(".ht-fmap").hide();
			return;
		}
		const d = (data.devices || []).find((x) => x.identifier === ident);
		if (!d) {
			info.html(
				'<span class="text-muted">No phone with Identifier <b>' + H.esc(ident) +
					"</b> is in Traccar yet. Add it in Traccar with this exact identifier.</span>"
			);
			wrap.find(".ht-fmap").hide();
			return;
		}
		const traccar = (data.settings || {}).traccar_url;
		info.html(
			H.badge(d.status) +
				"<span><b>" + (d.speed || 0) + " km/h</b></span>" +
				'<span title="' + H.esc(H.place(d)) + '">📍 ' + H.esc(H.place(d)) + "</span>" +
				'<span class="text-muted">Updated ' + H.ago(d.age_minutes) + "</span>" +
				(d.battery != null ? '<span class="text-muted">🔋 ' + Math.round(d.battery) + "%</span>" : "") +
				(d.status === "gps_off" ? '<b style="color:' + H.COLORS.gps_off + '">GPS switched off on the phone</b>' : "") +
				'<span style="margin-left:auto;display:flex;gap:8px">' +
				(d.lat != null ? '<a class="btn btn-xs btn-default" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + d.lat + "," + d.lon + '">Directions</a>' : "") +
				(traccar ? '<a class="btn btn-xs btn-default" target="_blank" rel="noopener" href="' + H.esc(traccar) + '/replay">Route History</a>' : "") +
				'<a class="btn btn-xs btn-default" href="javascript:void(0)" onclick="frappe.set_route(\'hipertracker\')">All on map</a></span>'
		);
		if (d.lat == null) {
			wrap.find(".ht-fmap").hide();
			return;
		}
		wrap.find(".ht-fmap").show();
		H.leaflet().then(() => {
			const el = wrap.find(".ht-fmap")[0];
			if (!el.__htmap) {
				el.__htmap = H.makeMap(el);
				recenter = true;
			}
			const map = el.__htmap;
			if (el.__htmarker) H.update(el.__htmarker, d);
			else el.__htmarker = H.marker(d).addTo(map);
			if (recenter) map.setView([d.lat, d.lon], 15);
			setTimeout(() => map.invalidateSize(), 200);
		});
	});
}

// ---- Phone setup: install-app QR + setup QR that puts the server and this identifier into the phone ----
frappe.ui.form.on("HiperTracker Device", {
	onload(frm) {
		if (frm.is_new() && !frm.doc.traccar_identifier) {
			frm.set_value("traccar_identifier", String(Math.floor(10000000 + Math.random() * 90000000)));
		}
	},
	refresh(frm) {
		ht_setup_render(frm);
	},
	traccar_identifier(frm) {
		ht_setup_render(frm);
	},
});

function ht_qr_lib() {
	if (window.QRCode) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const s = document.createElement("script");
		s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
		s.onload = () => resolve();
		s.onerror = () => reject(new Error("QR library could not load"));
		document.head.appendChild(s);
	});
}

function ht_setup_render(frm) {
	const field = frm.fields_dict.phone_setup;
	if (!field) return;
	const wrap = field.$wrapper;
	const H = window.htmini;
	const ident = String(frm.doc.traccar_identifier || "").trim();
	if (!ident) {
		wrap.html('<div class="text-muted small">Enter or generate the Traccar Identifier first.</div>');
		return;
	}
	const S = "HiperTracker Settings";
	frappe.db
		.get_value(S, S, ["phone_report_url", "app_download_url", "phone_interval", "phone_distance"])
		.then((r) => {
			const s = (r && r.message) || {};
			const report = (s.phone_report_url || "http://gps.hipersignerp.cloud:5055").replace(/\/+$/, "");
			const download = s.app_download_url ||
				"https://github.com/hipersignerp-dev/Hipersign-traccar-client/releases/latest/download/HiperTracker.apk";
			const params = new URLSearchParams({
				id: ident,
				accuracy: "high",
				interval: String(s.phone_interval || 60),
				distance: String(s.phone_distance || 50),
				heartbeat: "300",
				buffer: "true",
				stop_detection: "true",
				wakelock: "true",
			});
			const setup = report + "?" + params.toString();
			const card = (title, steps, id, text) =>
				'<div style="flex:1 1 260px;border:1px solid var(--border-color);border-radius:12px;padding:14px">' +
				'<div style="font-weight:600;margin-bottom:6px">' + title + "</div>" +
				'<div class="text-muted small" style="margin-bottom:10px">' + steps + "</div>" +
				'<div class="' + id + '" style="background:#fff;padding:8px;display:inline-block;border-radius:8px"></div>' +
				'<div class="small" style="margin-top:8px;word-break:break-all"><a href="' + H.esc(text) + '" target="_blank" rel="noopener">' +
				H.esc(text) + "</a></div></div>";
			wrap.html(
				'<div style="display:flex;flex-wrap:wrap;gap:14px">' +
					card("1. Install the app", "Scan with the phone's camera, download <b>HiperTracker.apk</b> and install it.", "ht-qr-install", download) +
					card("2. Set up this phone", "In HiperTracker on the phone: ⚙ Settings → QR icon → scan this. It links the phone to <b>" +
						H.esc(frm.doc.employee_name || frm.doc.device_label || ident) + "</b> (ID " + H.esc(ident) + ").", "ht-qr-setup", setup) +
				"</div>" +
				(frm.is_new() ? '<div class="text-muted small" style="margin-top:8px">Save this device before scanning, so it is added to Traccar.</div>' : "")
			);
			return ht_qr_lib().then(() => {
				new window.QRCode(wrap.find(".ht-qr-install")[0], { text: download, width: 170, height: 170, correctLevel: window.QRCode.CorrectLevel.M });
				new window.QRCode(wrap.find(".ht-qr-setup")[0], { text: setup, width: 170, height: 170, correctLevel: window.QRCode.CorrectLevel.M });
			});
		})
		.catch(() => wrap.html('<div class="text-muted small">Phone setup is available to HiperTracker managers.</div>'));
}
