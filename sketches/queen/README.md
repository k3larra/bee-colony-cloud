# Queen Sketch

This folder contains the shared queen role firmware.

The queen acts as the slow policy source for the colony:

- `desired_mode`
- `min_store_threshold`
- `target_worker_effort`

These are set through Arduino Cloud and exposed to the hive over the local LAN.
