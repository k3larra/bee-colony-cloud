#include "arduino_secrets.h"

/*
  Hive node.

  Cloud variables expected on the Thing:
  - colony_state (READ)
  - firmware_version (READ)
  - queen_mode (READ)
  - alive_workers (READ)
  - consumption_load (READ)
  - incoming_light (READ)
  - stored_light (READ)

  Local LAN endpoints:
  - GET /report from workers
  - GET /colony for local observers
*/

const char FIRMWARE_VERSION[] = "0.1.1";

constexpr unsigned long LOOP_DELAY_MS = 20;
constexpr unsigned long REPORT_TIMEOUT_MS = 45000;
constexpr unsigned long COLONY_TICK_MS = 2000;
constexpr unsigned long QUEEN_POLL_INTERVAL_MS = 5000;
constexpr unsigned long QUEEN_POLL_RETRY_INTERVAL_MS = 2000;
constexpr unsigned long HOST_RESOLVE_INTERVAL_MS = 30000;
constexpr int MAX_WORKERS = 8;
constexpr int STORED_LIGHT_MAX = 1000;
constexpr int DEFAULT_MIN_STORE_THRESHOLD = 180;
constexpr char MDNS_HOSTNAME[] = "robbi";
constexpr char QUEEN_HOSTNAME[] = "queen1.local";

#include <HTTPClient.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include "thingProperties.h"

struct WorkerReport {
  String id;
  String state;
  int harvestOffer;
  int energyUse;
  int ldrValue;
  bool alive;
  unsigned long lastSeen;
};

WorkerReport workerReports[MAX_WORKERS];
WebServer server(80);
unsigned long lastColonyTick = 0;
unsigned long lastQueenPoll = 0;
unsigned long lastQueenResolveTime = 0;
IPAddress cachedQueenIp;
bool queenIpValid = false;
int minStoreThreshold = DEFAULT_MIN_STORE_THRESHOLD;
int targetWorkerEffort = 50;

void ensureMdnsReady();
void configureServer();
void handleWorkerReport();
void handleColonySnapshot();
void handleNotFound();
WorkerReport* findWorkerSlot(const String& workerId);
void refreshColonyState(unsigned long currentMillis);
void pollQueenPolicy(unsigned long currentMillis);
void applyLine(const String& line);
String buildColonySnapshot();
bool resolveQueenIp(unsigned long currentMillis, bool forceRefresh);
bool fetchQueenPolicy();

void setup() {
  Serial.begin(115200);
  delay(250);

  initProperties();
  firmware_version = FIRMWARE_VERSION;
  colony_state = "booting";
  queen_mode = "unknown";
  alive_workers = 0;
  consumption_load = 0;
  incoming_light = 0;
  stored_light = 250;

  WiFi.setHostname(MDNS_HOSTNAME);
  ArduinoCloud.begin(ArduinoIoTPreferredConnection);
  setDebugMessageLevel(2);
  ArduinoCloud.printDebugInfo();

  configureServer();
  Serial.println("Hive node ready.");
}

void loop() {
  ArduinoCloud.update();
  const unsigned long currentMillis = millis();

  ensureMdnsReady();
  server.handleClient();
  pollQueenPolicy(currentMillis);
  refreshColonyState(currentMillis);

  delay(LOOP_DELAY_MS);
}

void ensureMdnsReady() {
  static bool mdnsStarted = false;
  static bool serverStarted = false;

  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (!mdnsStarted) {
    mdnsStarted = MDNS.begin(MDNS_HOSTNAME);
    if (mdnsStarted) {
      MDNS.addService("http", "tcp", 80);
    }
  }

  if (!serverStarted) {
    server.begin();
    serverStarted = true;
  }
}

void configureServer() {
  server.on("/report", HTTP_GET, handleWorkerReport);
  server.on("/colony", HTTP_GET, handleColonySnapshot);
  server.onNotFound(handleNotFound);
}

void handleWorkerReport() {
  const String workerId = server.arg("worker_id");
  if (workerId.isEmpty()) {
    server.send(400, "text/plain", "Missing worker_id");
    return;
  }

  WorkerReport* worker = findWorkerSlot(workerId);
  if (!worker) {
    server.send(507, "text/plain", "Worker slots full");
    return;
  }

  worker->id = workerId;
  worker->harvestOffer = server.arg("harvest_offer").toInt();
  worker->energyUse = server.arg("energy_use").toInt();
  worker->ldrValue = server.arg("ldr_value").toInt();
  worker->alive = server.arg("alive").toInt() > 0;
  worker->state = server.arg("worker_state");
  worker->lastSeen = millis();

  server.send(200, "text/plain", buildColonySnapshot());
}

void handleColonySnapshot() {
  server.send(200, "text/plain", buildColonySnapshot());
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

WorkerReport* findWorkerSlot(const String& workerId) {
  WorkerReport* emptySlot = nullptr;

  for (int index = 0; index < MAX_WORKERS; ++index) {
    if (workerReports[index].id == workerId) {
      return &workerReports[index];
    }
    if (!emptySlot && workerReports[index].id.isEmpty()) {
      emptySlot = &workerReports[index];
    }
  }

  return emptySlot;
}

void refreshColonyState(unsigned long currentMillis) {
  if (currentMillis - lastColonyTick < COLONY_TICK_MS) {
    return;
  }

  lastColonyTick = currentMillis;

  int incoming = 0;
  int consumption = 0;
  int aliveCount = 0;

  for (int index = 0; index < MAX_WORKERS; ++index) {
    const WorkerReport& worker = workerReports[index];
    if (worker.id.isEmpty()) {
      continue;
    }
    if (currentMillis - worker.lastSeen > REPORT_TIMEOUT_MS) {
      continue;
    }
    aliveCount += 1;
    incoming += max(worker.harvestOffer, 0);
    consumption += max(worker.energyUse, 0);
  }

  alive_workers = aliveCount;
  incoming_light = incoming;
  consumption_load = consumption;

  const int delta = (incoming_light - consumption_load) / 5;
  stored_light = constrain(stored_light + delta, 0, STORED_LIGHT_MAX);

  if (stored_light <= minStoreThreshold / 2) {
    colony_state = "critical";
  } else if (stored_light < minStoreThreshold) {
    colony_state = "stressed";
  } else {
    colony_state = "healthy";
  }
}

void pollQueenPolicy(unsigned long currentMillis) {
  if (WiFi.status() != WL_CONNECTED) {
    queenIpValid = false;
    return;
  }

  const unsigned long interval = queenIpValid ? QUEEN_POLL_INTERVAL_MS : QUEEN_POLL_RETRY_INTERVAL_MS;
  if (currentMillis - lastQueenPoll < interval) {
    return;
  }

  if (!resolveQueenIp(currentMillis, false)) {
    lastQueenPoll = currentMillis;
    Serial.println("Queen resolution failed.");
    return;
  }

  bool fetched = fetchQueenPolicy();
  if (!fetched && resolveQueenIp(currentMillis, true)) {
    fetched = fetchQueenPolicy();
  }

  if (!fetched) {
    queenIpValid = false;
  }

  lastQueenPoll = currentMillis;
}

bool resolveQueenIp(unsigned long currentMillis, bool forceRefresh) {
  if (!forceRefresh && queenIpValid && currentMillis - lastQueenResolveTime < HOST_RESOLVE_INTERVAL_MS) {
    return true;
  }

  IPAddress resolvedIp;
  if (!WiFi.hostByName(QUEEN_HOSTNAME, resolvedIp)) {
    lastQueenResolveTime = currentMillis;
    return false;
  }

  cachedQueenIp = resolvedIp;
  queenIpValid = true;
  lastQueenResolveTime = currentMillis;
  return true;
}

bool fetchQueenPolicy() {
  HTTPClient http;
  const String url = String("http://") + cachedQueenIp.toString() + "/policy";
  http.begin(url);
  http.setTimeout(2000);
  const int status = http.GET();
  if (status > 0 && status < 400) {
    const String payload = http.getString();
    int start = 0;
    while (start < payload.length()) {
      int lineEnd = payload.indexOf('\n', start);
      if (lineEnd < 0) {
        lineEnd = payload.length();
      }
      applyLine(payload.substring(start, lineEnd));
      start = lineEnd + 1;
    }
    http.end();
    return true;
  }
  http.end();
  return false;
}

void applyLine(const String& line) {
  const int separator = line.indexOf('=');
  if (separator < 0) {
    return;
  }

  const String key = line.substring(0, separator);
  const String value = line.substring(separator + 1);

  if (key == "desired_mode") {
    queen_mode = value;
  } else if (key == "min_store_threshold") {
    minStoreThreshold = value.toInt();
  } else if (key == "target_worker_effort") {
    targetWorkerEffort = value.toInt();
  }
}

String buildColonySnapshot() {
  String payload;
  payload.reserve(128);
  payload += "colony_state=";
  payload += colony_state;
  payload += "\nqueen_mode=";
  payload += queen_mode;
  payload += "\nstored_light=";
  payload += stored_light;
  payload += "\nalive_workers=";
  payload += alive_workers;
  payload += "\ntarget_worker_effort=";
  payload += targetWorkerEffort;
  return payload;
}
