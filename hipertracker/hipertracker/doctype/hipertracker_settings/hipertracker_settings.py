# Copyright (c) 2026, Hipersign and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document


class HiperTrackerSettings(Document):
	def validate(self):
		if self.traccar_url:
			self.traccar_url = self.traccar_url.strip().rstrip("/")
			if not self.traccar_url.startswith(("http://", "https://")):
				frappe.throw("Traccar Server URL must start with http:// or https://")
		if self.refresh_seconds and self.refresh_seconds < 10:
			self.refresh_seconds = 10
