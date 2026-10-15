# Privacy Policy for SIXFOUR 24

**Effective Date:** September 15, 2026  
**Last Updated:** September 15, 2026

SIXFOUR 24 ("we", "our", or "us") is dedicated to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, and safeguard your personal information when you use our mobile application SIXFOUR 24 (the "App") and related services.

By installing, registering, or using SIXFOUR 24, you consent to the data practices described in this policy.

---

## 1. Information We Collect

### A. Personal Information You Provide
- **Phone Number:** Used for passwordless One-Time Password (OTP) authentication and account verification.
- **Profile Information:** Your full name, chosen display name, geographic area/locality, primary sport preferences (e.g., Box Cricket, Badminton), and skill levels.
- **Photos & Media:** If you choose to upload a profile avatar or squad logo, we access your device's photo library with your explicit permission. We do not access your photo library without your direct action.
- **User-Generated Content:** Squad details, team rosters, match scores, match invitations, captain chat messages, and venue reviews/ratings.

### B. Information Collected Automatically
- **Approximate & Precise Location (Foreground Only):** With your explicit permission, we collect your device's GPS coordinates while the app is in foreground use to discover nearby matches, calculate distances to box-cricket venues, and display opponent teams on the radar. We do NOT track or collect background location when the app is closed.
- **Push Notification Tokens:** We collect Expo/Firebase Cloud Messaging (FCM) device tokens to send you essential match notifications (e.g., challenge alerts, lineup confirmations, toss updates, score reminders).
- **Device & Usage Diagnostics:** Device model, operating system version, crash reports (via Sentry), and anonymised interaction analytics (via PostHog) to monitor application stability, troubleshoot crashes, and optimize performance.

---

## 2. How We Use Your Information

We use the collected information for the following specific purposes:
- **Authentication & Security:** Verifying your identity via SMS OTP and securing your account.
- **Matchmaking & Gameplay:** Facilitating squad creation, radar matchmaking within a geographic radius, captain challenges, lineups, coin toss, and live ball-by-ball scoring.
- **Venue Discovery & Booking:** Displaying nearby sports turfs, operating hours, court slot availability, and managing slot reservations.
- **Notifications & Communication:** Alerting you to incoming squad challenges, match confirmations, and captain coordination messages.
- **Service Improvement & Debugging:** Identifying crashes, diagnosing performance issues, and enhancing user experience.

---

## 3. Data Storage, Security & Retention

- **Backend Infrastructure:** All user profile data, squad records, fixtures, and scorecards are stored in secure cloud databases hosted by Supabase with Row Level Security (RLS) policies and HTTPS/TLS encryption in transit and AES-256 encryption at rest.
- **Data Retention:** We retain your account data for as long as your account is active. If you delete your account or request deletion, your personal identifiable information (PII) is permanently purged from our primary database within 30 days.

---

## 4. Permissions Used by the App

| Permission | Android Name | Purpose |
| :--- | :--- | :--- |
| **Location** | `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | Required to find nearby turfs, calculate radar distance to opponent squads, and filter local matches. Disclosed prominently in-app before the system prompt. |
| **Notifications** | `POST_NOTIFICATIONS` (Android 13+) | Required to deliver real-time challenge invites, toss notifications, and match reminders. |
| **Photos / Media** | `READ_MEDIA_IMAGES` / Photo Picker | Allows selecting profile avatars or team logos from your photo gallery. |
| **Network Access** | `INTERNET` | Required to connect to backend APIs, sync live scores, and fetch venue availability. |

> **Note:** SIXFOUR 24 does NOT request or use `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW`, `CAMERA`, or background location permissions.

---

## 5. Third-Party Services & Processors

We work with trusted third-party service providers who assist in operating our platform:
- **Supabase:** Cloud database, user authentication, and storage provider.
- **Expo / Firebase (Google LLC):** Push notification routing and mobile build infrastructure.
- **Sentry:** Crash reporting and error diagnostics.
- **PostHog:** Anonymised product analytics for feature usage optimization.

We do NOT sell, rent, or monetize your personal data or location to third-party data brokers or advertisers.

---

## 6. User Rights & Account Deletion

You have full control over your personal data:
- **Access & Edit:** You can view and update your profile details directly from the Profile tab in the App.
- **Account Deletion:** You can request account deletion at any time within the App under `Profile -> Settings -> Delete Account`, or by emailing our Data Protection Officer at `support@matchup.local` (or your support contact email). Upon confirmation, all personal identifiers, phone records, and active memberships will be permanently deleted.

---

## 7. Children's Privacy

SIXFOUR 24 is intended for general audiences aged 13 and above. We do not knowingly collect personal information from children under the age of 13. If we become aware that personal data from a child under 13 has been collected, we will take immediate steps to delete that information.

---

## 8. Changes to This Privacy Policy

We may update our Privacy Policy periodically to reflect changes in our practices or regulatory requirements. Any updates will be posted within the App and at the public policy URL with a revised "Last Updated" date.

---

## 9. Contact Us

If you have questions, concerns, or requests regarding this Privacy Policy or your personal information, please contact:

**SIXFOUR 24 Privacy & Data Protection**  
Email: `support@matchup.local` (or `privacy@asrdigi.com`)  
Address: Hyderabad, Telangana, India
