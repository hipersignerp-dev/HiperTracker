app_name = "hipertracker"
app_title = "HiperTracker"
app_publisher = "Hipersign"
app_description = "Live GPS tracking of staff and vehicles from Traccar, inside Hipersign ERP"
app_email = "hipersignerp@gmail.com"
app_license = "mit"
app_logo_url = "/assets/hipertracker/images/hipertracker-logo.png"

# Shows HiperTracker (with its logo) in the apps switcher
add_to_apps_screen = [
	{
		"name": "hipertracker",
		"logo": "/assets/hipertracker/images/hipertracker-logo.png",
		"title": "HiperTracker",
		"route": "/app/hipertracker",
	}
]

# Install / migrate: creates roles, the live map block, the sidebar and the desktop icon
before_install = "hipertracker.install.before_install"
after_install = "hipertracker.install.after_install"
after_migrate = "hipertracker.install.after_migrate"

# The phone app and the map call these short names (first built as server scripts on Nexus)
override_whitelisted_methods = {
	"hipertracker_live": "hipertracker.api.live",
	"hipertracker_mobile_config": "hipertracker.api.mobile_config",
	"hipertracker_checkin": "hipertracker.api.checkin",
}
