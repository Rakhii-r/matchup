# Court lights: ESP32 → ThingsBoard hand-off

Send this file and `esp32_court_lights.ino` to the hardware person.

## What the ESP32 must do
1. Join the venue Wi-Fi.
2. Connect over MQTT to ThingsBoard Cloud:
   - Host: `mqtt.thingsboard.cloud`, port `1883`
   - Username: the **access token** of device "AMY box court" (ThingsBoard → Entities → Devices → AMY box court → Manage credentials). Leave the password empty. Any client ID works.
3. Subscribe to `v1/devices/me/rpc/request/+`
4. When a message arrives, blink the lights:
   ```json
   { "method": "blink", "params": { "event": "SIX", "event_id": "uuid", "expires_at": 1795066132 } }
   ```
   - `event` is one of `FOUR`, `SIX`, `WICKET` or `TEST`.
   - `expires_at` is a Unix time in seconds. If the command arrives after this time, **ignore it**, so a late command never blinks.
   - `event_id` is unique. If the same ID arrives twice, blink only once.
5. Reply on `v1/devices/me/rpc/response/<same id>` with `{"result":"ok"}`. This step is optional, but it makes ThingsBoard log success instead of a timeout.

The starter sketch already does all five steps. It also turns the lights off while offline, caps flash length and limits blinks to 6 per minute. Change `LIGHT_PIN`, `ACTIVE_HIGH` and the flash patterns to suit the real relay or laser driver.

## Bench test (no lights needed)
1. Arduino IDE: install the libraries **PubSubClient** and **ArduinoJson**. Board: ESP32 Dev Module.
2. Fill in `WIFI_SSID`, `WIFI_PASSWORD` and `TB_TOKEN`. Keep `LIGHT_PIN = 2` so the on-board LED blinks.
3. Upload the sketch and open the Serial Monitor at 115200. You should see `MQTT: connecting to ThingsBoard... connected`.
   - `rc=5` means the token is wrong. Copy it again from Manage credentials.
4. In ThingsBoard, AMY box court should now show **Active**.
5. In the app, open Settings → Court Lights → Court 1 → **Test blink**. The Serial Monitor prints `RPC …: method=blink event=TEST -> ok` and the LED gives one long flash.

## Already done on the cloud side (no changes needed)
- The app sends events to the device as telemetry.
- The ThingsBoard root rule chain turns FOUR, SIX, WICKET and TEST events into the `blink` RPC above.
