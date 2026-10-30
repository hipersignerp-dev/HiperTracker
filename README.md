<p align="center"><img src="hipertracker/public/images/hipertracker-logo-192.png" alt="HiperTracker" width="160"></p>

# HiperTracker

Live GPS tracking of staff and vehicles inside **Hipersign ERP**, powered by your own [Traccar](https://www.traccar.org) server.

Open the **HiperTracker** workspace and you get a live map of Kerala with every tracked phone on it:

- a coloured marker per phone: **green** online, **red** offline, **flashing orange** when the worker has switched GPS off
- a label with the vehicle number or person's name and their current speed (truck icon for vehicles, person icon for staff)
- counters for total, online, offline and GPS-off devices, and average moving speed
- click a marker for the person, their head, phone, speed, address, last update, battery, directions and route history
- a searchable list of all devices under the map; refreshes every 30 seconds

## How a phone is matched to a person

Every phone running the tracker app shows an **Identifier** (e.g. `48213907`). That number links everything:

1. **Traccar:** add the phone as a device with that number as its *Identifier*.
2. **ERP → HiperTracker → Devices & People:** a record with the same *Traccar Identifier*, the *Employee* who carries it and their *Head*.

You don't have to type step 2: press **Sync from Traccar** on the map and every Traccar device is added to ERP. Then filter by *Not linked to a person* and link each one.

## Installation

```bash
cd ~/frappe-bench
bench get-app https://github.com/hipersignerp-dev/HiperTracker
bench --site <your-site> install-app hipertracker
bench --site <your-site> migrate
```

Installing creates:

- the **HiperTracker** workspace with the live map
- the **HiperTracker** desktop tile (with the logo) and sidebar
- doctypes **HiperTracker Device** and **HiperTracker Settings**
- roles **HiperTracker Manager** (full access, can sync) and **HiperTracker User** (view the map; give this to heads)

If HiperTracker was first set up by hand on the site (as on Nexus), installing takes over those records and keeps their data.

## Connect Traccar

1. Log in to your Traccar server (e.g. `https://gps.hipersignerp.cloud`) as an **admin**.
2. Account settings → generate a **Token** → copy it.
3. ERP → **HiperTracker Settings** → paste it into **Traccar API Token** and save.

## Who sees what

| Role | Sees |
|---|---|
| System Manager, HiperTracker Manager | All devices, including ones not linked to a person yet; can sync and edit |
| HiperTracker User | Devices they can read in *HiperTracker Device* (use User Permissions to limit a head to their team) |

## GPS-off alerts

The tracker app (from `hipersignerp-dev/Hipersign-traccar-client`) warns the worker when location is turned off and, if it stays off for 30 seconds, sends a **GPS Antenna Cut** alarm to Traccar. Those phones show flashing orange on the map and are listed at the top. To email the head, add an *Alarm → GPS Antenna Cut* notification for them in Traccar.

## License

MIT
