# Google Play Data Safety Declaration Sheet

This document maps every permission, SDK, and Supabase database table in **SIXFOUR 24** directly to the Google Play Console **Data Safety** questionnaire.

---

## 1. Overview Summary

| Question | Answer |
| :--- | :--- |
| **Does your app collect or share any of the required user data types?** | **Yes** |
| **Is all user data collected encrypted in transit?** | **Yes** (All network communication uses HTTPS / TLS 1.3 encryption) |
| **Do you provide a way for users to request that their data be deleted?** | **Yes** (Via in-app Profile Settings and direct support email) |

---

## 2. Detailed Data Types Declaration

### A. Location
1. **Approximate Location** (`ACCESS_COARSE_LOCATION`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No
   - **Processed ephemerally:** No (stored with match fixtures & venue pins)
   - **Required or Optional:** Optional (user can deny permission and manually select area)
   - **Purposes:** App functionality (Matchmaking radar, venue distance calculation)

2. **Precise Location** (`ACCESS_FINE_LOCATION`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No
   - **Processed ephemerally:** No
   - **Required or Optional:** Optional
   - **Purposes:** App functionality (Locating nearest turf grounds and opponent teams within search radius)

---

### B. Personal Info
1. **Name** (`profiles.full_name`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No (Visible to other signed-in users on rosters/scorecards)
   - **Required or Optional:** Required
   - **Purposes:** App functionality, Account management

2. **Phone Number** (`auth.users.phone`, `profiles.phone`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No
   - **Required or Optional:** Required (Used for OTP sign-in authentication)
   - **Purposes:** Account management, Authentication, Fraud prevention & safety

---

### C. Photos and Videos
1. **Photos** (`profiles.avatar_url`, `teams.logo_url`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No
   - **Required or Optional:** Optional (user selects avatar / squad logo from photo picker)
   - **Purposes:** App functionality, Account customization

---

### D. Messages
1. **In-app Chat Messages** (`captain_chat_messages.content`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** No
   - **Required or Optional:** Optional
   - **Purposes:** App functionality (Captain coordination for fixtures)

---

### E. App Info and Performance
1. **Crash Logs** (via `@sentry/react-native`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** Yes (Shared with Sentry diagnostics processor)
   - **Processed ephemerally:** No
   - **Required or Optional:** Required
   - **Purposes:** Analytics, Diagnostics, Bug fixing

2. **Diagnostics & Performance Data**
   - **Collected:** Yes
   - **Shared with 3rd parties:** Yes (Sentry / PostHog)
   - **Purposes:** App performance monitoring

---

### F. Device or Other Identifiers
1. **Device / Push Tokens** (`devices.fcm_token`)
   - **Collected:** Yes
   - **Shared with 3rd parties:** Yes (Routed through Expo/Firebase Cloud Messaging)
   - **Purposes:** App functionality (Delivering match invites, toss alerts, score updates)

---

## 3. Database Table to Play Category Mapping Reference

| Supabase Table | Data Fields | Play Console Category | Purpose |
| :--- | :--- | :--- | :--- |
| `auth.users` | `phone`, `id` | Personal Info -> Phone number, User IDs | Authentication |
| `profiles` | `full_name`, `area_name`, `avatar_url` | Personal Info -> Name; Photos -> Photos | Profile Display |
| `venues` / `matches` | `lat`, `lng`, `location` | Location -> Approximate & Precise | Finding nearby grounds |
| `devices` | `fcm_token`, `platform` | Device IDs -> Device or other IDs | Push Notifications |
| `captain_chat_messages` | `content`, `sender_id` | Messages -> Other in-app messages | Fixture coordination |
| `team_members` / `match_players` | `role`, `status` | App Activity -> In-app actions | Gameplay & rosters |
| `innings` / `deliveries` | `runs`, `wickets`, `balls` | App Activity -> In-app actions | Live scoring & scorecards |

---

## 4. Privacy & Security Practices Checklist in Play Console

- [x] **Data encrypted in transit:** Check YES.
- [x] **Data deletion mechanism provided:** Check YES.
- [x] **Privacy policy URL provided:** Provide your hosted Privacy Policy URL.
- [x] **No advertising / tracking IDs collected:** Check NO for Advertising IDs.
- [x] **Target Audience:** 13+ (Not designed primarily for children under 13).
