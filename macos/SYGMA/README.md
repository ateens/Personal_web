# SYGMA for Mac

This is a minimal SwiftUI + WKWebView shell for the production SYGMA web app. It uses
the same responsive UI, authentication, navigation, persistent web storage, and live
PostgreSQL-backed data as the website.

The signed app also embeds the native `SYGMA Calendar` WidgetKit extension. It
provides the large four-week calendar and small, medium, or large Today Tasks widget.

The main window has no visible title bar or traffic-light buttons. Its invisible top
24-point strip remains draggable. Use `⌘R` or **View > 새로고침** to save pending web
changes and then reload the current page.

## Quick Notes

Press `⌥⌘N` from any app to show or hide the always-on-top Notes panel. Notes use real
Markdown files in Application Support, render Markdown with `⌘⇧M` or the `T` button,
and keep pasted images inline as local PNG assets. Use `⌘N` for a new note, `⌘[` and
`⌘]` for previous/next, or `⌘1` through `⌘9` for direct selection. `Esc` hides the
panel. The app's **Notes** menu is the fallback if another app already owns `⌥⌘N`.

## Inbox 바로 추가

Press `⌥Space` from any app to open the Spotlight-style Inbox bar on the monitor under
the pointer without bringing the main SYGMA window forward. `Return` adds the text to
Inbox. `⌘Return` expands the same floating window for Task date, Box, and Project, then
`Return` creates the Task. Change either global shortcut in **SYGMA > Settings**.

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
