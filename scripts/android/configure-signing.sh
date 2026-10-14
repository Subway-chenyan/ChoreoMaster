#!/usr/bin/env bash
set -euo pipefail
# 在拥有此仓库 Secrets: read/write 权限的 gh 登录会话中执行。
repo="${1:-Subway-chenyan/ChoreoMaster}"
signing_dir="${2:-$HOME/.local/share/cosstage/android-signing}"
command -v gh >/dev/null || { echo '请先安装 GitHub CLI 并执行 gh auth login。' >&2; exit 1; }
for file in cosstage-release.p12 store-password.txt release-certificate.pem; do
  test -s "$signing_dir/$file" || { echo "Missing signing backup: $file" >&2; exit 1; }
done
expected="$(node -p 'require("./data/android-signing.json").certificateSha256')"
actual="$(openssl x509 -in "$signing_dir/release-certificate.pem" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d ':' | tr '[:upper:]' '[:lower:]')"
test "$actual" = "$expected" || { echo '签名证书与仓库固定指纹不一致。' >&2; exit 1; }
base64 < "$signing_dir/cosstage-release.p12" | gh secret set ANDROID_KEYSTORE_BASE64 --repo "$repo"
gh secret set ANDROID_KEYSTORE_PASSWORD --repo "$repo" < "$signing_dir/store-password.txt"
printf '%s' cosstage | gh secret set ANDROID_KEY_ALIAS --repo "$repo"
gh secret set ANDROID_KEY_PASSWORD --repo "$repo" < "$signing_dir/store-password.txt"
echo 'Android signing secrets configured. 请将整个签名备份目录另存到安全位置。'
