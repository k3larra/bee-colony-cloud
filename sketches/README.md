# Sketch Layout

Keep the source sketches for each device class in this folder.

Recommended structure:

- `sketches/worker/`
- `sketches/drone/`
- `sketches/queen/`
- `sketches/hive/`

## Version Reporting

Each sketch should expose a Cloud property for the current firmware version so the admin page can compare the running version with the desired target version.

Recommended property names:

- `firmwareVersion`
- `firmware_version`

Recommended pattern in the sketch:

```cpp
const char FIRMWARE_VERSION[] = "0.1.0";
```

Then publish that value to a read-only Cloud variable during setup and when reconnecting.

Until that property exists, the admin page will show the reported version as `Not reported`.
