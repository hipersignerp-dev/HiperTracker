# Copyright (c) 2026, Hipersign and contributors
# For license information, please see license.txt

import random

from frappe.model.document import Document


class HiperTrackerDevice(Document):
	def validate(self):
		# the identifier must match the phone exactly, so drop stray spaces
		if not self.traccar_identifier:
			self.traccar_identifier = str(random.randint(10000000, 99999999))
		self.traccar_identifier = self.traccar_identifier.strip()
		if not self.device_label:
			self.device_label = self.employee_name or self.traccar_identifier

	def on_update(self):
		from hipertracker.api import push_device

		push_device(self)
