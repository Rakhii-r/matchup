/*
 * SIXFOUR 24 court lights: ESP32 starter firmware.
 *
 * Connects one court's ESP32 to its ThingsBoard Cloud device over MQTT and
 * blinks the lights when the app scores a FOUR, SIX or WICKET (or staff press
 * "Test blink"). Contract: docs/PHASE2_LIGHTS_DESIGN.md, "Hardware hand-off".
 *
 * ThingsBoard sends (topic v1/devices/me/rpc/request/<id>):
 *   {"method":"blink","params":{"event":"SIX","event_id":"…","expires_at":1795066132}}
 *
 * Arduino IDE: board "ESP32 Dev Module". Libraries (Library Manager):
 *   PubSubClient (Nick O'Leary), ArduinoJson (Benoit Blanchon, v7).
 *
 * Fill in the four CONFIG values below. Never commit a real token.
 */
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <time.h>

// ------------------------------------------------------------------ CONFIG --
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
// ThingsBoard → Devices → (this court's device) → Manage credentials → access token.
// Must be the SAME token that is linked in the app (Court Lights → Court N).
const char* TB_TOKEN      = "PASTE_DEVICE_ACCESS_TOKEN";
// GPIO driving the relay / MOSFET / laser driver input. 2 = on-board LED, for bench tests.
const int   LIGHT_PIN     = 2;
const bool  ACTIVE_HIGH   = true;   // false if the relay board switches on LOW
// ---------------------------------------------------------------------------

const char* TB_HOST = "mqtt.thingsboard.cloud";
const int   TB_PORT = 1883;

// Safety caps live HERE, not in the cloud (laser eye safety).
const unsigned long FLASH_ON_MS      = 250;   // longest a single flash stays on
const unsigned long FLASH_OFF_MS     = 250;
const int           MAX_EVENTS_PER_MIN = 6;

WiFiClient   net;
PubSubClient mqtt(net);

// Recent event_ids, so a redelivered command never blinks twice.
String recentIds[8];
int    recentPos = 0;
unsigned long eventTimes[MAX_EVENTS_PER_MIN];
int    eventPos = 0;

void lightsOff() { digitalWrite(LIGHT_PIN, ACTIVE_HIGH ? LOW : HIGH); }
void lightsOn()  { digitalWrite(LIGHT_PIN, ACTIVE_HIGH ? HIGH : LOW); }

bool clockIsSet() { return time(nullptr) > 1700000000; }  // NTP has synced

bool seenBefore(const String& id) {
  for (const String& s : recentIds) if (s == id) return true;
  recentIds[recentPos] = id;
  recentPos = (recentPos + 1) % 8;
  return false;
}

bool overRateLimit() {
  unsigned long now = millis();
  unsigned long oldest = eventTimes[eventPos];
  if (oldest != 0 && now - oldest < 60000UL) return true;
  eventTimes[eventPos] = now;
  eventPos = (eventPos + 1) % MAX_EVENTS_PER_MIN;
  return false;
}

void flash(int times, unsigned long onMs) {
  onMs = min(onMs, FLASH_ON_MS * 4);           // hard cap even for the long TEST flash
  for (int i = 0; i < times; i++) {
    lightsOn();  delay(onMs);
    lightsOff(); delay(FLASH_OFF_MS);
    mqtt.loop();                                // keep the connection alive
  }
}

void runPattern(const String& event) {
  if      (event == "SIX")    flash(6, FLASH_ON_MS);
  else if (event == "FOUR")   flash(4, FLASH_ON_MS);
  else if (event == "WICKET") flash(3, FLASH_ON_MS * 2);
  else if (event == "TEST")   flash(1, FLASH_ON_MS * 4);
}

void onMessage(char* topic, byte* payload, unsigned int length) {
  String t(topic);
  const String prefix = "v1/devices/me/rpc/request/";
  if (!t.startsWith(prefix)) return;
  String requestId = t.substring(prefix.length());

  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) { Serial.println("RPC: bad JSON"); return; }

  const char* method = doc["method"] | "";
  String event   = doc["params"]["event"] | "";
  String eventId = doc["params"]["event_id"] | "";
  long   expires = doc["params"]["expires_at"] | 0L;
  Serial.printf("RPC %s: method=%s event=%s\n", requestId.c_str(), method, event.c_str());

  const char* result = "ok";
  if (strcmp(method, "blink") != 0)                         result = "unknown_method";
  else if (!clockIsSet())                                   result = "clock_not_set";  // stay dark
  else if (expires > 0 && time(nullptr) > expires)          result = "expired";
  else if (eventId.length() && seenBefore(eventId))         result = "duplicate";
  else if (overRateLimit())                                 result = "rate_limited";
  else                                                      runPattern(event);

  // Reply so the ThingsBoard rule node records success instead of a timeout.
  String reply = String("{\"result\":\"") + result + "\"}";
  mqtt.publish(("v1/devices/me/rpc/response/" + requestId).c_str(), reply.c_str());
  Serial.printf("  -> %s\n", result);
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  lightsOff();
  Serial.printf("WiFi: connecting to %s", WIFI_SSID);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print("."); }
  Serial.printf("\nWiFi: connected, IP %s\n", WiFi.localIP().toString().c_str());
}

void connectMqtt() {
  while (!mqtt.connected()) {
    lightsOff();                                 // fail dark while offline
    Serial.print("MQTT: connecting to ThingsBoard... ");
    String clientId = "sixfour24-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    // ThingsBoard access-token auth: token as USERNAME, no password.
    if (mqtt.connect(clientId.c_str(), TB_TOKEN, nullptr)) {
      Serial.println("connected");
      mqtt.subscribe("v1/devices/me/rpc/request/+");
    } else {
      // rc 5 = not authorised: wrong token.
      Serial.printf("failed, rc=%d, retrying in 5 s\n", mqtt.state());
      delay(5000);
    }
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LIGHT_PIN, OUTPUT);
  lightsOff();

  connectWifi();
  configTime(19800, 0, "pool.ntp.org", "time.google.com");  // IST; needed for expires_at

  mqtt.setServer(TB_HOST, TB_PORT);
  mqtt.setBufferSize(512);
  mqtt.setCallback(onMessage);
}

void loop() {
  connectWifi();
  connectMqtt();
  mqtt.loop();
}
