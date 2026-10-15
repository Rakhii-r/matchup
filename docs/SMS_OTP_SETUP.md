# Phone OTP — production setup

**Status (14 Oct 2026):** launching on **Twilio Verify**. MSG91 + DLT is the
planned replacement once DLT is approved (see "Switching to MSG91 later").

The app needs no code change for Twilio Verify. `authRepository.requestOtp`
calls `signInWithOtp({ phone, options: { channel: 'sms' } })` and `verifyOtp`
uses `type: 'sms'`; Supabase forwards both to Twilio Verify. The verify screen
(`app/(auth)/verify-otp.tsx`) expects a **6-digit** code, so the Verify service
must stay at code length 6.

Use **Twilio Verify**, not Twilio Programmable Messaging. Plain SMS to Indian
numbers requires our own DLT registration; Verify sends through Twilio's own
registered setup. India's SMS rules change — re-check Twilio's India guidance
before relying on this.

---

## 1. Twilio account

1. Sign up at twilio.com and verify your email and phone.
2. **Upgrade from trial** (Console → Admin → Account billing → Upgrade). A
   trial can only text numbers you verified yourself, so real users get nothing.
   Add a card and ~$20 credit. If you enable auto-recharge, keep the amount low.
3. **Billing alerts:** Console → Billing → Usage triggers. Add triggers at, for
   example, $10 and $25 so a fraud spike emails you.

## 2. Verify service

4. Console → Verify → Services → **Create new**.
   - Friendly name: `SIXFOUR 24` — this text appears in the SMS
     ("Your SIXFOUR 24 verification code is: 123456").
   - Channels: **SMS only**. Leave WhatsApp, Voice and Email off.
   - Code length: **6** (the app rejects anything else).
5. In the service's settings:
   - **Fraud Guard:** on.
   - **Geo permissions** (Verify → Settings → Geo permissions): allow **India
     only**. Also restrict Messaging → Settings → Geo permissions to India.
6. Copy three values:
   - **Account SID** (starts `AC…`, Console home)
   - **Auth Token** (Console home — treat as a password, never commit it)
   - **Verify Service SID** (starts `VA…`, on the service page)

## 3. Supabase (hosted project)

7. Dashboard → Authentication → Sign In / Providers → **Phone**:
   - Enable phone provider and phone sign-up.
   - SMS provider: **Twilio Verify**.
   - Paste Account SID, Auth Token, and the Verify Service SID (the field may
     be labelled "Twilio Message Service SID"). Save.
8. Dashboard → Authentication → **Rate Limits**: keep "SMS messages sent per
   hour" modest at launch (default 30; raise only when real traffic needs it).
9. **Reviewer / tester login.** Same Phone page → "Test phone numbers and OTPs".
   Add a number that is not a real person's, e.g. `919000000001=123456`.
   No SMS is sent for test numbers and no Twilio cost is incurred. Anyone with
   the number and code can sign in to that account, so use it only for a demo
   account with nothing private on it.

`supabase/config.toml` `[auth.sms.test_otp]` applies to the **local** stack only;
the hosted project's test numbers are set in the dashboard (step 9).

## 4. Test before release

10. On a real phone with a real Indian SIM, install a preview or production
    build and sign in. Also try a wrong code, Resend after 60 s, and a code
    left to expire.
11. Check Twilio Console → Monitor → Logs → Verify: each attempt should end
    `approved`. If the SMS never arrives, the error code there says why —
    commonly a geo-permission block, Fraud Guard, or a malformed number.
12. Sign out and back in on the same phone to confirm the session flow.

## 5. Play Console

13. App content → **App access** → "All or some functionality is restricted".
    Give the test number from step 9, the OTP, and one line of instructions:
    "Enter 9000000001 on the login screen, tap Send OTP, enter 123456."

## 6. Before going public

- **CAPTCHA (Cloudflare Turnstile)** on the OTP request. Without it, bots can
  request OTPs to arbitrary numbers and you pay for every one. Supabase Auth
  supports Turnstile natively; it needs a small app change on the login screen.
- Watch Twilio spend weekly for the first month.

## Rough cost

Twilio Verify to India is roughly ₹10–12 per successful login (verification fee
plus SMS). A user only gets an OTP when signing in, not every time they open the
app, so logins are far fewer than daily users. Check current prices on Twilio's
pricing page.

## Switching to MSG91 later

Users stay signed in across the switch; sessions do not depend on the SMS
provider. Supabase has **no built-in MSG91 provider**, so the switch needs:

1. DLT approval (entity, sender ID, OTP template, MSG91 linked as telemarketer).
2. A `send-sms` Supabase Auth Hook (Edge Function) that sends the
   Supabase-generated OTP through MSG91's template API.
3. Dashboard → Authentication → Hooks → enable **Send SMS** pointing at it, with
   the MSG91 auth key and template ID stored as function secrets.
4. Real-SIM test, then remove the Twilio credentials and close the Verify service.

No app update is required for the switch.
