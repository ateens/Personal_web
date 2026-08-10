#!/bin/zsh
set -euo pipefail

SCRIPT_DIR=${0:A:h}
REPO_ROOT=${SCRIPT_DIR:h:h}
CONFIGURATION=${1:-release}
XCODE_CONFIGURATION=${(C)CONFIGURATION}
SIGNING_IDENTITY=${SYGMA_CODESIGN_IDENTITY:-$(security find-identity -v -p codesigning | sed -nE 's/^[[:space:]]*[0-9]+\) ([0-9A-F]{40}) .*/\1/p' | sed -n '1p')}
if [[ -z "$SIGNING_IDENTITY" ]]; then
    print -u2 'A valid macOS code-signing identity is required for WidgetKit.'
    exit 1
fi
ARCHIVE="$REPO_ROOT/.build/SYGMA-macOS.zip"
ICON_SOURCE="$REPO_ROOT/ios/SYGMA/SYGMA/Assets.xcassets/AppIcon.appiconset/AppIcon.png"
ICON_WORK_DIR=$(mktemp -d /tmp/sygma-icon.XXXXXX)
ICONSET_DIR="$ICON_WORK_DIR/SYGMA.iconset"
BUNDLE_WORK_DIR=$(mktemp -d /tmp/sygma-bundle.XXXXXX)
STAGED_APP="$BUNDLE_WORK_DIR/SYGMA.app"
WIDGET_BUILD_DIR=$(mktemp -d /tmp/sygma-widget.XXXXXX)
SWIFT_BUILD_DIR=$(mktemp -d /tmp/sygma-swift.XXXXXX)
WIDGET_EXTENSION="$WIDGET_BUILD_DIR/Build/Products/$XCODE_CONFIGURATION/SYGMAWidget.appex"

cleanup() { rm -rf "$ICON_WORK_DIR" "$BUNDLE_WORK_DIR" "$WIDGET_BUILD_DIR" "$SWIFT_BUILD_DIR" }
trap cleanup EXIT

swift build --package-path "$REPO_ROOT" --scratch-path "$SWIFT_BUILD_DIR" -c "$CONFIGURATION" --product SYGMAMac
BIN_DIR=$(swift build --package-path "$REPO_ROOT" --scratch-path "$SWIFT_BUILD_DIR" -c "$CONFIGURATION" --show-bin-path)
xcodebuild -quiet \
    -project "$REPO_ROOT/ios/SYGMA/SYGMA.xcodeproj" \
    -scheme SYGMAWidget \
    -configuration "$XCODE_CONFIGURATION" \
    -sdk macosx \
    -derivedDataPath "$WIDGET_BUILD_DIR" \
    SUPPORTED_PLATFORMS=macosx \
    SDKROOT=macosx \
    MACOSX_DEPLOYMENT_TARGET=14.0 \
    PRODUCT_BUNDLE_IDENTIFIER=com.sygma.native.mac.widget \
    MARKETING_VERSION=2.3 \
    CURRENT_PROJECT_VERSION=6 \
    CODE_SIGNING_ALLOWED=NO \
    build

mkdir -p "$STAGED_APP/Contents/MacOS" "$STAGED_APP/Contents/Resources" "$STAGED_APP/Contents/PlugIns"
cp "$BIN_DIR/SYGMAMac" "$STAGED_APP/Contents/MacOS/SYGMAMac"
cp "$SCRIPT_DIR/Info.plist" "$STAGED_APP/Contents/Info.plist"
cp -R "$WIDGET_EXTENSION" "$STAGED_APP/Contents/PlugIns/SYGMAWidget.appex"

mkdir -p "$ICONSET_DIR"
for size in 16 32 128 256 512; do
    sips -z $size $size "$ICON_SOURCE" --out "$ICONSET_DIR/icon_${size}x${size}.png" >/dev/null
    doubled=$((size * 2))
    sips -z $doubled $doubled "$ICON_SOURCE" --out "$ICONSET_DIR/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET_DIR" -o "$STAGED_APP/Contents/Resources/SYGMA.icns"

# Sign and verify outside iCloud Drive, whose file provider can add Finder
# metadata to an app bundle while codesign is reading it.
/usr/bin/xattr -cr "$STAGED_APP"
codesign --force --sign "$SIGNING_IDENTITY" --entitlements "$SCRIPT_DIR/SYGMAWidget.entitlements" "$STAGED_APP/Contents/PlugIns/SYGMAWidget.appex"
codesign --force --sign "$SIGNING_IDENTITY" --entitlements "$SCRIPT_DIR/SYGMAMac.entitlements" "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"

mkdir -p "$REPO_ROOT/.build"
rm -f "$ARCHIVE"
COPYFILE_DISABLE=1 ditto -c -k --keepParent "$STAGED_APP" "$ARCHIVE"

print "$ARCHIVE"
