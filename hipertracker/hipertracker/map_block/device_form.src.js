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
