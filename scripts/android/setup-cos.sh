#!/usr/bin/env bash
set -euo pipefail
: "${TENCENT_SECRET_ID:?Missing GitHub secret TENCENT_SECRET_ID}"
: "${TENCENT_SECRET_KEY:?Missing GitHub secret TENCENT_SECRET_KEY}"
coscli_file="$(mktemp)"
trap 'rm -f -- "$coscli_file"' EXIT
curl -fsSL --retry 5 --retry-delay 3 \
  "https://github.com/tencentyun/coscli/releases/download/v1.0.8/coscli-v1.0.8-linux-amd64" \
  -o "$coscli_file"
printf '%s  %s\n' \
  '7165f2ae16c5f7ac495864c963ca574a76e04ec72680d7bc8a8eee3234d8cf91' \
  "$coscli_file" | sha256sum --check --strict
sudo install -m 0755 "$coscli_file" /usr/local/bin/coscli
python -m pip install --disable-pip-version-check tccli==3.1.128.1
coscli config add \
  --init-skip=true \
  -a production \
  -b beat-1317738912 \
  -r ap-guangzhou \
  -e cos.accelerate.myqcloud.com \
  -i "$TENCENT_SECRET_ID" \
  -k "$TENCENT_SECRET_KEY"
versioning_state="$(coscli bucket-versioning \
  --method get \
  cos://production \
  --secret-id "$TENCENT_SECRET_ID" \
  --secret-key "$TENCENT_SECRET_KEY" 2>&1)"
if ! grep -Fq 'bucket versioning status is Closed' <<< "$versioning_state"; then
  echo "Immutable release publishing requires COS bucket versioning to be Closed." >&2
  exit 1
fi
