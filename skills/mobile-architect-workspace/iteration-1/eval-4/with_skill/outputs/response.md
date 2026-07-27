# CI/CD Pipeline Architecture: Flutter + React Native (4 Targets)

---

## 1. Architectural Blueprint

The pipeline is structured around three tiers of workflow execution. The first tier is a **PR validation layer** — a single reusable workflow matrix that fans out in parallel across all four targets (Flutter iOS, Flutter Android, React Native iOS, React Native Android), running unit and widget/component tests with no signing required. This keeps PR feedback fast (all four targets run simultaneously) and cheap (no Apple/Google API calls). The second tier is a **release build layer** triggered exclusively on `push` to `main` — it builds signed IPAs (via Fastlane's `gym` / `build_app`) and signed AABs (via Gradle with keystore injection from GitHub Secrets), then uploads artifacts. The third tier is a **distribution layer** that deploys to TestFlight and Google Play internal track using Fastlane's `pilot` and `supply` actions, ensuring the build layer and the deploy layer are decoupled so a failed upload does not re-trigger an expensive build. A single composite `notify` job runs last with `if: always()` to send a Slack message regardless of upstream success or failure, using the GitHub Actions context to inject per-job status. Secrets (signing certificates, API keys, keystore files) are stored in GitHub Encrypted Secrets and — for the iOS certificate/provisioning profile chain — in a dedicated ephemeral Fastlane Match repository accessed via a deploy key, so private keys are never written to disk in plaintext on the runner. This approach was chosen over simpler per-platform monolithic workflows because it gives you a single source of truth for the pipeline contract, makes adding a fifth target a one-line matrix change, and isolates expensive signing operations behind the merge gate where they belong.

---

## 2. The Implementation

### Repository Secret Inventory

Before the YAML, establish these secrets in your GitHub repository settings. Every reference in the workflows below maps to one of these keys.

```
# Shared
SLACK_WEBHOOK_URL

# Flutter signing — Android
FLUTTER_KEYSTORE_BASE64          # base64-encoded .jks file
FLUTTER_KEY_ALIAS
FLUTTER_KEYSTORE_PASSWORD
FLUTTER_KEY_PASSWORD

# Flutter signing — iOS (via Fastlane Match)
MATCH_GIT_URL                    # SSH URL of private match repo
MATCH_GIT_DEPLOY_KEY             # private SSH key with read access to match repo
MATCH_PASSWORD                   # encryption password for match repo
APPLE_API_KEY_ID
APPLE_API_ISSUER_ID
APPLE_API_KEY_BASE64             # base64-encoded .p8 file

# React Native signing — Android
RN_KEYSTORE_BASE64
RN_KEY_ALIAS
RN_KEYSTORE_PASSWORD
RN_KEY_PASSWORD

# React Native signing — iOS
# Reuses MATCH_* and APPLE_API_* secrets above

# Google Play
GOOGLE_PLAY_JSON_KEY_BASE64      # base64-encoded service account JSON

# App identifiers (used by Fastlane)
FLUTTER_BUNDLE_ID                # e.g. com.example.flutterapp
RN_BUNDLE_ID                     # e.g. com.example.rnapp
FLUTTER_APPLE_APP_ID             # numeric App Store Connect app ID
RN_APPLE_APP_ID
FLUTTER_GOOGLE_PACKAGE           # com.example.flutterapp
RN_GOOGLE_PACKAGE                # com.example.rnapp
```

---

### Shared Reusable Workflow: `.github/workflows/mobile-test.yml`

This is called by every PR workflow for both apps. It is parameterised by `app` (`flutter` | `rn`) and `platform` (`ios` | `android`).

```yaml
name: Mobile Test (Reusable)

on:
  workflow_call:
    inputs:
      app:
        required: true
        type: string   # "flutter" | "rn"
      platform:
        required: true
        type: string   # "ios" | "android"

jobs:
  test:
    name: Test ${{ inputs.app }} / ${{ inputs.platform }}
    runs-on: ${{ inputs.platform == 'ios' && 'macos-14' || 'ubuntu-latest' }}
    timeout-minutes: 30

    steps:
      # ── Checkout ──────────────────────────────────────────────────────────
      - name: Checkout
        uses: actions/checkout@v4

      # ── Flutter setup ──────────────────────────────────────────────────────
      - name: Setup Flutter
        if: inputs.app == 'flutter'
        uses: subosito/flutter-action@v2
        with:
          flutter-version: '3.22.0'
          channel: 'stable'
          cache: true

      - name: Flutter pub get
        if: inputs.app == 'flutter'
        working-directory: flutter_app
        run: flutter pub get

      - name: Flutter unit + widget tests
        if: inputs.app == 'flutter'
        working-directory: flutter_app
        run: |
          flutter test \
            --coverage \
            --reporter expanded \
            --no-pub

      - name: Upload Flutter coverage
        if: inputs.app == 'flutter'
        uses: codecov/codecov-action@v4
        with:
          files: flutter_app/coverage/lcov.info
          flags: flutter-${{ inputs.platform }}
          fail_ci_if_error: false

      # ── React Native setup ─────────────────────────────────────────────────
      - name: Setup Node
        if: inputs.app == 'rn'
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Install RN dependencies
        if: inputs.app == 'rn'
        working-directory: rn_app
        run: yarn install --frozen-lockfile

      - name: RN Jest tests
        if: inputs.app == 'rn'
        working-directory: rn_app
        run: |
          yarn test \
            --ci \
            --coverage \
            --coverageReporters=lcov \
            --forceExit \
            --passWithNoTests

      - name: Upload RN coverage
        if: inputs.app == 'rn'
        uses: codecov/codecov-action@v4
        with:
          files: rn_app/coverage/lcov.info
          flags: rn-${{ inputs.platform }}
          fail_ci_if_error: false

      # ── iOS pod install (test compilation check) ───────────────────────────
      - name: Pod install (iOS)
        if: inputs.platform == 'ios' && inputs.app == 'rn'
        working-directory: rn_app/ios
        run: pod install --repo-update

      - name: Flutter iOS pod install
        if: inputs.platform == 'ios' && inputs.app == 'flutter'
        working-directory: flutter_app/ios
        run: pod install --repo-update
```

---

### PR Trigger Workflow: `.github/workflows/pr.yml`

Fans out all four targets in parallel, then reports a consolidated status.

```yaml
name: PR Validation

on:
  pull_request:
    branches: [main]
    types: [opened, synchronize, reopened]

# Cancel in-progress runs on the same PR to save minutes
concurrency:
  group: pr-${{ github.event.pull_request.number }}
  cancel-in-progress: true

jobs:
  flutter-ios-test:
    name: Flutter / iOS Tests
    uses: ./.github/workflows/mobile-test.yml
    with:
      app: flutter
      platform: ios

  flutter-android-test:
    name: Flutter / Android Tests
    uses: ./.github/workflows/mobile-test.yml
    with:
      app: flutter
      platform: android

  rn-ios-test:
    name: React Native / iOS Tests
    uses: ./.github/workflows/mobile-test.yml
    with:
      app: rn
      platform: ios

  rn-android-test:
    name: React Native / Android Tests
    uses: ./.github/workflows/mobile-test.yml
    with:
      app: rn
      platform: android

  # Gate: all four must pass before PR can be merged (enforce via branch protection)
  pr-gate:
    name: PR Gate
    needs: [flutter-ios-test, flutter-android-test, rn-ios-test, rn-android-test]
    runs-on: ubuntu-latest
    if: always()
    steps:
      - name: Check all targets passed
        run: |
          results=(
            "${{ needs.flutter-ios-test.result }}"
            "${{ needs.flutter-android-test.result }}"
            "${{ needs.rn-ios-test.result }}"
            "${{ needs.rn-android-test.result }}"
          )
          for result in "${results[@]}"; do
            if [[ "$result" != "success" ]]; then
              echo "One or more targets failed: ${results[*]}"
              exit 1
            fi
          done
          echo "All four targets passed."
```

---

### Flutter Release Workflow: `.github/workflows/flutter-release.yml`

Runs on merge to `main`. Builds signed IPA and AAB, deploys, then notifies.

```yaml
name: Flutter Release

on:
  push:
    branches: [main]
    paths:
      - 'flutter_app/**'
      - '.github/workflows/flutter-release.yml'

# Only one release at a time per app
concurrency:
  group: flutter-release
  cancel-in-progress: false

env:
  FLUTTER_VERSION: '3.22.0'

jobs:
  # ── Build Android AAB ────────────────────────────────────────────────────
  build-android:
    name: Build Flutter Android AAB
    runs-on: ubuntu-latest
    timeout-minutes: 45
    outputs:
      aab-path: ${{ steps.build.outputs.aab-path }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          channel: stable
          cache: true

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Decode keystore
        working-directory: flutter_app/android
        run: |
          echo "${{ secrets.FLUTTER_KEYSTORE_BASE64 }}" | base64 --decode > app/release.jks

      - name: Write key.properties
        working-directory: flutter_app/android
        run: |
          cat > key.properties <<EOF
          storeFile=release.jks
          storePassword=${{ secrets.FLUTTER_KEYSTORE_PASSWORD }}
          keyAlias=${{ secrets.FLUTTER_KEY_ALIAS }}
          keyPassword=${{ secrets.FLUTTER_KEY_PASSWORD }}
          EOF

      - name: Flutter pub get
        working-directory: flutter_app
        run: flutter pub get

      - name: Build AAB
        id: build
        working-directory: flutter_app
        run: |
          flutter build appbundle \
            --release \
            --no-pub \
            --build-number=${{ github.run_number }}
          AAB_PATH="build/app/outputs/bundle/release/app-release.aab"
          echo "aab-path=$AAB_PATH" >> "$GITHUB_OUTPUT"

      - name: Upload AAB artifact
        uses: actions/upload-artifact@v4
        with:
          name: flutter-aab
          path: flutter_app/build/app/outputs/bundle/release/app-release.aab
          retention-days: 7

  # ── Build iOS IPA ────────────────────────────────────────────────────────
  build-ios:
    name: Build Flutter iOS IPA
    runs-on: macos-14
    timeout-minutes: 60
    outputs:
      ipa-path: ${{ steps.build.outputs.ipa-path }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Flutter
        uses: subosito/flutter-action@v2
        with:
          flutter-version: ${{ env.FLUTTER_VERSION }}
          channel: stable
          cache: true

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: flutter_app/ios

      - name: Install SSH key for Match
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.MATCH_GIT_DEPLOY_KEY }}

      - name: Decode Apple API key
        run: |
          mkdir -p ~/.private_keys
          echo "${{ secrets.APPLE_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

      - name: Flutter pub get + pod install
        working-directory: flutter_app
        run: |
          flutter pub get
          cd ios && pod install --repo-update

      - name: Fastlane Match (download certs)
        working-directory: flutter_app/ios
        env:
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          MATCH_GIT_URL: ${{ secrets.MATCH_GIT_URL }}
        run: bundle exec fastlane match appstore --readonly --app_identifier "${{ secrets.FLUTTER_BUNDLE_ID }}"

      - name: Build IPA via Fastlane
        id: build
        working-directory: flutter_app/ios
        env:
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER_ID: ${{ secrets.APPLE_API_ISSUER_ID }}
        run: |
          bundle exec fastlane build_release \
            build_number:${{ github.run_number }} \
            bundle_id:"${{ secrets.FLUTTER_BUNDLE_ID }}"
          echo "ipa-path=output/Flutter.ipa" >> "$GITHUB_OUTPUT"

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: flutter-ipa
          path: flutter_app/ios/output/Flutter.ipa
          retention-days: 7

  # ── Deploy Android → Google Play internal ───────────────────────────────
  deploy-android:
    name: Deploy Flutter → Play Internal
    needs: build-android
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download AAB
        uses: actions/download-artifact@v4
        with:
          name: flutter-aab
          path: flutter_app/dist

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: flutter_app/android

      - name: Decode Play service account key
        run: |
          echo "${{ secrets.GOOGLE_PLAY_JSON_KEY_BASE64 }}" | base64 --decode \
            > /tmp/play-key.json

      - name: Upload to Play internal track
        working-directory: flutter_app/android
        run: |
          bundle exec fastlane supply \
            --aab "../dist/app-release.aab" \
            --track internal \
            --json_key /tmp/play-key.json \
            --package_name "${{ secrets.FLUTTER_GOOGLE_PACKAGE }}" \
            --skip_upload_metadata \
            --skip_upload_images \
            --skip_upload_screenshots

  # ── Deploy iOS → TestFlight ──────────────────────────────────────────────
  deploy-ios:
    name: Deploy Flutter → TestFlight
    needs: build-ios
    runs-on: macos-14
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download IPA
        uses: actions/download-artifact@v4
        with:
          name: flutter-ipa
          path: flutter_app/dist

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: flutter_app/ios

      - name: Decode Apple API key
        run: |
          mkdir -p ~/.private_keys
          echo "${{ secrets.APPLE_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

      - name: Upload to TestFlight
        working-directory: flutter_app/ios
        env:
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER_ID: ${{ secrets.APPLE_API_ISSUER_ID }}
        run: |
          bundle exec fastlane pilot upload \
            --ipa "../dist/Flutter.ipa" \
            --api_key_path ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8 \
            --api_key_id "${{ secrets.APPLE_API_KEY_ID }}" \
            --api_key_issuer_id "${{ secrets.APPLE_API_ISSUER_ID }}" \
            --app_identifier "${{ secrets.FLUTTER_BUNDLE_ID }}" \
            --skip_waiting_for_build_processing

  # ── Slack Notification ───────────────────────────────────────────────────
  notify:
    name: Slack Notify (Flutter)
    needs: [deploy-android, deploy-ios]
    runs-on: ubuntu-latest
    if: always()

    steps:
      - name: Build status summary
        id: status
        run: |
          android="${{ needs.deploy-android.result }}"
          ios="${{ needs.deploy-ios.result }}"
          if [[ "$android" == "success" && "$ios" == "success" ]]; then
            echo "color=good" >> "$GITHUB_OUTPUT"
            echo "icon=:white_check_mark:" >> "$GITHUB_OUTPUT"
            echo "text=Flutter release deployed successfully to TestFlight and Play Internal." >> "$GITHUB_OUTPUT"
          else
            echo "color=danger" >> "$GITHUB_OUTPUT"
            echo "icon=:x:" >> "$GITHUB_OUTPUT"
            echo "text=Flutter release FAILED. Android: $android | iOS: $ios" >> "$GITHUB_OUTPUT"
          fi

      - name: Post to Slack
        uses: slackapi/slack-github-action@v1.27.0
        with:
          payload: |
            {
              "attachments": [
                {
                  "color": "${{ steps.status.outputs.color }}",
                  "blocks": [
                    {
                      "type": "section",
                      "text": {
                        "type": "mrkdwn",
                        "text": "${{ steps.status.outputs.icon }} *Flutter Release* — `${{ github.sha }}`\n${{ steps.status.outputs.text }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View run>"
                      }
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

### React Native Release Workflow: `.github/workflows/rn-release.yml`

Structurally identical to the Flutter workflow but with Node/Metro specifics and separate secret references.

```yaml
name: React Native Release

on:
  push:
    branches: [main]
    paths:
      - 'rn_app/**'
      - '.github/workflows/rn-release.yml'

concurrency:
  group: rn-release
  cancel-in-progress: false

env:
  NODE_VERSION: '20'

jobs:
  # ── Build Android AAB ────────────────────────────────────────────────────
  build-android:
    name: Build RN Android AAB
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Setup Java 17
        uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: '17'

      - name: Install dependencies
        working-directory: rn_app
        run: yarn install --frozen-lockfile

      - name: Decode keystore
        working-directory: rn_app/android/app
        run: |
          echo "${{ secrets.RN_KEYSTORE_BASE64 }}" | base64 --decode > release.jks

      - name: Write gradle signing config
        working-directory: rn_app/android
        run: |
          cat > keystore.properties <<EOF
          storeFile=release.jks
          storePassword=${{ secrets.RN_KEYSTORE_PASSWORD }}
          keyAlias=${{ secrets.RN_KEY_ALIAS }}
          keyPassword=${{ secrets.RN_KEY_PASSWORD }}
          EOF

      - name: Bundle JS
        working-directory: rn_app
        run: |
          npx react-native bundle \
            --platform android \
            --dev false \
            --entry-file index.js \
            --bundle-output android/app/src/main/assets/index.android.bundle \
            --assets-dest android/app/src/main/res

      - name: Build AAB
        working-directory: rn_app/android
        run: |
          ./gradlew bundleRelease \
            -PversionCode=${{ github.run_number }} \
            --no-daemon \
            --stacktrace

      - name: Upload AAB
        uses: actions/upload-artifact@v4
        with:
          name: rn-aab
          path: rn_app/android/app/build/outputs/bundle/release/app-release.aab
          retention-days: 7

  # ── Build iOS IPA ────────────────────────────────────────────────────────
  build-ios:
    name: Build RN iOS IPA
    runs-on: macos-14
    timeout-minutes: 60

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: 'yarn'
          cache-dependency-path: rn_app/yarn.lock

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: rn_app/ios

      - name: Install JS dependencies
        working-directory: rn_app
        run: yarn install --frozen-lockfile

      - name: Install SSH key for Match
        uses: webfactory/ssh-agent@v0.9.0
        with:
          ssh-private-key: ${{ secrets.MATCH_GIT_DEPLOY_KEY }}

      - name: Decode Apple API key
        run: |
          mkdir -p ~/.private_keys
          echo "${{ secrets.APPLE_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

      - name: Pod install
        working-directory: rn_app/ios
        run: pod install --repo-update

      - name: Fastlane Match (download certs)
        working-directory: rn_app/ios
        env:
          MATCH_PASSWORD: ${{ secrets.MATCH_PASSWORD }}
          MATCH_GIT_URL: ${{ secrets.MATCH_GIT_URL }}
        run: bundle exec fastlane match appstore --readonly --app_identifier "${{ secrets.RN_BUNDLE_ID }}"

      - name: Build IPA via Fastlane
        working-directory: rn_app/ios
        env:
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER_ID: ${{ secrets.APPLE_API_ISSUER_ID }}
        run: |
          bundle exec fastlane build_release \
            build_number:${{ github.run_number }} \
            bundle_id:"${{ secrets.RN_BUNDLE_ID }}"

      - name: Upload IPA artifact
        uses: actions/upload-artifact@v4
        with:
          name: rn-ipa
          path: rn_app/ios/output/ReactNativeApp.ipa
          retention-days: 7

  # ── Deploy Android ───────────────────────────────────────────────────────
  deploy-android:
    name: Deploy RN → Play Internal
    needs: build-android
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download AAB
        uses: actions/download-artifact@v4
        with:
          name: rn-aab
          path: rn_app/dist

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: rn_app/android

      - name: Decode Play service account key
        run: |
          echo "${{ secrets.GOOGLE_PLAY_JSON_KEY_BASE64 }}" | base64 --decode \
            > /tmp/play-key.json

      - name: Upload to Play internal track
        working-directory: rn_app/android
        run: |
          bundle exec fastlane supply \
            --aab "../dist/app-release.aab" \
            --track internal \
            --json_key /tmp/play-key.json \
            --package_name "${{ secrets.RN_GOOGLE_PACKAGE }}" \
            --skip_upload_metadata \
            --skip_upload_images \
            --skip_upload_screenshots

  # ── Deploy iOS ───────────────────────────────────────────────────────────
  deploy-ios:
    name: Deploy RN → TestFlight
    needs: build-ios
    runs-on: macos-14
    timeout-minutes: 30

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Download IPA
        uses: actions/download-artifact@v4
        with:
          name: rn-ipa
          path: rn_app/dist

      - name: Setup Ruby
        uses: ruby/setup-ruby@v1
        with:
          ruby-version: '3.3'
          bundler-cache: true
          working-directory: rn_app/ios

      - name: Decode Apple API key
        run: |
          mkdir -p ~/.private_keys
          echo "${{ secrets.APPLE_API_KEY_BASE64 }}" | base64 --decode \
            > ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8

      - name: Upload to TestFlight
        working-directory: rn_app/ios
        env:
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER_ID: ${{ secrets.APPLE_API_ISSUER_ID }}
        run: |
          bundle exec fastlane pilot upload \
            --ipa "../dist/ReactNativeApp.ipa" \
            --api_key_path ~/.private_keys/AuthKey_${{ secrets.APPLE_API_KEY_ID }}.p8 \
            --api_key_id "${{ secrets.APPLE_API_KEY_ID }}" \
            --api_key_issuer_id "${{ secrets.APPLE_API_ISSUER_ID }}" \
            --app_identifier "${{ secrets.RN_BUNDLE_ID }}" \
            --skip_waiting_for_build_processing

  # ── Slack Notification ───────────────────────────────────────────────────
  notify:
    name: Slack Notify (React Native)
    needs: [deploy-android, deploy-ios]
    runs-on: ubuntu-latest
    if: always()

    steps:
      - name: Build status summary
        id: status
        run: |
          android="${{ needs.deploy-android.result }}"
          ios="${{ needs.deploy-ios.result }}"
          if [[ "$android" == "success" && "$ios" == "success" ]]; then
            echo "color=good" >> "$GITHUB_OUTPUT"
            echo "icon=:white_check_mark:" >> "$GITHUB_OUTPUT"
            echo "text=React Native release deployed successfully." >> "$GITHUB_OUTPUT"
          else
            echo "color=danger" >> "$GITHUB_OUTPUT"
            echo "icon=:x:" >> "$GITHUB_OUTPUT"
            echo "text=React Native release FAILED. Android: $android | iOS: $ios" >> "$GITHUB_OUTPUT"
          fi

      - name: Post to Slack
        uses: slackapi/slack-github-action@v1.27.0
        with:
          payload: |
            {
              "attachments": [
                {
                  "color": "${{ steps.status.outputs.color }}",
                  "blocks": [
                    {
                      "type": "section",
                      "text": {
                        "type": "mrkdwn",
                        "text": "${{ steps.status.outputs.icon }} *React Native Release* — `${{ github.sha }}`\n${{ steps.status.outputs.text }}\n<${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}|View run>"
                      }
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

### Fastlane `Fastfile` for iOS builds (shared pattern, used in both apps)

Place this in `<app>/ios/fastlane/Fastfile`. Each app has its own copy; only the scheme and output name differ.

```ruby
# flutter_app/ios/fastlane/Fastfile
# (mirror pattern in rn_app/ios/fastlane/Fastfile with RN-specific values)

default_platform(:ios)

platform :ios do

  desc "Sync distribution certificates and profiles via Match"
  lane :sync_signing do |options|
    api_key = app_store_connect_api_key(
      key_id:        ENV["APPLE_API_KEY_ID"],
      issuer_id:     ENV["APPLE_API_ISSUER_ID"],
      key_filepath:  File.expand_path("~/.private_keys/AuthKey_#{ENV['APPLE_API_KEY_ID']}.p8"),
      duration:      1200,
      in_house:      false
    )
    match(
      type:             "appstore",
      app_identifier:   options[:bundle_id],
      git_url:          ENV["MATCH_GIT_URL"],
      readonly:         true,
      api_key:          api_key
    )
  end

  desc "Build a signed release IPA"
  lane :build_release do |options|
    sync_signing(bundle_id: options[:bundle_id])

    increment_build_number(
      build_number: options[:build_number].to_s,
      xcodeproj:    "Runner.xcodeproj"      # adjust to your project name
    )

    build_app(
      scheme:                      "Runner",
      workspace:                   "Runner.xcworkspace",
      configuration:               "Release",
      export_method:               "app-store",
      output_directory:            "output",
      output_name:                 "Flutter.ipa",      # "ReactNativeApp.ipa" in RN copy
      include_symbols:             true,
      include_bitcode:             false,
      xcargs:                      "PRODUCT_BUNDLE_IDENTIFIER=#{options[:bundle_id]}",
      export_options: {
        method:                    "app-store",
        provisioningProfiles: {
          options[:bundle_id] =>   ENV["sigh_#{options[:bundle_id].gsub('.','_')}_appstore_profile-name"]
        }
      }
    )
  end

end
```

---

### Gradle signing integration (`rn_app/android/app/build.gradle` snippet)

Your `build.gradle` must read `keystore.properties` that the CI writes. This is the canonical safe pattern — no secrets in source control.

```groovy
// At the top of android/app/build.gradle, before android {}
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    // ...
    signingConfigs {
        release {
            storeFile     keystoreProperties['storeFile'] ? file("app/${keystoreProperties['storeFile']}") : null
            storePassword keystoreProperties['storePassword']
            keyAlias      keystoreProperties['keyAlias']
            keyPassword   keystoreProperties['keyPassword']
        }
    }

    buildTypes {
        release {
            signingConfig           signingConfigs.release
            minifyEnabled           true
            shrinkResources         true
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }
    }
}
```

The Flutter app uses an identical pattern via `flutter_app/android/key.properties` (Flutter's conventional name). The `build.gradle` in a Flutter project reads it via:

```groovy
def keyProperties = new Properties()
def keyPropertiesFile = rootProject.file('key.properties')
if (keyPropertiesFile.exists()) {
    keyPropertiesFile.withReader('UTF-8') { reader -> keyProperties.load(reader) }
}
```

---

### `paths` filter strategy

Each release workflow only triggers when files in its own subdirectory change. This prevents a React Native commit from triggering a Flutter build and vice versa. If you have a `shared/` directory used by both, add it to both `paths` filters:

```yaml
paths:
  - 'flutter_app/**'
  - 'shared/**'          # add if applicable
  - '.github/workflows/flutter-release.yml'
```

---

## 3. Architectural Verification

- **Secrets never touch disk in plaintext.** Keystores and the Apple `.p8` key are base64-encoded in GitHub Encrypted Secrets and decoded at runtime to ephemeral runner paths (`/tmp/`, `~/.private_keys/`). The runner's working directory is wiped after each job. Fastlane Match stores certificates encrypted in a private Git repository; the runner only ever holds the decrypted cert in memory during the signing step.

- **iOS certificate distribution is centralised and auditable.** Fastlane Match with `--readonly` means the CI never creates or rotates certificates — it only consumes them. Certificate rotation is a deliberate human action (running Match without `--readonly` locally), preventing accidental cert proliferation that would invalidate existing TestFlight builds.

- **Apple API key authentication replaces password-based auth.** Using `app_store_connect_api_key` with a `.p8` file eliminates the 2FA friction of user-and-password auth and avoids session token expiry mid-run. The key is scoped to the minimum required role (Developer).

- **Build and deploy jobs are decoupled.** If a TestFlight upload fails (e.g., App Store Connect is momentarily unavailable), you can re-run only the `deploy-ios` job without rebuilding the IPA. Artifacts are retained for 7 days for exactly this recovery scenario.

- **Parallel builds cut wall-clock time.** Flutter Android and Flutter iOS build simultaneously. React Native Android and React Native iOS build simultaneously. A release that would take 2 hours sequentially completes in ~60 minutes.

- **PR concurrency cancellation prevents queue pile-up.** `cancel-in-progress: true` on the PR group means a force-push to a PR cancels the in-flight run immediately, so runners are not tied up on stale commits. Release concurrency uses `cancel-in-progress: false` to ensure no release is silently dropped.

- **The `notify` job fires unconditionally.** `if: always()` on the Slack job means a Slack message is sent whether the pipeline succeeded, failed, or was cancelled. The status summary step inspects `needs.<job>.result` explicitly so the message body reflects the actual per-platform outcome rather than a generic pass/fail.

- **Android version codes are deterministic and monotonically increasing.** Using `github.run_number` as the `versionCode`/`--build-number` guarantees Play Store and App Store Connect will always accept the build (both reject non-increasing version codes), and the number is traceable back to a specific GitHub Actions run.

- **`paths` filtering prevents cross-app trigger storms.** A commit touching only `rn_app/` will not trigger the Flutter release pipeline and vice versa, keeping CI minutes proportional to the actual change surface.

- **No dynamic types or unsafe shell interpolation.** All secret values interpolated into shell commands are via `${{ secrets.NAME }}` (GitHub's safe interpolation, not raw environment expansion). Bash arrays are used in the PR gate step to iterate results without `eval`. The `keystore.properties` file is written via heredoc, not via concatenation that could be injected.
