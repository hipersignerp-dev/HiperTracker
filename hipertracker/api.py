# Copyright (c) 2026, Hipersign and contributors
# For license information, please see license.txt
"""Live data for the HiperTracker map.

Reads devices and their latest positions from Traccar and joins them to
HiperTracker Device records on the Traccar Identifier, so the map knows which
phone or vehicle belongs to which person.
"""

import frappe
import requests
from frappe.utils import (
	cint,
	convert_utc_to_system_timezone,
	flt,
	get_datetime,
	now_datetime,
	time_diff_in_seconds,
)

STATUS_LABELS = {"online": "Online", "offline": "Offline", "gps_off": "GPS Off", "unknown": "Offline"}
STATUS_RANK = {"gps_off": 0, "online": 1, "offline": 2, "unknown": 3}
DEVICE_FIELDS = [
	"name",
	"traccar_identifier",
	"device_label",
	"tracks",
	"active",
	"employee",
	"employee_name",
	"department",
	"vehicle",
	"reporting_head",
	"head_name",
	"phone",
	"last_update",
]
TIMEOUT = 15


def _is_manager():
	roles = frappe.get_roles()
	return frappe.session.user == "Administrator" or "System Manager" in roles or "HiperTracker Manager" in roles


def _settings():
	s = frappe.get_cached_doc("HiperTracker Settings")
	return s, {
		"center": [flt(s.map_center_lat) or 10.55, flt(s.map_center_lon) or 76.3],
		"zoom": cint(s.map_zoom) or 8,
		"refresh": max(cint(s.refresh_seconds) or 30, 10),
		"stale_minutes": max(cint(s.stale_minutes) or 15, 1),
		"traccar_url": (s.traccar_url or "").strip().rstrip("/"),
	}


def _session(s):
	"""A requests session signed in to Traccar, or None if not configured."""
	sess = requests.Session()
	sess.headers["Accept"] = "application/json"
	if (s.auth_method or "API Token") == "Email and Password":
		password = s.get_password("traccar_password", raise_exception=False)
		if not s.traccar_email or not password:
			return None
		sess.auth = (s.traccar_email, password)
	else:
		token = s.get_password("api_token", raise_exception=False)
		if not token:
			return None
		sess.headers["Authorization"] = "Bearer " + token
	return sess


def _get(sess, url):
	r = sess.get(url, timeout=TIMEOUT)
	r.raise_for_status()
	return r.json()


def _to_system_time(iso):
	"""Traccar sends UTC like 2026-10-30T10:12:00.000+00:00."""
	if not iso:
		return None
	return convert_utc_to_system_timezone(get_datetime(str(iso)[:19].replace("T", " "))).replace(tzinfo=None)


@frappe.whitelist()
def live(sync=0):
	"""Devices with their latest position. sync=1 (managers) also adds new Traccar devices to ERP."""
	frappe.has_permission("HiperTracker Device", "read", throw=True)
	is_manager = _is_manager()
	do_sync = cint(sync) and is_manager
	s, settings = _settings()
	result = {
		"settings": settings,
		"is_manager": 1 if is_manager else 0,
		"devices": [],
		"not_in_traccar": [],
		"unmapped_count": 0,
		"created": 0,
		"error": None,
	}

	links = frappe.get_list("HiperTracker Device", fields=DEVICE_FIELDS, limit_page_length=0)
	by_ident = {(l.traccar_identifier or "").strip(): l for l in links}

	base = settings["traccar_url"]
	sess = _session(s) if base else None
	if not sess:
		result["error"] = (
			"Traccar is not connected yet. Open HiperTracker Settings and add the server URL and API token."
		)
		return result

	try:
		try:
			tdevices = _get(sess, base + "/api/devices?all=true")
		except requests.HTTPError:
			tdevices = _get(sess, base + "/api/devices")
		positions = _get(sess, base + "/api/positions") or []
	except Exception as e:
		frappe.log_error(title="HiperTracker: Traccar request failed", message=frappe.get_traceback())
		status = getattr(getattr(e, "response", None), "status_code", None)
		if status in (401, 403):
			result["error"] = "Traccar refused the sign-in. Check the API token in HiperTracker Settings."
		else:
			result["error"] = "Could not reach Traccar at " + base + ". Check the URL in HiperTracker Settings."
		return result

	pos_by_id = {p.get("id"): p for p in positions}
	missing = [d.get("positionId") for d in tdevices if d.get("positionId") and d.get("positionId") not in pos_by_id]
	for i in range(0, len(missing), 50):
		try:
			chunk = "&".join("id=" + str(pid) for pid in missing[i : i + 50])
			for p in _get(sess, base + "/api/positions?" + chunk) or []:
				pos_by_id[p.get("id")] = p
		except Exception:
			pass

	show_unassigned = cint(s.show_unassigned) if s.show_unassigned is not None else 1
	now = now_datetime()
	seen = set()
	out = []

	for d in tdevices:
		ident = (d.get("uniqueId") or "").strip()
		link = by_ident.get(ident)

		if link is None and do_sync and ident:
			link = _create_device(d, ident)
			if link:
				result["created"] += 1

		if link is not None:
			seen.add(ident)
			if not link.get("active"):
				continue
		else:
			result["unmapped_count"] += 1
			if not (is_manager and show_unassigned):
				continue

		p = pos_by_id.get(d.get("positionId")) or {}
		attrs = p.get("attributes") or {}
		loc_flag = attrs.get("locationEnabled")
		gps_off = loc_flag is False or str(loc_flag).lower() == "false"
		last_dt = _to_system_time(d.get("lastUpdate") or p.get("serverTime") or p.get("fixTime"))
		age_min = time_diff_in_seconds(now, last_dt) / 60.0 if last_dt else None

		status = "online" if d.get("status") == "online" else "offline"
		if age_min is not None and age_min > settings["stale_minutes"]:
			status = "offline"
		if last_dt is None:
			status = "unknown"
		if gps_off:
			status = "gps_off"
		if d.get("disabled"):
			status = "offline"
		speed = round(flt(p.get("speed")) * 1.852, 1)  # Traccar speed is in knots

		lk = link or {}
		out.append(
			{
				"traccar_id": d.get("id"),
				"identifier": ident,
				"traccar_name": d.get("name"),
				"label": lk.get("device_label") or d.get("name") or ident,
				"record": lk.get("name"),
				"mapped": 1 if link is not None else 0,
				"tracks": lk.get("tracks") or "Person",
				"employee": lk.get("employee"),
				"employee_name": lk.get("employee_name"),
				"department": lk.get("department"),
				"vehicle": lk.get("vehicle"),
				"head_name": lk.get("head_name"),
				"phone": lk.get("phone") or d.get("phone"),
				"status": status,
				"traccar_status": d.get("status"),
				"last_update": str(last_dt) if last_dt else None,
				"age_minutes": round(age_min, 1) if age_min is not None else None,
				"lat": p.get("latitude"),
				"lon": p.get("longitude"),
				"speed": speed,
				"course": p.get("course"),
				"address": p.get("address"),
				"battery": attrs.get("batteryLevel"),
				"charging": attrs.get("charge"),
				"motion": attrs.get("motion"),
				"ignition": attrs.get("ignition"),
				"alarm": attrs.get("alarm"),
				"odometer": attrs.get("totalDistance"),
				"location_enabled": 0 if gps_off else 1,
				"accuracy": p.get("accuracy"),
			}
		)

		# keep the cached status on the ERP record fresh (at most every 5 min, or on sync)
		if link is not None and is_manager:
			stored = lk.get("last_update")
			stale_cache = stored is None or (
				last_dt is not None and time_diff_in_seconds(last_dt, get_datetime(stored)) > 300
			)
			if do_sync or stale_cache:
				frappe.db.set_value(
					"HiperTracker Device",
					lk.get("name"),
					{
						"traccar_device_id": d.get("id"),
						"traccar_name": d.get("name"),
						"last_status": STATUS_LABELS.get(status, "Offline"),
						"last_update": last_dt,
						"last_latitude": p.get("latitude"),
						"last_longitude": p.get("longitude"),
						"last_speed": speed,
						"last_address": p.get("address"),
					},
					update_modified=False,
				)

	for l in links:
		ident = (l.traccar_identifier or "").strip()
		if l.active and ident not in seen:
			result["not_in_traccar"].append(
				{"record": l.name, "label": l.device_label, "identifier": ident, "employee_name": l.employee_name}
			)
			if do_sync:
				frappe.db.set_value(
					"HiperTracker Device", l.name, "last_status", "Not in Traccar", update_modified=False
				)

	result["devices"] = sorted(out, key=lambda r: (STATUS_RANK.get(r["status"], 4), (r["label"] or "").lower()))
	return result


def _create_device(d, ident):
	try:
		doc = frappe.get_doc(
			{
				"doctype": "HiperTracker Device",
				"traccar_identifier": ident,
				"device_label": d.get("name") or ident,
				"active": 1,
				"traccar_device_id": d.get("id"),
				"traccar_name": d.get("name"),
				"phone": d.get("phone"),
			}
		).insert()
		return frappe._dict(
			name=doc.name,
			traccar_identifier=ident,
			device_label=doc.device_label,
			tracks="Person",
			active=1,
			last_update=None,
		)
	except Exception:
		frappe.log_error(title="HiperTracker: could not add device " + ident, message=frappe.get_traceback())
		return None
