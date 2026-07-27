# CI/CD Pipeline Architecture: Flutter + React Native (iOS + Android)

## Overview

This pipeline handles four build targets across two frameworks using GitHub Actions. The architecture separates concerns into reusable workflows called by two top-level orchestrators: one for PRs and one for merges to main.

---

## Architecture Diagram

```
GitHub Events
├── Pull Request opened/updated
│   └── pr-checks.yml (orchestrator)
│       ├── flutter-tests.yml (reusable)
│       └── rn-tests.yml (reusable)
│
└── Push to main
    └── release.yml (orchestrator)
        ├── flutter-build-ios.yml (reusable)
        ├── flutter-build-android.yml (reusable)
        ├── rn-build-ios.yml (reusable)
        ├── rn-build-android.yml (reusable)
        └── notify-slack.yml (reusable)
```

### Key Design Decisions

1. **Reusable workflows** (`workflow_call`) keep logic DRY across PR and release flows.
2. **Matrix strategy** is avoided at the top level — each platform gets its own job so failures are isolated and retries are cheap.
3. **Secrets** for signing, store credentials, and Slack are stored in GitHub Encrypted Secrets (org-level recommended for multi-repo).
4. **Caching** is aggressive: Flutter SDK, pub packages, Gradle, CocoaPods, and node_modules all cache on their respective lock files.
5. **Self-hosted macOS runners** are strongly recommended for iOS builds to avoid GitHub-hosted macOS runner costs and queue times. Android and tests can run on `ubuntu-latest`.

---

## Secret Inventory

Store these in GitHub → Settings → Secrets and Variables → Actions:

| Secret | Used For |
|---|---|
| `FLUTTER_KEYSTORE_BASE64` | Android signing (Flutter app) |
| `FLUTTER_KEYSTORE_PASSWORD` | Android signing (Flutter app) |
| `FLUTTER_KEY_ALIAS` | Android signing (Flutter app) |
| `FLUTTER_KEY_PASSWORD` | Android signing (Flutter app) |
| `RN_KEYSTORE_BASE64` | Android signing (RN app) |
| `RN_KEYSTORE_PASSWORD` | Android signing (RN app) |
| `RN_KEY_ALIAS` | Android signing (RN app) |
| `RN_KEY_PASSWORD` | Android signing (RN app) |
| `IOS_DISTRIBUTION_CERT_BASE64` | iOS signing (both apps) |
| `IOS_DISTRIBUTION_CERT_PASSWORD` | iOS signing (both apps) |
| `FLUTTER_PROVISIONING_PROFILE_BASE64` | iOS signing (Flutter app) |
| `RN_PROVISIONING_PROFILE_BASE64` | iOS signing (RN app) |
| `APP_STORE_CONNECT_API_KEY_ID` | TestFlight upload |
| `APP_STORE_CONNECT_API_ISSUER_ID` | TestFlight upload |
| `APP_STORE_CONNECT_API_KEY_BASE64` | TestFlight upload (.p8 file) |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | Google Play upload |
| `SLACK_WEBHOOK_URL` | Slack notifications |

---

## Workflow Files

### 1. PR Checks Orchestrator — `.github/workflows/pr-checks.yml`

```yaml
name: PR Checks

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  flutter-tests:
    uses: ./.github/workflows/_flutter-tests.yml
    secrets: inherit

  rn-tests:
    uses: ./.github/workflows/_rn-tests.yml
    secrets: inherit
```

---

### 2. Release Orchestrator — `.github/workflows/release.yml`

```yaml
name: Release Build & Deploy

on:
  push:
    branches: [main]

jobs:
  # ── Build all four targets in parallel ──────────────────────────
  flutter-ios:
    uses: ./.github/workflows/_flutter-build-ios.yml
    secrets: inherit

  flutter-android:
    uses: ./.github/workflows/_flutter-build-android.yml
    secrets: inherit

  rn-ios:
    uses: ./.github/workflows/_rn-build-ios.yml
    secrets: inherit

  rn-android:
    uses: ./.github/workflows/_rn-build-android.yml
    secrets: inherit

  # ── Notify after all builds complete (success or failure) ────────
  notify:
    needs: [flutter-ios, flutter-android, rn-ios, rn-android]
    if: always()
    uses: ./.github/workflows/_notify-slack.yml
    with:
      flutter_ios_result: ${{ needs.flutter-ios.result }}
      flutter_android_result: ${{ needs.flutter-android.result }}
      rn_ios_result: ${{ needs.rn-ios.result }}
      rn_android_result: ${{ needs.rn-android.result }}
      run_url: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
      commit_sha: ${{ github.sha }}
      commit_message: ${{ github.event.head_commit.message }}
    secrets: inherit
```

---

### 3. Flutter Tests — `.github/workflows/_flutter-tests.yml`

```yaml
name: Flutter Tests (reusable)

on:
  workflow_call:

jobs:
  flutter-unit-widget-tests:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: flutter_app  # adjust to your repo structure

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'      # pin to your version
          channel: 'stable'
          cache: true

      - name: Cache pub packages
        uses: actions/cache@v4
        with:
          path: |
            ~/.pub-cache
            flutter_app/.dart_tool
          key: flutter-pub-${{ hashFiles('flutter_app/pubspec.lock') }}
          restore-keys: flutter-pub-

      - name: Install dependencies
        run: flutter pub get

      - name: Analyze
        run: flutter analyze --no-fatal-infos

      - name: Run unit & widget tests
        run: |
          flutter test \
            --coverage \
            --reporter github \
            test/

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: flutter_app/coverage/lcov.info
          flags: flutter
        continue-on-error: true
```

---

### 4. React Native Tests — `.github/workflows/_rn-tests.yml`

```yaml
name: React Native Tests (reusable)

on:
  workflow_call:

jobs:
  rn-unit-component-tests:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: rn_app  # adjust to your repo structure

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Install JS dependencies
        run: yarn install --frozen-lockfile

      - name: TypeScript check
        run: yarn tsc --noEmit
        continue-on-error: false

      - name: Lint
        run: yarn eslint . --ext .ts,.tsx --max-warnings 0

      - name: Run Jest tests
        run: |
          yarn jest \
            --ci \
            --coverage \
            --reporters=default \
            --reporters=jest-github-actions-reporter

      - name: Upload coverage
        uses: codecov/codecov-action@v4
        with:
          files: rn_app/coverage/lcov.info
          flags: react-native
        continue-on-error: true
```

---

### 5. Flutter Android Build & Deploy — `.github/workflows/_flutter-build-android.yml`

```yaml
name: Flutter Android Build (reusable)

on:
  workflow_call:

jobs:
  build-flutter-android:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: flutter_app

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'
          cache: true

      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: gradle-${{ hashFiles('flutter_app/android/**/*.gradle*', 'flutter_app/android/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: gradle-

      - name: Cache pub packages
        uses: actions/cache@v4
        with:
          path: ~/.pub-cache
          key: flutter-pub-${{ hashFiles('flutter_app/pubspec.lock') }}

      - name: Install Flutter dependencies
        run: flutter pub get

      - name: Decode keystore
        run: |
          echo "${{ secrets.FLUTTER_KEYSTORE_BASE64 }}" | base64 --decode > android/app/release.keystore

      - name: Create key.properties
        run: |
          cat > android/key.properties <<EOF
          storePassword=${{ secrets.FLUTTER_KEYSTORE_PASSWORD }}
          keyPassword=${{ secrets.FLUTTER_KEY_PASSWORD }}
          keyAlias=${{ secrets.FLUTTER_KEY_ALIAS }}
          storeFile=release.keystore
          EOF

      - name: Build release AAB
        run: |
          flutter build appbundle \
            --release \
            --build-number=${{ github.run_number }}

      - name: Upload AAB artifact
        uses: actions/upload-artifact@v4
        with:
          name: flutter-android-aab
          path: flutter_app/build/app/outputs/bundle/release/app-release.aab
          retention-days: 14

      - name: Deploy to Google Play Internal Track
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.yourcompany.flutterapp   # replace with your package name
          releaseFiles: flutter_app/build/app/outputs/bundle/release/app-release.aab
          track: internal
          status: completed
```

---

### 6. Flutter iOS Build & Deploy — `.github/workflows/_flutter-build-ios.yml`

```yaml
name: Flutter iOS Build (reusable)

on:
  workflow_call:

jobs:
  build-flutter-ios:
    runs-on: macos-14                  # or self-hosted macos runner
    defaults:
      run:
        working-directory: flutter_app

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'
          cache: true

      - name: Cache CocoaPods
        uses: actions/cache@v4
        with:
          path: flutter_app/ios/Pods
          key: pods-flutter-${{ hashFiles('flutter_app/ios/Podfile.lock') }}
          restore-keys: pods-flutter-

      - name: Install Flutter dependencies
        run: flutter pub get

      - name: Install CocoaPods
        run: pod install
        working-directory: flutter_app/ios

      - name: Import distribution certificate
        uses: apple-actions/import-codesign-certs@v3
        with:
          p12-file-base64: ${{ secrets.IOS_DISTRIBUTION_CERT_BASE64 }}
          p12-password: ${{ secrets.IOS_DISTRIBUTION_CERT_PASSWORD }}

      - name: Install provisioning profile
        run: |
          PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/flutter_dist.mobileprovision"
          mkdir -p "$(dirname "$PROFILE_PATH")"
          echo "${{ secrets.FLUTTER_PROVISIONING_PROFILE_BASE64 }}" | base64 --decode > "$PROFILE_PATH"

      - name: Build IPA
        run: |
          flutter build ipa \
            --release \
            --build-number=${{ github.run_number }} \
            --export-options-plist=ios/ExportOptions.plist

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: flutter-ios-ipa
          path: flutter_app/build/ios/ipa/*.ipa
          retention-days: 14

      - name: Setup App Store Connect API key
        run: |
          mkdir -p ~/.appstoreconnect/private_keys
          echo "${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.appstoreconnect/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}.p8

      - name: Upload to TestFlight
        run: |
          xcrun altool --upload-app \
            --type ios \
            --file "$(ls flutter_app/build/ios/ipa/*.ipa)" \
            --apiKey "${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}" \
            --apiIssuer "${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}"
        # Alternatively use: xcrun notarytool / fastlane pilot upload
```

---

### 7. React Native Android Build & Deploy — `.github/workflows/_rn-build-android.yml`

```yaml
name: RN Android Build (reusable)

on:
  workflow_call:

jobs:
  build-rn-android:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: rn_app

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Setup Java
        uses: actions/setup-java@v4
        with:
          distribution: 'temurin'
          java-version: '17'

      - name: Cache Gradle
        uses: actions/cache@v4
        with:
          path: |
            ~/.gradle/caches
            ~/.gradle/wrapper
          key: gradle-rn-${{ hashFiles('rn_app/android/**/*.gradle*', 'rn_app/android/gradle/wrapper/gradle-wrapper.properties') }}
          restore-keys: gradle-rn-

      - name: Install JS dependencies
        run: yarn install --frozen-lockfile

      - name: Decode keystore
        run: |
          echo "${{ secrets.RN_KEYSTORE_BASE64 }}" | base64 --decode > android/app/release.keystore

      - name: Create keystore config
        run: |
          cat > android/gradle.properties <<EOF
          MYAPP_RELEASE_STORE_FILE=release.keystore
          MYAPP_RELEASE_STORE_PASSWORD=${{ secrets.RN_KEYSTORE_PASSWORD }}
          MYAPP_RELEASE_KEY_ALIAS=${{ secrets.RN_KEY_ALIAS }}
          MYAPP_RELEASE_KEY_PASSWORD=${{ secrets.RN_KEY_PASSWORD }}
          EOF

      - name: Build release AAB
        run: |
          cd android && ./gradlew bundleRelease \
            -PversionCode=${{ github.run_number }}

      - name: Upload AAB artifact
        uses: actions/upload-artifact@v4
        with:
          name: rn-android-aab
          path: rn_app/android/app/build/outputs/bundle/release/app-release.aab
          retention-days: 14

      - name: Deploy to Google Play Internal Track
        uses: r0adkll/upload-google-play@v1
        with:
          serviceAccountJsonPlainText: ${{ secrets.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON }}
          packageName: com.yourcompany.rnapp    # replace with your package name
          releaseFiles: rn_app/android/app/build/outputs/bundle/release/app-release.aab
          track: internal
          status: completed
```

---

### 8. React Native iOS Build & Deploy — `.github/workflows/_rn-build-ios.yml`

```yaml
name: RN iOS Build (reusable)

on:
  workflow_call:

jobs:
  build-rn-ios:
    runs-on: macos-14
    defaults:
      run:
        working-directory: rn_app

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Setup Ruby (for CocoaPods)
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.2'
          bundler-cache: true
          working-directory: rn_app

      - name: Cache CocoaPods
        uses: actions/cache@v4
        with:
          path: rn_app/ios/Pods
          key: pods-rn-${{ hashFiles('rn_app/ios/Podfile.lock') }}
          restore-keys: pods-rn-

      - name: Install JS dependencies
        run: yarn install --frozen-lockfile

      - name: Install CocoaPods
        run: bundle exec pod install
        working-directory: rn_app/ios

      - name: Import distribution certificate
        uses: apple-actions/import-codesign-certs@v3
        with:
          p12-file-base64: ${{ secrets.IOS_DISTRIBUTION_CERT_BASE64 }}
          p12-password: ${{ secrets.IOS_DISTRIBUTION_CERT_PASSWORD }}

      - name: Install provisioning profile
        run: |
          PROFILE_PATH="$HOME/Library/MobileDevice/Provisioning Profiles/rn_dist.mobileprovision"
          mkdir -p "$(dirname "$PROFILE_PATH")"
          echo "${{ secrets.RN_PROVISIONING_PROFILE_BASE64 }}" | base64 --decode > "$PROFILE_PATH"

      - name: Build IPA
        run: |
          xcodebuild \
            -workspace ios/YourApp.xcworkspace \
            -scheme YourApp \
            -configuration Release \
            -archivePath $RUNNER_TEMP/YourApp.xcarchive \
            archive \
            CODE_SIGN_STYLE=Manual \
            PROVISIONING_PROFILE_SPECIFIER="Your Distribution Profile Name"

          xcodebuild \
            -exportArchive \
            -archivePath $RUNNER_TEMP/YourApp.xcarchive \
            -exportOptionsPlist ios/ExportOptions.plist \
            -exportPath $RUNNER_TEMP/ipa

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: rn-ios-ipa
          path: ${{ runner.temp }}/ipa/*.ipa
          retention-days: 14

      - name: Setup App Store Connect API key
        run: |
          mkdir -p ~/.appstoreconnect/private_keys
          echo "${{ secrets.APP_STORE_CONNECT_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.appstoreconnect/private_keys/AuthKey_${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}.p8

      - name: Upload to TestFlight
        run: |
          xcrun altool --upload-app \
            --type ios \
            --file "$(ls $RUNNER_TEMP/ipa/*.ipa)" \
            --apiKey "${{ secrets.APP_STORE_CONNECT_API_KEY_ID }}" \
            --apiIssuer "${{ secrets.APP_STORE_CONNECT_API_ISSUER_ID }}"
```

---

### 9. Slack Notification — `.github/workflows/_notify-slack.yml`

```yaml
name: Slack Notification (reusable)

on:
  workflow_call:
    inputs:
      flutter_ios_result:
        type: string
        required: true
      flutter_android_result:
        type: string
        required: true
      rn_ios_result:
        type: string
        required: true
      rn_android_result:
        type: string
        required: true
      run_url:
        type: string
        required: true
      commit_sha:
        type: string
        required: true
      commit_message:
        type: string
        required: true

jobs:
  slack:
    runs-on: ubuntu-latest
    steps:
      - name: Determine overall status
        id: status
        run: |
          if [[ "${{ inputs.flutter_ios_result }}" == "success" && \
                "${{ inputs.flutter_android_result }}" == "success" && \
                "${{ inputs.rn_ios_result }}" == "success" && \
                "${{ inputs.rn_android_result }}" == "success" ]]; then
            echo "color=good" >> $GITHUB_OUTPUT
            echo "emoji=white_check_mark" >> $GITHUB_OUTPUT
            echo "text=All builds deployed successfully" >> $GITHUB_OUTPUT
          else
            echo "color=danger" >> $GITHUB_OUTPUT
            echo "emoji=x" >> $GITHUB_OUTPUT
            echo "text=One or more builds failed" >> $GITHUB_OUTPUT
          fi

      - name: Send Slack notification
        uses: slackapi/slack-github-action@v1.26.0
        with:
          payload: |
            {
              "attachments": [
                {
                  "color": "${{ steps.status.outputs.color }}",
                  "blocks": [
                    {
                      "type": "header",
                      "text": {
                        "type": "plain_text",
                        "text": ":${{ steps.status.outputs.emoji }}: Mobile Release — ${{ steps.status.outputs.text }}"
                      }
                    },
                    {
                      "type": "section",
                      "fields": [
                        {
                          "type": "mrkdwn",
                          "text": "*Commit:*\n`${{ inputs.commit_sha }}`"
                        },
                        {
                          "type": "mrkdwn",
                          "text": "*Message:*\n${{ inputs.commit_message }}"
                        }
                      ]
                    },
                    {
                      "type": "section",
                      "fields": [
                        {
                          "type": "mrkdwn",
                          "text": "*Flutter iOS:* ${{ inputs.flutter_ios_result == 'success' && ':white_check_mark:' || ':x:' }}"
                        },
                        {
                          "type": "mrkdwn",
                          "text": "*Flutter Android:* ${{ inputs.flutter_android_result == 'success' && ':white_check_mark:' || ':x:' }}"
                        },
                        {
                          "type": "mrkdwn",
                          "text": "*RN iOS:* ${{ inputs.rn_ios_result == 'success' && ':white_check_mark:' || ':x:' }}"
                        },
                        {
                          "type": "mrkdwn",
                          "text": "*RN Android:* ${{ inputs.rn_android_result == 'success' && ':white_check_mark:' || ':x:' }}"
                        }
                      ]
                    },
                    {
                      "type": "actions",
                      "elements": [
                        {
                          "type": "button",
                          "text": { "type": "plain_text", "text": "View Run" },
                          "url": "${{ inputs.run_url }}"
                        }
                      ]
                    }
                  ]
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK_URL }}
          SLACK_WEBHOOK_TYPE: INCOMING_WEBHOOK
```

---

## Supporting Files

### `ios/ExportOptions.plist` (Flutter — same structure for RN)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>YOUR_TEAM_ID</string>
  <key>uploadBitcode</key>
  <false/>
  <key>uploadSymbols</key>
  <true/>
  <key>signingStyle</key>
  <string>manual</string>
  <key>provisioningProfiles</key>
  <dict>
    <key>com.yourcompany.flutterapp</key>
    <string>Your Distribution Profile Name</string>
  </dict>
</dict>
</plist>
```

### `android/app/build.gradle` signing config (Flutter — same pattern for RN)

```groovy
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file('key.properties')
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled true
            shrinkResources true
        }
    }
}
```

---

## Repo Structure Assumptions

```
your-repo/
├── flutter_app/
│   ├── pubspec.yaml / pubspec.lock
│   ├── ios/
│   │   ├── ExportOptions.plist
│   │   └── Podfile.lock
│   └── android/
│       └── app/build.gradle
├── rn_app/
│   ├── package.json / yarn.lock
│   ├── ios/
│   │   ├── YourApp.xcworkspace
│   │   ├── ExportOptions.plist
│   │   └── Podfile.lock
│   └── android/
│       └── app/build.gradle
└── .github/
    └── workflows/
        ├── pr-checks.yml
        ├── release.yml
        ├── _flutter-tests.yml
        ├── _rn-tests.yml
        ├── _flutter-build-ios.yml
        ├── _flutter-build-android.yml
        ├── _rn-build-ios.yml
        ├── _rn-build-android.yml
        └── _notify-slack.yml
```

---

## Estimated Run Times (GitHub-hosted runners)

| Job | Runner | Estimated Time |
|---|---|---|
| Flutter tests | ubuntu-latest | 3–6 min |
| RN tests | ubuntu-latest | 2–5 min |
| Flutter Android build + deploy | ubuntu-latest | 8–14 min |
| Flutter iOS build + deploy | macos-14 | 18–30 min |
| RN Android build + deploy | ubuntu-latest | 10–16 min |
| RN iOS build + deploy | macos-14 | 20–35 min |

All four release builds run in **parallel**, so total wall-clock time on merge to main is approximately the longest job (iOS build, ~20–35 min).

---

## Cost & Optimization Notes

- **macOS minutes cost 10× Linux minutes** on GitHub-hosted runners. For teams running many builds per day, a self-hosted macOS runner (Mac Mini or Buildkite Elastic CI stack on AWS Mac instances) pays for itself quickly.
- **Caching** is critical. With warm caches: Gradle saves ~3–5 min, CocoaPods saves ~4–8 min, pub/node_modules saves ~1–3 min.
- **Concurrency cancellation** on PRs (`cancel-in-progress: true`) prevents queue buildup when developers push rapidly.
- **Build number** is set to `github.run_number` — monotonically increasing, unique per workflow. This satisfies both TestFlight and Google Play requirements without manual version bumping.
- Consider adding **branch protection rules** requiring both Flutter and RN test jobs to pass before merging.

---

## One-Time Setup Checklist

- [ ] Generate Android release keystore for each app (`keytool -genkey -v ...`), base64-encode, add to secrets
- [ ] Export iOS Distribution certificate from Keychain as `.p12`, base64-encode, add to secrets
- [ ] Download provisioning profiles from Apple Developer portal, base64-encode, add to secrets
- [ ] Create App Store Connect API key (Users & Access → Keys), add key ID, issuer ID, and `.p8` content to secrets
- [ ] Create Google Play service account with "Release Manager" role, download JSON, add to secrets
- [ ] Create Slack incoming webhook and add URL to secrets
- [ ] Add `key.properties` and `*.keystore` to `.gitignore` in both apps
- [ ] Set `flutter-version` in workflows to match `.flutter-version` file (or `fvm` config)
- [ ] Replace placeholder package names (`com.yourcompany.*`) and workspace names (`YourApp`) throughout
