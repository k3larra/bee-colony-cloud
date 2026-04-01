# Hive Sketch

This folder contains the shared hive role firmware.

The hive is the colony ledger:

- receives worker reports over the local LAN
- polls the queen for policy
- computes `stored_light`, `incoming_light`, `consumption_load`, `alive_workers`, and `colony_state`
- exposes the resulting colony state through Arduino Cloud
