# SYGMA for Mac

This is a minimal SwiftUI + WKWebView shell for the production SYGMA web app. It uses
the same responsive UI, authentication, navigation, persistent web storage, and live
PostgreSQL-backed data as the website.

The signed app also embeds the native `SYGMA Calendar` WidgetKit extension. It
provides the large four-week calendar and small, medium, or large Today Tasks widget.

The main window has no visible title bar or traffic-light buttons. Its invisible top
24-point strip remains draggable, while standard macOS keyboard shortcuts control the
window. Product UI changes and behavior tests belong to the web app; this target only
compiles and packages the shell.

## Build

```zsh
./macos/SYGMA/build-app.sh release
```

The output is `.build/SYGMA-macOS.zip`. The app is signed and verified before it is
archived. Extract it outside this iCloud-backed repository, or drag it to Applications;
iCloud Finder metadata can invalidate an unpacked app bundle left inside the repository.
The build uses the first valid local code-signing identity; set
`SYGMA_CODESIGN_IDENTITY` to override it.

## Verify and open

```zsh
verify_dir=$(mktemp -d /tmp/sygma-verify.XXXXXX)
ditto -x -k .build/SYGMA-macOS.zip "$verify_dir"
codesign --verify --deep --strict "$verify_dir/SYGMA.app"
open "$verify_dir/SYGMA.app"
```
