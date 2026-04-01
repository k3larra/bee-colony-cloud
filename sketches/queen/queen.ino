#include "arduino_secrets.h"

/*
  Queen node.

  Cloud variables expected on the Thing:
  - desired_mode (READ_WRITE)
  - firmware_version (READ)
  - queen_health (READ)
  - min_store_threshold (READ_WRITE)
  - target_worker_effort (READ_WRITE)

  Local LAN endpoint:
  - GET /policy for the hive node
*/

const char FIRMWARE_VERSION[] = "0.1.0";

constexpr unsigned long LOOP_DELAY_MS = 20;
constexpr char MDNS_HOSTNAME[] = "queen1";

#include <WebServer.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include "thingProperties.h"

WebServer server(80);

void ensureMdnsReady();
void configureServer();
void handlePolicy();
void handleNotFound();
String normalizeMode(const String& value);

void setup() {
  Serial.begin(115200);
  delay(250);

  initProperties();
  firmware_version = FIRMWARE_VERSION;

  if (desired_mode.isEmpty()) {
    desired_mode = "stable";
  }
  if (min_store_threshold <= 0) {
    min_store_threshold = 180;
  }
  if (target_worker_effort <= 0) {
    target_worker_effort = 50;
  }

  queen_health = "online";

  WiFi.setHostname(MDNS_HOSTNAME);
  ArduinoCloud.begin(ArduinoIoTPreferredConnection);
  setDebugMessageLevel(2);
  ArduinoCloud.printDebugInfo();

  configureServer();
  Serial.println("Queen node ready.");
}

void loop() {
  ArduinoCloud.update();
  ensureMdnsReady();
  server.handleClient();

  queen_health = WiFi.status() == WL_CONNECTED ? "online" : "offline";
  desired_mode = normalizeMode(desired_mode);

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
  server.on("/policy", HTTP_GET, handlePolicy);
  server.onNotFound(handleNotFound);
}

void handlePolicy() {
  String payload;
  payload.reserve(128);
  payload += "desired_mode=";
  payload += desired_mode;
  payload += "\nmin_store_threshold=";
  payload += min_store_threshold;
  payload += "\ntarget_worker_effort=";
  payload += target_worker_effort;
  payload += "\nfirmware_version=";
  payload += firmware_version;

  server.send(200, "text/plain", payload);
}

void handleNotFound() {
  server.send(404, "text/plain", "Not found");
}

String normalizeMode(const String& value) {
  if (value == "conserve" || value == "stable" || value == "expand") {
    return value;
  }
  return "stable";
}

void onDesiredModeChange() {
  desired_mode = normalizeMode(desired_mode);
  Serial.print("Desired mode: ");
  Serial.println(desired_mode);
}

void onMinStoreThresholdChange() {
  if (min_store_threshold < 20) {
    min_store_threshold = 20;
  }
  Serial.print("Min store threshold: ");
  Serial.println(min_store_threshold);
}

void onTargetWorkerEffortChange() {
  target_worker_effort = constrain(target_worker_effort, 0, 100);
  Serial.print("Target worker effort: ");
  Serial.println(target_worker_effort);
}
