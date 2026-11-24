# Maestro E2E Testing Suite for SixFour24 (Matchup)

This directory contains automated End-to-End (E2E) UI test flows powered by [Maestro](https://maestro.mobile.dev/).

---

## 📁 Test Suite Structure

| File | Flow Tested |
| :--- | :--- |
| `config.yaml` | Master suite configuration (runs all flows sequentially) |
| `01_home_and_calendar.yaml` | Home dashboard, greeting, sports rails, and Calendar Modal |
| `02_matches_feed.yaml` | Matches tab, sport filter pills, and join/create buttons |
| `03_create_match.yaml` | Match creation wizard, sport selection, and form navigation |
| `04_live_radar.yaml` | 360° Live Radar scanner, radius filters (10km/25km/50km), and squad selector |
| `05_venues_directory.yaml` | Venues directory, search field, and booking confirmation |
| `06_profile_and_theme.yaml` | Player stats, career figures, Overview/Recent tabs, and Appearance toggle |

---

## 🚀 Quick Start Guide

### 1. Install Maestro CLI

#### On macOS / Linux:
```bash
curl -FsSL "https://get.maestro.mobile.dev" | bash
```

#### On Windows:
You can run Maestro via PowerShell or WSL (Windows Subsystem for Linux):
```powershell
npm install -g maestro-cli
```

---

### 2. Start Your Android Emulator or iOS Simulator

- Ensure your device or emulator is running and connected (`adb devices` on Android, or `xcrun simctl list` on macOS).
- Launch your Expo app:
```bash
npx expo run:android
# or
npx expo run:ios
```

---

### 3. Run the E2E Tests

#### Run the entire test suite:
```bash
maestro test .maestro/config.yaml
```

#### Run an individual test flow:
```bash
# Test Home and Calendar Modal:
maestro test .maestro/01_home_and_calendar.yaml

# Test Live Radar:
maestro test .maestro/04_live_radar.yaml

# Test Profile & Dark/Light Theme:
maestro test .maestro/06_profile_and_theme.yaml
```

---

### 4. Running with Expo Go
If you are running tests inside **Expo Go** rather than a standalone development build, change `appId` at the top of each `.yaml` file to:
```yaml
appId: host.exp.exponent
```
