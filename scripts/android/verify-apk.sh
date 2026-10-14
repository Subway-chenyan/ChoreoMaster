#!/usr/bin/env bash
set -euo pipefail
apk="$1"
channel="$2"
build_tools="${ANDROID_HOME:?}/build-tools/36.0.0"
version="$(node -p 'require("./package.json").version')"
code="$(node --input-type=module -e 'import {androidVersionCode} from "./scripts/android/release-contract.mjs"; console.log(androidVersionCode(process.argv[1]))' "$version")"
package="com.cosstage.mobile"
if [ "$channel" = preview ]; then package="$package.preview"; version="$version-preview"; fi
"$build_tools/apksigner" verify --verbose --print-certs "$apk" > apk-signature.txt
badging="$("$build_tools/aapt" dump badging "$apk")"
grep -Fq "package: name='$package' versionCode='$code' versionName='$version'" <<< "$badging"
if [ "$channel" = stable ]; then
  if grep -q 'application-debuggable' <<< "$badging"; then echo 'Release APK is debuggable' >&2; exit 1; fi
  certificate="$(node -p 'require("./data/android-signing.json").certificateSha256')"
  grep -Fqi "Signer #1 certificate SHA-256 digest: $certificate" apk-signature.txt
fi
