#!/usr/bin/env bash
# Prints the value for the API's APP_SIGNATURE_CHECKSUM, i.e. the Android Enterprise
# PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM: base64url (no padding) of the SHA-256 of the
# APK signing certificate (DER).
#
# Usage:
#   scripts/signature-checksum.sh                 # from the keystore (env MDM_* or keystore.properties)
#   scripts/signature-checksum.sh path/to/app.apk # from a signed APK (needs apksigner, Android build-tools)
#
# Environment / keystore.properties keys: MDM_KEYSTORE_PATH, MDM_KEYSTORE_PASSWORD, MDM_KEY_ALIAS.
# KEYTOOL / APKSIGNER may point at specific binaries.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"   # apps/android

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

if [ "${1:-}" != "" ]; then
  apk="$1"
  [ -f "$apk" ] || { echo "APK not found: $apk" >&2; exit 1; }
  apksigner="${APKSIGNER:-}"
  if [ -z "$apksigner" ]; then
    sdk="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
    if [ -z "$sdk" ] && [ -f "$here/local.properties" ]; then
      sdk="$(sed -n 's/^sdk\.dir=//p' "$here/local.properties")"
    fi
    apksigner="$(ls -d "$sdk"/build-tools/*/apksigner 2>/dev/null | sort -V | tail -1 || true)"
    [ -n "$apksigner" ] || apksigner="$(command -v apksigner || true)"
  fi
  [ -n "$apksigner" ] || { echo "apksigner not found: set APKSIGNER or ANDROID_HOME" >&2; exit 1; }
  hex="$("$apksigner" verify --print-certs "$apk" | sed -n 's/^Signer #1 certificate SHA-256 digest: //p' | head -1)"
  [ -n "$hex" ] || { echo "Could not read the signing certificate from $apk" >&2; exit 1; }
  printf '%s' "$hex" | xxd -r -p | b64url
  echo
  exit 0
fi

prop() {
  local name="$1" v="${!1:-}"
  if [ -z "$v" ] && [ -f "$here/keystore.properties" ]; then
    v="$(sed -n "s/^${name}=//p" "$here/keystore.properties" | head -1)"
  fi
  printf '%s' "$v"
}

ks="$(prop MDM_KEYSTORE_PATH)"
pw="$(prop MDM_KEYSTORE_PASSWORD)"
alias="$(prop MDM_KEY_ALIAS)"
[ -n "$ks" ] && [ -n "$pw" ] && [ -n "$alias" ] || {
  echo "Set MDM_KEYSTORE_PATH, MDM_KEYSTORE_PASSWORD and MDM_KEY_ALIAS (env or keystore.properties), or pass an APK." >&2
  exit 1
}
case "$ks" in /*) ;; *) ks="$here/$ks" ;; esac
[ -f "$ks" ] || { echo "Keystore not found: $ks" >&2; exit 1; }

keytool="${KEYTOOL:-}"
if [ -z "$keytool" ]; then
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/keytool" ]; then keytool="$JAVA_HOME/bin/keytool"
  elif [ -x "$here/../../.tools/jdk-17.0.21+9/Contents/Home/bin/keytool" ]; then keytool="$here/../../.tools/jdk-17.0.21+9/Contents/Home/bin/keytool"
  else keytool="$(command -v keytool)"; fi
fi

"$keytool" -exportcert -keystore "$ks" -storepass "$pw" -alias "$alias" \
  | openssl dgst -sha256 -binary | b64url
echo
