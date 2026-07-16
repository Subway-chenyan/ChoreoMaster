#!/usr/bin/env bash
set -euo pipefail

: "${VERSION:?VERSION is required}"
: "${CDN_URL:?CDN_URL is required}"
: "${INSTALLER_URL:?INSTALLER_URL is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${TENCENT_SECRET_ID:?TENCENT_SECRET_ID is required}"
: "${TENCENT_SECRET_KEY:?TENCENT_SECRET_KEY is required}"

if [[ ! "$VERSION" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "VERSION must be a strict x.y.z SemVer" >&2
  exit 1
fi
if [[ ! "$GITHUB_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "GITHUB_SHA must be a 40-character commit SHA" >&2
  exit 1
fi
case "$CDN_URL" in
  */) ;;
  *) echo "CDN_URL must end with /" >&2; exit 1 ;;
esac
if [ "$INSTALLER_URL" != "${CDN_URL}downloads/CosStage-Setup-x64.exe" ]; then
  echo "INSTALLER_URL must be the stable CosStage installer URL" >&2
  exit 1
fi

installer_name="CosStage-Setup-$VERSION-x64.exe"
installer_path="desktop/$installer_name"
blockmap_path="$installer_path.blockmap"
sidecar_path="$installer_path.sha256"
alias_path="desktop/CosStage-Setup-x64.exe"
latest_path="desktop/latest.yml"
notes_path="desktop/release-notes.md"

for required_file in \
  "$installer_path" \
  "$blockmap_path" \
  "$sidecar_path" \
  "$alias_path" \
  "$latest_path" \
  "$notes_path"; do
  if [ ! -f "$required_file" ] || [ ! -s "$required_file" ]; then
    echo "Required release file is missing or empty: $required_file" >&2
    exit 1
  fi
done
if [ ! -f releases.previous.json ]; then
  echo "Required release index input is missing: releases.previous.json" >&2
  exit 1
fi

expected_sha256="$(sha256sum "$installer_path" | awk '{print $1}')"
read -r sidecar_sha256 sidecar_name < "$sidecar_path"
if [ "$sidecar_sha256" != "$expected_sha256" ] || [ "$sidecar_name" != "$installer_name" ]; then
  echo "SHA-256 sidecar does not match $installer_name" >&2
  exit 1
fi
if [ "$(sha256sum "$alias_path" | awk '{print $1}')" != "$expected_sha256" ]; then
  echo "Stable installer alias does not match $installer_name" >&2
  exit 1
fi
if ! grep -Fxq "version: $VERSION" "$latest_path"; then
  echo "latest.yml does not declare version $VERSION" >&2
  exit 1
fi

temp_files=()
make_temp() {
  local -n destination="$1"
  destination="$(mktemp "${TMPDIR:-/tmp}/cosstage-release.XXXXXX")"
  temp_files+=("$destination")
}
cleanup() {
  if [ "${#temp_files[@]}" -gt 0 ]; then
    rm -f -- "${temp_files[@]}"
  fi
}
trap cleanup EXIT

upload_immutable() {
  local source="$1"
  local object="$2"
  local remote_file error_file source_hash remote_hash upload_output upload_status
  make_temp remote_file
  make_temp error_file
  source_hash="$(sha256sum "$source" | awk '{print $1}')"

  if coscli cp "cos://production/$object" "$remote_file" \
    --secret-id "$TENCENT_SECRET_ID" \
    --secret-key "$TENCENT_SECRET_KEY" \
    2>"$error_file"; then
    remote_hash="$(sha256sum "$remote_file" | awk '{print $1}')"
    if [ "$source_hash" != "$remote_hash" ]; then
      echo "Immutable object differs: $object" >&2
      exit 1
    fi
    return
  fi

  if ! grep -Eiq 'NoSuchKey|HTTP[^0-9]*404|status[^0-9]*404|not[[:space:]-]+found' "$error_file"; then
    cat "$error_file" >&2
    echo "Unable to check immutable COS object: $object" >&2
    exit 1
  fi

  set +e
  upload_output="$(coscli cp "$source" "cos://production/$object" \
    --secret-id "$TENCENT_SECRET_ID" \
    --secret-key "$TENCENT_SECRET_KEY" \
    --forbid-overwrite \
    --meta "Cache-Control:public,max-age=31536000,immutable" \
    2>&1)"
  upload_status="$?"
  set -e
  if [ "$upload_status" -eq 0 ]; then
    return
  fi

  : > "$remote_file"
  if ! coscli cp "cos://production/$object" "$remote_file" \
    --secret-id "$TENCENT_SECRET_ID" \
    --secret-key "$TENCENT_SECRET_KEY"; then
    printf '%s\n' "$upload_output" >&2
    echo "Unable to create or recover immutable COS object: $object" >&2
    exit 1
  fi
  remote_hash="$(sha256sum "$remote_file" | awk '{print $1}')"
  if [ "$source_hash" != "$remote_hash" ]; then
    printf '%s\n' "$upload_output" >&2
    echo "Immutable object differs after an uncertain create: $object" >&2
    exit 1
  fi
}

upload_immutable "$installer_path" "downloads/$installer_name"
upload_immutable "$blockmap_path" "downloads/$installer_name.blockmap"
upload_immutable "$sidecar_path" "downloads/$installer_name.sha256"
upload_immutable "$latest_path" "downloads/metadata/$VERSION/latest.yml"
upload_immutable "$notes_path" "downloads/release-notes-$VERSION.md"

node scripts/release/published-index.mjs \
  data/release-history.json \
  releases.previous.json \
  "$VERSION" \
  releases.next.json

coscli cp "$alias_path" "cos://production/downloads/CosStage-Setup-x64.exe" \
  --secret-id "$TENCENT_SECRET_ID" \
  --secret-key "$TENCENT_SECRET_KEY" \
  --meta "Cache-Control:public,max-age=300#Content-Disposition:attachment; filename=CosStage-Setup-x64.exe#Content-Type:application/vnd.microsoft.portable-executable"
coscli cp releases.next.json "cos://production/downloads/releases.json" \
  --secret-id "$TENCENT_SECRET_ID" \
  --secret-key "$TENCENT_SECRET_KEY" \
  --meta "Cache-Control:no-cache#Content-Type:application/json"
coscli cp desktop/latest.yml "cos://production/downloads/latest.yml" \
  --secret-id "$TENCENT_SECRET_ID" \
  --secret-key "$TENCENT_SECRET_KEY" \
  --meta "Cache-Control:no-cache#Content-Type:text/yaml"

tccli cdn PurgeUrlsCache \
  --secretId "$TENCENT_SECRET_ID" \
  --secretKey "$TENCENT_SECRET_KEY" \
  --region ap-guangzhou \
  --Urls "[\"${INSTALLER_URL}\",\"${CDN_URL}downloads/CosStage-Setup-${VERSION}-x64.exe\",\"${CDN_URL}downloads/CosStage-Setup-${VERSION}-x64.exe.blockmap\",\"${CDN_URL}downloads/CosStage-Setup-${VERSION}-x64.exe.sha256\",\"${CDN_URL}downloads/metadata/${VERSION}/latest.yml\",\"${CDN_URL}downloads/release-notes-${VERSION}.md\",\"${CDN_URL}downloads/releases.json\",\"${CDN_URL}downloads/latest.yml\"]" \
  --Area mainland

verify_public_release() {
  local attempt="$1"
  local downloaded_versioned_installer downloaded_alias downloaded_blockmap downloaded_sidecar
  local downloaded_metadata downloaded_notes downloaded_latest downloaded_index
  local versioned_url downloaded_sha256 query
  make_temp downloaded_versioned_installer
  make_temp downloaded_alias
  make_temp downloaded_blockmap
  make_temp downloaded_sidecar
  make_temp downloaded_metadata
  make_temp downloaded_notes
  make_temp downloaded_latest
  make_temp downloaded_index

  versioned_url="${CDN_URL}downloads/CosStage-Setup-${VERSION}-x64.exe"
  query="release=${GITHUB_SHA}&attempt=$attempt"
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_versioned_installer" \
    "${versioned_url}?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_alias" \
    "${INSTALLER_URL}?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_blockmap" \
    "${versioned_url}.blockmap?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_sidecar" \
    "${versioned_url}.sha256?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_metadata" \
    "${CDN_URL}downloads/metadata/${VERSION}/latest.yml?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_notes" \
    "${CDN_URL}downloads/release-notes-${VERSION}.md?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_latest" \
    "${CDN_URL}downloads/latest.yml?$query" || return 1
  curl -fsSL -H 'Cache-Control: no-cache' -o "$downloaded_index" \
    "${CDN_URL}downloads/releases.json?$query" || return 1

  downloaded_sha256="$(sha256sum "$downloaded_versioned_installer" | awk '{print $1}')"
  [ "$downloaded_sha256" = "$expected_sha256" ] || return 1
  [ "$(sha256sum "$downloaded_alias" | awk '{print $1}')" = "$expected_sha256" ] || return 1
  [ "$(sha256sum "$downloaded_blockmap" | awk '{print $1}')" = \
    "$(sha256sum "$blockmap_path" | awk '{print $1}')" ] || return 1
  [ "$(sha256sum "$downloaded_sidecar" | awk '{print $1}')" = \
    "$(sha256sum "$sidecar_path" | awk '{print $1}')" ] || return 1
  [ "$(sha256sum "$downloaded_metadata" | awk '{print $1}')" = \
    "$(sha256sum "$latest_path" | awk '{print $1}')" ] || return 1
  [ "$(sha256sum "$downloaded_notes" | awk '{print $1}')" = \
    "$(sha256sum "$notes_path" | awk '{print $1}')" ] || return 1
  [ "$(sha256sum "$downloaded_latest" | awk '{print $1}')" = \
    "$(sha256sum "$latest_path" | awk '{print $1}')" ] || return 1
  [ "$(sha256sum "$downloaded_index" | awk '{print $1}')" = \
    "$(sha256sum releases.next.json | awk '{print $1}')" ] || return 1
}

verify_attempts="${COSSTAGE_VERIFY_ATTEMPTS:-12}"
verify_delay="${COSSTAGE_VERIFY_DELAY:-5}"
if [[ ! "$verify_attempts" =~ ^[1-9][0-9]*$ ]] || [[ ! "$verify_delay" =~ ^[0-9]+$ ]]; then
  echo "Verification retry settings must be non-negative integers with at least one attempt" >&2
  exit 1
fi

verified=false
for ((attempt = 1; attempt <= verify_attempts; attempt += 1)); do
  if verify_public_release "$attempt"; then
    verified=true
    break
  fi
  if [ "$attempt" -lt "$verify_attempts" ]; then
    echo "Waiting for release CDN verification ($attempt/$verify_attempts)..." >&2
    sleep "$verify_delay"
  fi
done
if [ "$verified" != true ]; then
  echo "Public release verification failed after $verify_attempts attempt(s)" >&2
  exit 1
fi

git config user.name "cosstage-release-bot"
git config user.email "releases@cosstage.invalid"
git tag -a "v$VERSION" "$GITHUB_SHA" -m "CosStage $VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" \
  "$installer_path" \
  "$sidecar_path" \
  --title "CosStage $VERSION" \
  --notes-file "$notes_path"
