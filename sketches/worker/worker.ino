#include "arduino_secrets.h"

/*
  Worker node.

  Cloud variables expected on the Thing:
  - firmware_version (READ)
  - worker_state (READ)
  - energy_use (READ)
  - harvest_offer (READ)
  - ldr_value (READ, timed)
  - servo_speed (READ_WRITE)
  - alive (READ)

  Colony communication is local LAN traffic to the hive node.
*/

const char FIRMWARE_VERSION[] = "0.2.2";

constexpr uint8_t GREEN_LED_PIN = 2;
constexpr uint8_t RED_LED_PIN = 3;
constexpr uint8_t SERVO_PIN = 4;
constexpr uint8_t LDR_PIN = A0;
constexpr unsigned long LOOP_DELAY_MS = 20;
constexpr unsigned long STRESS_BLINK_INTERVAL_MS = 1000;
constexpr unsigned long REPORT_INTERVAL_MS = 4000;
constexpr unsigned long REPORT_RETRY_INTERVAL_MS = 1500;
constexpr unsigned long HOST_RESOLVE_INTERVAL_MS = 30000;
constexpr int SENSOR_MIN = 0;
constexpr int SENSOR_MAX = 4095;
constexpr int HARVEST_MAX = 100;
constexpr int ENERGY_MAX = 100;
constexpr int SERVO_MIN_ANGLE = 0;
constexpr int SERVO_MAX_ANGLE = 180;
constexpr int SERVO_MIN_SPEED = 0;
constexpr int SERVO_MAX_SPEED = 100;
constexpr unsigned long SERVO_FULL_SWEEP_MS = 10000UL;
constexpr char HIVE_HOSTNAME[] = "robbi.local";
constexpr char MDNS_HOSTNAME[] = "worker-node";

#include <ESP32Servo.h>
#include <HTTPClient.h>
#include <ESPmDNS.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include "thingProperties.h"

static unsigned long lastServoTime = 0;
static unsigned long lastReportTime = 0;
static unsigned long lastHiveResolveTime = 0;
static unsigned long lastStressBlinkTime = 0;
static IPAddress cachedHiveIp;
static bool hiveIpValid = false;
static bool stressBlinkOn = false;
int servoDirection = 1;
int appliedServoSpeed = 0;
String hiveColonyState = "unknown";
Servo myServo;

void ensureMdnsReady();
int clampServoSpeed(int value);
int readLightLevel();
int calculateHarvestOffer(int lightLevel);
int calculateEnergyUse(int speed);
String determineWorkerState(int lightLevel, int harvest, int speed);
void updateServo(unsigned long currentMillis, int speed);
void updateStatusLeds(unsigned long currentMillis, int speed);
void reportToHive(unsigned long currentMillis);
String urlEncode(const String& value);
bool resolveHiveIp(unsigned long currentMillis, bool forceRefresh);
bool sendHiveReport(const IPAddress& ipAddress, const String& query);
void applyHiveSnapshot(const String& payload);

void setup() {
  Serial.begin(115200);
  delay(250);

  initProperties();
  firmware_version = FIRMWARE_VERSION;
  worker_state = "booting";
  ldr_value = 0;
  harvest_offer = 0;
  energy_use = 0;
  alive = false;
  servo_speed = clampServoSpeed(servo_speed);

  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(GREEN_LED_PIN, LOW);

  analogReadResolution(12);
  myServo.attach(SERVO_PIN, 500, 2400);
  myServo.write(SERVO_MIN_ANGLE);

  WiFi.setHostname(MDNS_HOSTNAME);
  ArduinoCloud.begin(ArduinoIoTPreferredConnection);

  setDebugMessageLevel(2);
  ArduinoCloud.printDebugInfo();
  Serial.println("Worker node ready.");
}

void loop() {
  ArduinoCloud.update();
  const unsigned long currentMillis = millis();

  ldr_value = readLightLevel();
  harvest_offer = calculateHarvestOffer(ldr_value);
  appliedServoSpeed = clampServoSpeed(servo_speed);
  energy_use = calculateEnergyUse(appliedServoSpeed);
  worker_state = determineWorkerState(ldr_value, harvest_offer, appliedServoSpeed);
  alive = WiFi.status() == WL_CONNECTED;

  updateServo(currentMillis, appliedServoSpeed);
  updateStatusLeds(currentMillis, appliedServoSpeed);
  ensureMdnsReady();
  reportToHive(currentMillis);

  delay(LOOP_DELAY_MS);
}

void ensureMdnsReady() {
  static bool mdnsStarted = false;

  if (mdnsStarted || WiFi.status() != WL_CONNECTED) {
    return;
  }

  mdnsStarted = MDNS.begin(MDNS_HOSTNAME);
  if (mdnsStarted) {
    MDNS.addService("http", "tcp", 80);
  }
}

int clampServoSpeed(int value) {
  return constrain(value, SERVO_MIN_SPEED, SERVO_MAX_SPEED);
}

int readLightLevel() {
  return constrain(analogRead(LDR_PIN), SENSOR_MIN, SENSOR_MAX);
}

int calculateHarvestOffer(int lightLevel) {
  return map(lightLevel, SENSOR_MIN, SENSOR_MAX, 0, HARVEST_MAX);
}

int calculateEnergyUse(int speed) {
  if (speed <= 0) {
    return 0;
  }

  return map(speed, SERVO_MIN_SPEED, SERVO_MAX_SPEED, 0, ENERGY_MAX);
}

String determineWorkerState(int lightLevel, int harvest, int speed) {
  if (WiFi.status() != WL_CONNECTED) {
    return "offline";
  }
  if (speed <= 0) {
    return "idle";
  }
  if (harvest < 15 || lightLevel < 600) {
    return "searching";
  }
  return "foraging";
}

void updateServo(unsigned long currentMillis, int speed) {
  if (speed <= 0) {
    myServo.write(SERVO_MIN_ANGLE);
    servoDirection = 1;
    return;
  }

  const unsigned long interval = SERVO_FULL_SWEEP_MS / (static_cast<unsigned long>(speed) * 2UL);
  if (currentMillis - lastServoTime < interval) {
    return;
  }

  lastServoTime = currentMillis;
  if (servoDirection > 0) {
    myServo.write(SERVO_MAX_ANGLE);
    servoDirection = -1;
  } else {
    myServo.write(SERVO_MIN_ANGLE);
    servoDirection = 1;
  }
}

void updateStatusLeds(unsigned long currentMillis, int speed) {
  const bool stressActive = hiveColonyState == "stressed" || hiveColonyState == "critical";

  if (speed > 0) {
    digitalWrite(GREEN_LED_PIN, HIGH);
  } else {
    digitalWrite(GREEN_LED_PIN, LOW);
  }

  if (!stressActive) {
    stressBlinkOn = false;
    digitalWrite(RED_LED_PIN, LOW);
    return;
  }

  if (currentMillis - lastStressBlinkTime >= STRESS_BLINK_INTERVAL_MS) {
    lastStressBlinkTime = currentMillis;
    stressBlinkOn = !stressBlinkOn;
  }

  digitalWrite(RED_LED_PIN, stressBlinkOn ? HIGH : LOW);
}

void reportToHive(unsigned long currentMillis) {
  if (WiFi.status() != WL_CONNECTED) {
    hiveIpValid = false;
    return;
  }

  const unsigned long interval = hiveIpValid ? REPORT_INTERVAL_MS : REPORT_RETRY_INTERVAL_MS;
  if (currentMillis - lastReportTime < interval) {
    return;
  }

  if (!resolveHiveIp(currentMillis, false)) {
    lastReportTime = currentMillis;
    Serial.println("Hive resolution failed.");
    return;
  }

  const String query =
    String("/report?worker_id=") + urlEncode(DEVICE_LOGIN_NAME) +
    "&harvest_offer=" + String(harvest_offer) +
    "&energy_use=" + String(energy_use) +
    "&alive=" + String(alive ? 1 : 0) +
    "&ldr_value=" + String(ldr_value) +
    "&worker_state=" + urlEncode(worker_state) +
    "&firmware_version=" + urlEncode(firmware_version);

  bool delivered = sendHiveReport(cachedHiveIp, query);
  if (!delivered && resolveHiveIp(currentMillis, true)) {
    delivered = sendHiveReport(cachedHiveIp, query);
  }

  if (!delivered) {
    hiveIpValid = false;
  }

  lastReportTime = currentMillis;
}

bool resolveHiveIp(unsigned long currentMillis, bool forceRefresh) {
  if (!forceRefresh && hiveIpValid && currentMillis - lastHiveResolveTime < HOST_RESOLVE_INTERVAL_MS) {
    return true;
  }

  IPAddress resolvedIp;
  if (!WiFi.hostByName(HIVE_HOSTNAME, resolvedIp)) {
    lastHiveResolveTime = currentMillis;
    return false;
  }

  cachedHiveIp = resolvedIp;
  hiveIpValid = true;
  lastHiveResolveTime = currentMillis;
  return true;
}

bool sendHiveReport(const IPAddress& ipAddress, const String& query) {
  HTTPClient http;
  const String url = String("http://") + ipAddress.toString() + query;
  http.setTimeout(2000);
  http.begin(url);
  const int status = http.GET();
  if (status > 0 && status < 400) {
    applyHiveSnapshot(http.getString());
  }
  http.end();

  Serial.print("Hive report status: ");
  Serial.println(status);
  return status > 0 && status < 400;
}

void applyHiveSnapshot(const String& payload) {
  int start = 0;
  while (start < payload.length()) {
    int lineEnd = payload.indexOf('\n', start);
    if (lineEnd < 0) {
      lineEnd = payload.length();
    }

    const String line = payload.substring(start, lineEnd);
    const int separator = line.indexOf('=');
    if (separator > 0) {
      const String key = line.substring(0, separator);
      const String value = line.substring(separator + 1);
      if (key == "colony_state") {
        hiveColonyState = value;
      }
    }

    start = lineEnd + 1;
  }
}

String urlEncode(const String& value) {
  String encoded;
  encoded.reserve(value.length() * 3);

  for (size_t index = 0; index < value.length(); ++index) {
    const char c = value.charAt(index);
    if (
      (c >= 'a' && c <= 'z') ||
      (c >= 'A' && c <= 'Z') ||
      (c >= '0' && c <= '9') ||
      c == '-' || c == '_' || c == '.' || c == '~'
    ) {
      encoded += c;
    } else if (c == ' ') {
      encoded += "%20";
    } else {
      char buffer[4];
      snprintf(buffer, sizeof(buffer), "%%%02X", static_cast<unsigned char>(c));
      encoded += buffer;
    }
  }

  return encoded;
}

void onServoSpeedChange() {
  servo_speed = clampServoSpeed(servo_speed);
  Serial.print("Servo speed changed to ");
  Serial.println(servo_speed);
}
