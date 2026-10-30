#!/bin/sh
# Rebuilds the HiperTracker Device form/list scripts from map_block/ sources.
set -e
cd "$(dirname "$0")/hipertracker/hipertracker"
D=doctype/hipertracker_device
for pair in "device_form.src.js:hipertracker_device.js" "device_list.src.js:hipertracker_device_list.js"; do
	src=${pair%%:*}
	out=${pair##*:}
	{
		printf '// Generated from map_block/htmini.js + map_block/%s - edit those and rebuild.\n' "$src"
		cat map_block/htmini.js
		echo
		cat "map_block/$src"
	} > "$D/$out"
done
echo "built $D/hipertracker_device.js and $D/hipertracker_device_list.js"
