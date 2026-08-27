# CosStage Forwarded macOS Build Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Use the SSH endpoint forwarded through `aliyun:2222` to build and verify an unsigned test DMG on the actual Mac, then retain the artifact on the Ubuntu relay.

**Architecture:** Windows connects directly to the forwarded Mac with `ProxyJump=aliyun`; `aliyun` carries the SSH stream but does not initiate the authenticated Mac session. Windows produces a source archive from the reviewed unstaged workspace and transfers it over that direct connection. The final Electron Builder step runs natively on macOS with signing discovery explicitly disabled. No source is pushed and no Apple credentials are requested for this test artifact.

**Tech Stack:** OpenSSH, Node 22, npm, Electron 40, electron-builder 26, macOS `hdiutil`, `codesign`, and `spctl`.

**Git constraint:** Do not run `git add`, `git commit`, or `git push`. Transfer the reviewed working tree as an archive so unstaged feature changes are included without creating a commit.

---

## Task 1: Complete and Verify the Direct ProxyJump Mac Login

**Files:**

- Windows identity: `C:\Users\13355\.ssh\id_ed25519`.
- Remote Mac authorization: `/Users/witchone/.ssh/authorized_keys`.

- [x] **Step 1: Prove interactive direct login**

Run from Windows and enter the Mac password locally, never in chat:

```powershell
ssh -J aliyun -p 2222 witchone@127.0.0.1
```

Expected: a macOS shell prompt for `witchone`.

- [x] **Step 2: Authorize the existing Windows Ed25519 public key**

From the authenticated Mac shell, append the exact contents of `C:\Users\13355\.ssh\id_ed25519.pub` only if absent, then apply `0700` to `.ssh` and `0600` to `authorized_keys`. Verify the local key fingerprint is `SHA256:QpkKnuCtwFhm+R/dKbSVw5XVuNFya5Q8u0ZrYosLkiw` before authorization.

- [x] **Step 3: Pin the already-observed forwarded host key**

Use a dedicated known-hosts file on `aliyun` and verify the forwarded endpoint still presents ED25519 fingerprint `SHA256:t9iUuSSppmvx8NFU+RXQ+wGl+JnCUSDlfpgsXNOHr5M`. Abort on mismatch.

- [x] **Step 4: Verify non-interactive login and platform**

From Windows, run SSH with ProxyJump and the authorized Ed25519 identity, then print only:

```bash
sw_vers
uname -m
id -un
node --version || true
npm --version || true
xcode-select -p || true
```

Verified: macOS 26.2, user `witchone`, architecture `arm64`, and Node 20.20.0/npm 10.8.2 through NVM. Use `zsh -lic` for every Node build command because Node is intentionally absent from the default non-interactive SSH PATH.

## Task 2: Add and Test a Deterministic macOS Build Script

**Files:**

- Modify: `package.json`
- Create/modify: `tests/macos-packaging.test.mjs`

- [ ] **Step 1: Write the failing packaging test**

Assert `package.json` exposes:

```json
"build:electron:mac:test": "npm run build:main && npm run build && electron-builder --mac dmg --config electron-builder.config.cjs --publish never"
```

Also assert the builder config keeps `appId`, `productName`, `mac.icon`, DMG target, `dist-electron/preload.cjs`, and sandboxed preload allowlisting intact.

- [ ] **Step 2: Verify RED**

Run `node --test tests/macos-packaging.test.mjs`; expected FAIL because the dedicated script is absent.

- [ ] **Step 3: Add the script and verify GREEN**

Add only the script above, then run the focused test, Electron typecheck, and production Vite build.

## Task 3: Transfer the Reviewed Working Tree Without Git Writes

**Files:**

- Temporary Windows archive outside tracked source.
- New Mac directory under `/Users/witchone/CosStage-builds/`.

- [ ] **Step 1: Create a deterministic source archive**

Archive the reviewed workspace while excluding `.git`, `.worktrees`, `node_modules`, `dist`, `dist-electron`, `release`, backend caches, `.env`, logs, and secrets. Include untracked task/code files.

- [ ] **Step 2: Hash and transfer directly through ProxyJump**

Use `scp -o ProxyJump=aliyun -P 2222` with the authorized Windows identity. Record SHA-256 locally and on the Mac; abort if they differ.

- [ ] **Step 3: Extract into a unique Mac build directory**

Create a new timestamped build directory; never overwrite or recursively delete an existing build. Verify the archive SHA-256 on macOS before extracting.

## Task 4: Install, Build Natively, and Verify the DMG

**Files:**

- Mac build directory created in Task 3.
- Output: `release/*.dmg`.

- [ ] **Step 1: Install from the lockfile**

Run `npm ci`. Expected: clean install from `package-lock.json`; do not fall back to `npm install` on lock mismatch.

- [ ] **Step 2: Run baseline checks on the Mac**

Run:

```bash
npm run typecheck
npm run test:desktop
npm run build
```

Stop on any failure instead of producing an unverified package.

- [ ] **Step 3: Build the native architecture DMG without ambient signing**

Run:

```bash
CSC_IDENTITY_AUTO_DISCOVERY=false npm run build:electron:mac:test -- --$(uname -m | sed 's/x86_64/x64/')
```

If shell argument forwarding does not place the architecture flag correctly, invoke the equivalent `npx electron-builder --mac dmg --arm64|--x64 --config electron-builder.config.cjs --publish never` after the already-passed renderer/main builds.

- [ ] **Step 4: Verify artifact structure**

Run `hdiutil verify`, mount the DMG read-only, confirm `CosStage.app`, inspect `Info.plist` bundle ID/version, verify the app executable architecture with `lipo -info`, and confirm the packaged preload exists. Record that signing/notarization is absent and the artifact is test-only.

- [ ] **Step 5: Launch smoke test when a GUI session is available**

Open the mounted app, confirm the main window renders, project manager detection uses the Electron preload, and startup logs contain no preload or renderer error. If the SSH session has no GUI user session, report that launch validation remains pending instead of claiming success.

## Task 5: Retain the Artifact on `aliyun`

**Files:**

- New relay directory: `/root/cosstage-mac-builds/<version>-<arch>-<timestamp>/`.

- [ ] **Step 1: Copy the DMG and verification report to the relay**

From the Mac, use the existing reverse-tunnel route or from Windows download through ProxyJump and upload to `aliyun`. Use a new unique relay directory. Include SHA-256, Mac version/architecture, Node version, build command, signing status, `hdiutil` result, and launch-test result.

- [ ] **Step 2: Verify the relay copy**

Compare Mac and relay SHA-256 values byte-for-byte.

- [ ] **Step 3: Report the exact relay path**

Leave both source and artifact directories intact unless the user explicitly authorizes cleanup.
