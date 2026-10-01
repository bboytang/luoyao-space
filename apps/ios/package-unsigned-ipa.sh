#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: package-unsigned-ipa.sh <xcarchive> <output-directory>" >&2
  exit 2
fi

archive_path="$1"
output_dir="$2"
app_name="LuoyaoIOS.app"
app_path="$archive_path/Products/Applications/$app_name"
mkdir -p "$output_dir"
output_dir="$(cd "$output_dir" && pwd -P)"
ipa_path="$output_dir/LuoyaoIOS-unsigned-re-signable.ipa"

verify_app() {
  local app="$1"
  local plist="$app/Info.plist"
  test -d "$app"
  test -f "$plist"

  local bundle_id executable minimum_os package_type platform
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$plist")"
  executable="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$plist")"
  minimum_os="$(/usr/libexec/PlistBuddy -c 'Print :MinimumOSVersion' "$plist")"
  package_type="$(/usr/libexec/PlistBuddy -c 'Print :CFBundlePackageType' "$plist")"
  platform="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleSupportedPlatforms:0' "$plist")"

  test "$bundle_id" = "space.luoyao.ios"
  test "$minimum_os" = "17.0"
  test "$package_type" = "APPL"
  test "$platform" = "iPhoneOS"
  test -f "$app/$executable"
  file "$app/$executable" | grep -qE 'Mach-O.*arm64'
  xcrun vtool -show-build "$app/$executable" | grep -Eiq 'platform[[:space:]]+IOS([[:space:]]|$)'
  test ! -e "$app/embedded.mobileprovision"
  if codesign -d "$app" >/dev/null 2>&1; then
    echo "Expected an unsigned app, but a code signature is present" >&2
    exit 1
  fi
}

verify_app "$app_path"
stage_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir"' EXIT
mkdir -p "$stage_dir/Payload"
/usr/bin/ditto "$app_path" "$stage_dir/Payload/$app_name"
(
  cd "$stage_dir"
  /usr/bin/ditto -c -k --sequesterRsrc --keepParent Payload "$ipa_path"
)
unzip -tq "$ipa_path"
unzip -Z -1 "$ipa_path" | grep -q "^Payload/$app_name/Info.plist$"

extract_dir="$(mktemp -d)"
trap 'rm -rf "$stage_dir" "$extract_dir"' EXIT
unzip -q "$ipa_path" -d "$extract_dir"
verify_app "$extract_dir/Payload/$app_name"
echo "Verified unsigned device IPA: $ipa_path (space.luoyao.ios, iOS 17.0+)"
