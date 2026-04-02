# Arduino Cloud Device Viewer Manual

This project contains a local Node.js server that reads device data from Arduino Cloud.

## Project Files

- `server.js`: HTTP server for Arduino Cloud device data.
- `config/fleet.json`: Local fleet registry with device classes and target versions.
- `scripts/add-managed-device.ps1`: Scaffold a new managed device entry and local config folder.
- `scripts/onboard-and-deploy-device.ps1`: One-command flow for onboarding and deploying a new device.
- `scripts/deploy-class.ps1`: Compile and OTA-deploy a class sketch to managed devices.
- `.env.example`: Example environment configuration.
- `secure/cloudspace.pdf`: Local-only reference document for the Malmo cloudspace.

## Requirements

- Node.js
- npm
- Arduino Cloud API credentials
- Internet access when querying Arduino Cloud

## Configuration

Create a `secure/local.env` file and set these values:

```env
ARDUINO_CLIENT_ID=your_client_id_here
ARDUINO_CLIENT_SECRET=your_client_secret_here
ARDUINO_UNI_CLIENT_ID=your_cloudspace_client_id_here
ARDUINO_UNI_CLIENT_SECRET=your_cloudspace_client_secret_here
ARDUINO_UNI_ORG_ID=your_cloudspace_org_id_here
DEFAULT_WIFI_SSID=your_wifi_ssid_here
DEFAULT_WIFI_PASS=your_wifi_password_here
PORT=3000
```

### Variables

- `ARDUINO_CLIENT_ID`: Personal Arduino Cloud client ID.
- `ARDUINO_CLIENT_SECRET`: Personal Arduino Cloud client secret.
- `ARDUINO_UNI_CLIENT_ID`: Cloudspace/shared-space client ID.
- `ARDUINO_UNI_CLIENT_SECRET`: Cloudspace/shared-space client secret.
- `ARDUINO_UNI_ORG_ID`: Arduino organization ID for the cloudspace.
- `DEFAULT_WIFI_SSID`: Optional default Wi-Fi SSID used when scaffolding a device config.
- `DEFAULT_WIFI_PASS`: Optional default Wi-Fi password used when scaffolding a device config.
- `PORT`: Local HTTP port for the server.

Keep real credentials only in the `secure` folder. That folder is excluded from Git.

Managed device classes and desired firmware versions are stored in `config/fleet.json`.
Per-device Arduino Cloud bindings live in `secure/device-configs/<device-name>/`.

Recommended naming:

- use the Arduino Cloud friendly name as the primary device name
- keep class membership in `config/fleet.json`
- only use short local codes when you deliberately want them

## Start the Server

From the project folder:

```powershell
npm start
```

This runs:

```powershell
node server.js
```

When the server starts successfully, it listens on:

```text
http://localhost:3000
```

If you changed `PORT`, use that port instead.

The root URL redirects to `/cloudspace`.

The administration view is available at `http://localhost:3000/admin`.
Device notes in the admin table can be edited inline and are saved to `config/fleet.json`.

## API Routes

Most routes are `GET`. The deployment trigger uses `POST`.

### Health

- `/health`

Returns:

```json
{ "ok": true }
```

### Personal Scope

- `/`
- `/devices`
- `/personal/devices`

Returns full personal device data:

- `scope`
- `fetchedAt`
- `totalDevices`
- `onlineCount`
- `allDevices`
- `onlineDevices`

Additional personal routes:

- `/personal/online`: Only online personal devices.
- `/personal/names`: Compact list with `id`, `name`, and `status`.

### Cloudspace Scope

- `/cloudspace/devices`: Full cloudspace/shared-space device data.
- `/cloudspace/online`: Only online cloudspace devices.
- `/cloudspace/names`: Compact list with `id`, `name`, and `status`.
- `/cloudspace`: Browser page for viewing and filtering cloudspace devices.

### Fleet Administration

- `/admin`: Browser page for the managed fleet and version overview.
- `/admin/fleet`: JSON payload for managed device classes, cloud status, and desired versus reported versions.
- `/admin/deploy`: POST endpoint used by the admin page to trigger a class deployment.

## OTA Deployment

To deploy a shared class sketch over Arduino Cloud OTA:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker
```

To limit the rollout to named devices inside the class:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker -DeviceNames W1,W2
```

For each managed device, the script expects these local-only files:

- `secure/device-configs/<device-name>/thingProperties.h`
- `secure/device-configs/<device-name>/arduino_secrets.h`

The script compiles one device-specific firmware per target device from the shared class sketch and then schedules OTA upload through Arduino Cloud.
The `/admin` page includes a button for deploying the worker class through the same script.
For version tracking, the admin page prefers the `FIRMWARE_VERSION` value from the shared sketch file and only falls back to `config/fleet.json` if no sketch version is found.
Before deployment, the script compares the local sketch version with the version reported by each target device and blocks the rollout if a device is already on a newer version.
The script also blocks deployment unless the current git branch is `main` and the tracked project files are clean. Use `-AllowUnsafeGit` only when you deliberately want to bypass that check.

## Cloud Variables

Version `0.9` currently uses five active devices:

- `W1`, `W2`, and `W3` as workers
- `Hive1` as the hive
- `Queen1` as the queen

Arduino Cloud is currently responsible for:

- monitoring caste state and firmware versions
- changing worker effort through `servo_speed`
- changing queen policy values
- OTA deployment

The live colony exchange between castes is local LAN traffic, not Cloud Thing-to-Thing access:

- workers report to the hive locally
- the hive fetches queen policy locally

### Worker Variables

- `firmware_version`
  Current worker firmware version. Used for deployment tracking.
- `worker_state`
  Current local worker state, for example `offline`, `idle`, `searching`, or `foraging`.
- `energy_use`
  Local cost derived from worker effort. The hive sums this into `consumption_load`.
- `harvest_offer`
  Local harvest estimate derived from `ldr_value`. The hive sums this into `incoming_light`.
- `ldr_value`
  Raw light sensor value from the worker LDR. In the current setup it is published every 10 seconds.
- `servo_speed`
  Writable worker effort control. Increasing this makes the worker more active and raises `energy_use`.
- `alive`
  Worker connectivity status. In the current code it reflects whether the worker is online and reporting.

### Hive Variables

- `firmware_version`
  Current hive firmware version. Used for deployment tracking.
- `incoming_light`
  Aggregated resource input received from worker reports over the LAN.
- `consumption_load`
  Aggregated resource cost received from worker reports over the LAN.
- `alive_workers`
  Number of workers the hive currently considers active based on recent reports.
- `stored_light`
  Colony resource store. In the current code it is clamped to a maximum of `1000`.
- `colony_state`
  Colony condition derived by the hive. Current states are `healthy`, `stressed`, and `critical`.
- `queen_mode`
  The current high-level policy received from the queen, for example `stable`, `conserve`, or `expand`.

### Queen Variables

- `firmware_version`
  Current queen firmware version. Used for deployment tracking.
- `desired_mode`
  Writable high-level colony policy set in Arduino Cloud. Allowed values are `stable`, `conserve`, and `expand`.
- `min_store_threshold`
  Writable colony stress threshold. The hive uses it to decide when the colony becomes `stressed` or `critical`.
- `target_worker_effort`
  Writable policy hint for future worker control. It is visible in the current runtime but is not yet automatically driving `servo_speed`.
- `queen_health`
  Basic status string reported by the queen sketch.

### Current Runtime Meaning

- Workers sense local light and publish `harvest_offer` and `energy_use`.
- The hive aggregates those values into `incoming_light` and `consumption_load`.
- The hive updates `stored_light` from the difference between incoming and outgoing load.
- The queen provides slow-changing policy values through Arduino Cloud and exposes them locally to the hive.

### Worker LED Meaning

- `D2`
  Lights when the worker is active, which currently means `servo_speed > 0`.
- `D3`
  Blinks in 1-second intervals when the hive reports the colony state as `stressed` or `critical`.

## Add A New Managed Device

Recommended low-error flow:

1. Create the device and Thing in Arduino Cloud.
2. Add the expected Cloud variables for the class, including `firmware_version` when the class uses firmware reporting.
3. Download the Arduino Cloud sketch zip into `private/`.
4. Put the Arduino Device Secret Key PDF into `secure/device-secrets/`.
5. Run the one-command onboarding and deployment script:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\onboard-and-deploy-device.ps1 -Class worker -DeviceId <device-id> -ExportZip .\private\<export-name>.zip
```

If the `-Name` argument is omitted, the script uses the Arduino Cloud friendly name by default.
If a matching device-secret PDF exists in `secure/device-secrets/` or `secure/`, the script auto-discovers it by device ID.

The onboarding flow:

- adds the device to `config/fleet.json`
- creates `secure/device-configs/<device-name>/`
- imports `thingProperties.h` and `arduino_secrets.h` from the export zip when available
- auto-discovers and extracts `SECRET_DEVICE_KEY` from a matching Arduino Device Secret Key PDF when available
- fills Wi-Fi credentials from `DEFAULT_WIFI_SSID` and `DEFAULT_WIFI_PASS` when available
- tries to infer Thing ID and FQBN from Arduino Cloud

If you want the manual two-step flow instead:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\add-managed-device.ps1 -Class worker -DeviceId <device-id> -ExportZip .\private\<export-name>.zip
powershell -ExecutionPolicy Bypass -File .\scripts\deploy-class.ps1 -Class worker -DeviceNames <device-name>
```

## Cloudspace Web Page

Open this in a browser:

```text
http://localhost:3000/cloudspace
```

The page includes:

- Total visible device count
- Online device count
- Filtered row count
- Search by device name or ID
- Toggle between all devices and online-only devices

This page loads its data from:

```text
/cloudspace/names
```

## Device Fields Returned by the Server

The full device payload is summarized to these fields:

- `id`
- `name`
- `status`
- `lastActivityAt`
- `organizationId`
- `fqbn`
- `serial`
- `thingName`

## Sketch Source Of Truth

The preferred model in this project is:

- Arduino Cloud templates and exported sketches are used for provisioning and per-device bindings
- local files in `sketches/` are the source of truth for ongoing code changes
- OTA deployment uses compiled binaries, so the Arduino Cloud editor copy of a sketch can become outdated after local releases

That drift is expected with the current workflow. The recommended practice is to treat the Cloud sketch as a provisioning artifact, not the canonical source for later edits.

## Typical Workflow

1. Open a terminal in the project folder.
2. Run `npm start`.
3. Open `http://localhost:3000/cloudspace` if you want the browser view.
4. Open `http://localhost:3000/admin` if you want the managed fleet view.
5. Run `scripts/deploy-class.ps1` when you want to OTA-deploy a class sketch.

## Voice Input

For speech-to-text on Windows, use the built-in voice typing shortcut:

```text
Win+H
```

If it starts in the wrong language, switch the active input language with `Win+Space` before dictating.

## Troubleshooting

### Port 3000 already in use

If startup fails with `EADDRINUSE`, another process is already using the configured port. Stop the old process or change `PORT` in `secure/local.env`.

### Arduino API request fails

Check:

- Client ID and secret values
- Organization ID for cloudspace requests
- Internet connectivity
- Whether the Arduino Cloud credentials are still valid

### `/cloudspace` shows an error

The HTML page depends on `/cloudspace/names`. If the API request fails, the page will show the error returned by the server.

## Security Notes

- Keep `secure/local.env` out of source control.
- Treat client secrets as sensitive.
- Rotate credentials if they have been shared or embedded in code by mistake.

## Stop the Server

In the terminal running the server, press:

```text
Ctrl+C
```
