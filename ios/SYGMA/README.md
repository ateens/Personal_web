# SYGMA for iPhone

The iPhone app is a minimal SwiftUI + WKWebView shell for the production SYGMA web app.
All product UI and behavior live in the web app; the native target only provides web
storage, browser-based Google authentication, downloads, and WidgetKit refresh bridging.
The WidgetKit extension remains an independent native target.

## Run in Xcode

1. Install an iOS 17 or newer simulator runtime in Xcode Settings > Components.
2. Open `SYGMA.xcodeproj`.
3. Select the `SYGMA` scheme and an iPhone simulator.
4. Run with Command-R.

The app opens:

`https://personalweb-production-81a6.up.railway.app/`

## Install on a physical iPhone

1. Connect the iPhone to the Mac, unlock it, and trust the computer.
2. In Xcode, add the Apple ID under Settings > Accounts.
3. Select the SYGMA project, open Signing & Capabilities, choose the personal or paid Apple Developer team, and keep Automatically manage signing enabled.
4. If `com.ateens.sygma` is unavailable to that team, change the bundle identifier to a unique reverse-domain value.
5. Select the connected iPhone as the run destination and press Command-R.
6. If iOS requests it, enable Developer Mode under Settings > Privacy & Security and restart the phone.

A free Personal Team build is for direct development use and must be periodically re-signed. For stable installation across devices, beta distribution, or App Store release, use the paid Apple Developer Program.

## TestFlight / App Store

1. Create the matching App ID and app record in Apple Developer/App Store Connect.
2. Set the paid development team and final bundle identifier in Xcode.
3. Choose Any iOS Device, then Product > Archive.
4. In Organizer, validate and upload the archive to App Store Connect.
5. Add internal TestFlight testers, complete export-compliance and privacy answers, and submit the build for beta review if external testers are needed.
6. For App Store release, add screenshots, support/privacy URLs, age rating, review notes, and the production privacy labels before review submission.

This repository includes a 1024px app icon and `PrivacyInfo.xcprivacy`. The manifest declares linked Other User Content used for workspace sync. App Store privacy answers still need to describe the production server's real data handling, including any Railway request-log retention.

## Verification

Product behavior is tested in the web app with its npm and Playwright suites. Smoke-test
the iOS web shell and embedded widget by compiling the `SYGMA` scheme:

```bash
xcodebuild \
  -project SYGMA.xcodeproj \
  -scheme SYGMA \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /private/tmp/SYGMA-Derived \
  CODE_SIGNING_ALLOWED=NO \
  build
```
