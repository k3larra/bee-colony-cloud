# Arduino Cloud Device Viewer

A small Node.js server for viewing Arduino Cloud devices from personal and university scopes.

## What It Does

- Fetches device data from the Arduino Cloud API
- Exposes JSON endpoints for personal and university device lists
- Serves a browser view for the university device list at `/university`

## Requirements

- Node.js 18+ with built-in `fetch`
- Arduino Cloud API credentials
- Internet access

## Setup

Create `secure/local.env` with your local credentials:

```env
ARDUINO_CLIENT_ID=your_client_id_here
ARDUINO_CLIENT_SECRET=your_client_secret_here
ARDUINO_UNI_CLIENT_ID=your_university_client_id_here
ARDUINO_UNI_CLIENT_SECRET=your_university_client_secret_here
ARDUINO_UNI_ORG_ID=your_university_org_id_here
DEFAULT_WIFI_SSID=your_wifi_ssid_here
DEFAULT_WIFI_PASS=your_wifi_password_here
PORT=3000
```

The `secure` folder is ignored by Git and is intended for local-only secrets.

Managed device groups and target firmware versions live in `config/fleet.json`.
Per-device Arduino Cloud bindings live in `secure/device-configs/<device-name>/`.

Recommended naming:

- use the Arduino Cloud friendly name as the primary device name
- keep class membership in `config/fleet.json`
- only use short local codes when you deliberately want them

## Run

```powershell
npm start
```

Then open:

```text
http://localhost:3000
```

The root URL redirects to `/university`.

Fleet administration is available at `http://localhost:3000/admin`.
Device notes in the admin table are editable and are saved back to `config/fleet.json`.

## OTA Deployment

Use the reusable PowerShell deployment script to compile the shared class sketch for each configured device and upload it over Arduino Cloud OTA:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker
```

Optional: target specific devices inside the class:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker -DeviceNames W1,W2
```

Requirements for each managed device:

- an entry in `config/fleet.json`
- `secure/device-configs/<device-name>/thingProperties.h`
- `secure/device-configs/<device-name>/arduino_secrets.h`
- Arduino Cloud API credentials in `secure/local.env`

The same worker deployment can also be triggered from the `/admin` page.
The admin page reads each class target version from the shared sketch file when it finds `FIRMWARE_VERSION`, so changing `sketches/worker/worker.ino` is normally enough.

## Add A New Device

Recommended low-error flow for a new worker:

1. Create the device and Thing in Arduino Cloud.
2. Add the expected Cloud variables, including `firmware_version`.
3. Download the Arduino Cloud sketch zip for that device into `private/`.
4. Put the Arduino Device Secret Key PDF for that device into `secure/device-secrets/`.
5. Run the one-command onboarding and deployment script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\onboard-and-deploy-device.ps1 -Class worker -DeviceId <device-id> -ExportZip .\private\<export-name>.zip
```

If `-Name` is omitted, the script uses the Arduino Cloud friendly name by default.
The sketch zip filename does not matter; only the `-ExportZip` path and the contents of the export matter.

If `DEFAULT_WIFI_SSID` and `DEFAULT_WIFI_PASS` are set in `secure/local.env`, the script also fills the Wi-Fi credentials automatically.
If a matching device-secret PDF exists in `secure/device-secrets/` or `secure/`, the script auto-discovers it by device ID.

Manual two-step flow is still available when needed:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\add-managed-device.ps1 -Class worker -DeviceId <device-id> -ExportZip .\private\<export-name>.zip
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker -DeviceNames <device-name>
```

The scaffold script:

- adds the device to `config/fleet.json`
- creates `secure/device-configs/<device-name>/`
- imports `thingProperties.h` and `arduino_secrets.h` from the export zip when provided
- auto-discovers and extracts `SECRET_DEVICE_KEY` from a matching Arduino Device Secret Key PDF when available
- fills Wi-Fi credentials from `secure/local.env` when available
- infers the Thing ID and FQBN when possible from Arduino Cloud

## Main Routes

- `/health`
- `/devices`
- `/personal/devices`
- `/university/devices`
- `/university/names`
- `/university`
- `/admin`
- `/admin/fleet`
- `/admin/deploy`

## Notes

- The app no longer contains bundled credentials.
- Keep real secrets only in `secure/local.env`.
- Managed device classes and desired firmware targets are stored in `config/fleet.json`.
- OTA deployment is handled by `scripts/deploy-class.ps1`.
- New device onboarding is scaffolded by `scripts/add-managed-device.ps1`.
- One-command onboarding and deployment is handled by `scripts/onboard-and-deploy-device.ps1`.
- The local repo is the source of truth for sketch code. Arduino Cloud's online sketch copy can drift after local OTA deployments because OTA uploads use compiled binaries, not a documented source-sync step.
- Recommended practice: use Arduino Cloud templates and exported sketches for provisioning, but treat local `sketches/` as canonical for ongoing development and OTA releases.
- If credentials were ever committed elsewhere, rotate them before publishing.

More detail is available in [MANUAL.md](C:\Users\K3LARA\Documents\agentprojects\arduinoespcloud1\MANUAL.md).
