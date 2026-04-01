# Worker Sketch

This folder contains the shared worker role firmware.

## Cloud Variables

- `firmware_version`: current worker firmware
- `worker_state`: local state label such as `idle`, `searching`, or `foraging`
- `energy_use`: local energy cost derived from servo effort
- `harvest_offer`: local harvest potential derived from `ldr_value`
- `ldr_value`: light sensor reading
- `servo_speed`: writable base effort level
- `alive`: worker connectivity status

## Network Role

Workers do not use Arduino Cloud as a transport to other Things. Instead, each worker reports its local state to the hive over the local LAN using `http://robbi.local/report`.
