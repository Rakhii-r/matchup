# Play Store submission — SIXFOUR 24

Package `com.asrdigi.matchup` · version 1.0.0 · first production build:
EAS `production` profile (signed `.aab`, versionCode 2).

Legal pages (live): https://sixfour24.netlify.app/
- Privacy policy: https://sixfour24.netlify.app/privacy-policy.html
- Account deletion: https://sixfour24.netlify.app/delete-account.html
- Contact: contact@sixfour24.com · +91 76708 01766

## 1. Create the app (Play Console → Create app)
- App name: **SIXFOUR 24** · Default language: English (India)
- App or game: **App** · Free
- Accept the declarations.

## 2. Upload the build
Testing → **Closed testing** (or Internal testing first) → Create release →
upload the `.aab` from EAS. The first upload must be manual; later ones can use
`eas submit`. Let Google manage the app signing key (Play App Signing).

> Personal developer account created after 13 Nov 2023: production access needs
> a **closed test with at least 12 testers opted in for 14 continuous days**.

## 3. App content (Policy → App content)

**Privacy policy:** https://sixfour24.netlify.app/privacy-policy.html

**App access:** "All or some functionality is restricted" → add instructions:
- Phone number: a Supabase **test phone number** (Auth → Phone → Test OTP),
  e.g. `+91 90000 00000` with code `123456`. Create it before submitting.
- Steps: open app → enter the number → enter the code → create a profile.

**Ads:** No ads.

**Content rating:** questionnaire → category *Utility / Productivity / Communication / Other*
→ answer **No** to violence, sexual content, gambling, drugs. User interaction:
**Yes, users can interact** (captain chat, match sheets). Shares location: **Yes**.

**Target audience:** 18 and over (matches the privacy policy).

**News app:** No. **Government app:** No. **Financial features:** None.
**Health:** No.

## 4. Data safety

Data collected: **Yes**. Shared with third parties: **No** (service providers
acting for us are not "sharing"). Encrypted in transit: **Yes**. Users can
request deletion: **Yes** → https://sixfour24.netlify.app/delete-account.html

| Data type | Collected | Optional? | Purpose |
|---|---|---|---|
| Location → **Approximate** and **Precise** | Yes | Optional | App functionality |
| Personal info → **Name** | Yes | Required | App functionality, Account management |
| Personal info → **Phone number** | Yes | Required | Account management |
| Personal info → **User IDs** | Yes | Required | Account management |
| Photos and videos → **Photos** | Yes | Optional | App functionality (profile photo / squad logo) |
| Messages → **Other in-app messages** | Yes | Optional | App functionality (captain chat) |
| App activity → **App interactions** | Yes | Required | Analytics, App functionality |
| App info and performance → **Crash logs**, **Diagnostics** | Yes | Required | Analytics |
| Device or other IDs | Yes | Required | App functionality (push notifications) |

Not collected: email, address, financial info, health, contacts, calendar,
audio, files, web history, installed apps.

## 5. Store listing
- Short description (80): *Find and organise box cricket & badminton games with players near you.*
- Full description: what it does — create or join matches, squads and
  challenges, server-side toss, live ball-by-ball scoring, venues and court
  slots, player stats.
- Graphics: app icon 512×512 PNG, feature graphic 1024×500, **at least 2 phone
  screenshots** (Home, Matches, Toss, Live score, Profile work well).
- Category: **Sports**. Contact email: contact@sixfour24.com.

## 6. Before pressing "Send for review"
- [ ] Account deletion tested end-to-end with a throwaway account.
- [ ] Reviewer test phone + OTP created and working.
- [ ] All App content sections show a green tick.
