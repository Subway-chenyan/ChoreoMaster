# Electron Packaging Contracts

## Scenario: Windows application icons

### 1. Scope / Trigger

- Applies when changing Electron Builder configuration, application icons, or packaged file locations.

### 2. Signatures

- Builder config: `win.icon = 'build/icon.ico'`
- Runtime icon: `app.isPackaged ? path.join(path.dirname(process.execPath), 'icon.png') : developmentPath`

### 3. Contracts

- `build/icon.ico` is the Windows executable, installer, and uninstaller icon.
- `build/icon.png` is copied beside the packaged executable as `icon.png`.
- `signAndEditExecutable` must not be `false`; Electron Builder must edit executable resources.
- Keep the existing `appId` stable during a product-name rebrand so installed copies continue upgrading in place.

### 4. Validation & Error Matrix

- `signAndEditExecutable: false` -> packaged exe keeps the default Electron icon.
- Missing packaged `icon.png` -> the explicit `BrowserWindow` icon path is invalid.
- Missing ICO sizes -> Windows shell may display a low-quality icon at some scales.

### 5. Good/Base/Bad Cases

- Good: packaged exe icon is extracted and visually matches the branded public icon.
- Base: development window loads `build/icon.png`.
- Bad: only browser/PWA icons are updated while `build/icon.ico` remains unchanged.

### 6. Tests Required

- Assert `win.icon` points to `build/icon.ico`.
- Assert `signAndEditExecutable: false` is absent.
- Assert packaged runtime icon resolves beside `process.execPath`.
- Build with Electron Builder and extract the generated exe icon for final verification.

### 7. Wrong vs Correct

#### Wrong

```javascript
win: {
  icon: 'build/icon.ico',
  signAndEditExecutable: false,
}
```

#### Correct

```javascript
win: {
  icon: 'build/icon.ico',
}
```

## Scenario: Governed web and desktop releases

### 1. Scope / Trigger

- Applies when changing Changesets, `.github/workflows/web-deploy.yml`, `.github/workflows/desktop-release.yml`, `.github/workflows/desktop-rollback.yml`, Electron Builder metadata, COS publication, CDN verification, or GitHub Release repair.

### 2. Signatures

- Aggregate version command: `npm run version-packages`.
- Local unsigned gate: `npm run release:dry-run`.
- Published index commands:
  - `node scripts/release/published-index.mjs publish <history> <existing> <version> <output>`
  - `node scripts/release/published-index.mjs rollback <existing> <version> <output>`
- Immutable objects: versioned installer, blockmap, SHA-256 sidecar, Builder `latest.yml`, and release notes.
- Mutable pointers, in commit order: `downloads/CosStage-Setup-x64.exe`, `downloads/releases.json`, `downloads/latest.yml`.
- Production secrets: `TENCENT_SECRET_ID`, `TENCENT_SECRET_KEY`, `CSC_LINK`, `CSC_KEY_PASSWORD`.
- Production variable: `WINDOWS_PUBLISHER_NAME`.
- Temporary unsigned build environment: `CSC_IDENTITY_AUTO_DISCOVERY=false` and `COSSTAGE_REQUIRE_CODE_SIGNING=false`.
- Temporary unsigned verification: `verify-windows-signature.ps1` receives `AllowUnsigned = $true` and no expected publisher.

### 3. Contracts

- Product changes add a Changeset; internal-only changes use the `release:none` PR label. Do not change package versions on feature branches.
- Changesets maintain one aggregate Release PR. Only a human-approved merge of that Release PR authorizes a desktop production release.
- Quality checks run automatically on pushes to every repository branch, including `changeset-release/main`; do not rely on manual approval of a bot-created pull-request workflow run.
- Web deployment is independent from desktop version publication. Ordinary `main` commits may deploy the web build without creating a desktop tag or moving desktop pointers.
- Desktop publication and manual rollback share the `desktop-release-stable` concurrency group with cancellation disabled.
- A push to `main` authorizes automated Web and desktop publication without an Environment approval pause. Repository secrets supply deployment credentials; `publish` and `repair-release` still require `refs/heads/main`. Manual rollback remains protected by the `production` Environment.
- The COS bucket versioning state must be `Closed`. Authenticated preflight must fail before the first write if that state cannot be proven.
- Versioned objects are create-only and immutable. A same-name object is reusable only when its complete SHA-256 matches.
- Publish mutable pointers in alias -> index -> root `latest.yml` order. This sequence is recoverable but is not a multi-object transaction.
- Public verification compares complete SHA-256 values before creating a tag or GitHub Release.
- Manual rollback changes `stableVersion` and the three stable pointers only. It preserves `currentVersion`, versioned objects, tags, and releases; it never auto-downgrades clients already running a higher version.
- Pin third-party GitHub Actions to reviewed commit SHAs and verify downloaded CLIs by exact version and checksum.
- A human-authorized temporary unsigned release must be explicit and deterministic: disable certificate auto-discovery, omit every signing secret and publisher reference from the workflow, pass `AllowUnsigned` only at the signature-verification boundary, and disclose the Windows "Unknown publisher" warning in release documentation and the Changeset. Restore the normal fail-closed signing contract as soon as a trusted Authenticode certificate is available.

### 4. Validation & Error Matrix

- Missing or invalid Changeset intent -> fail pull-request quality checks.
- Package, lock, structured history, or changelog disagree -> fail release-data validation; generated notes are produced by `version-packages` and covered by release tests plus human review.
- Signing certificate missing, signature invalid, or publisher different from `WINDOWS_PUBLISHER_NAME` -> fail before artifact upload.
- Temporary unsigned mode still references `CSC_LINK`, `CSC_KEY_PASSWORD`, or `WINDOWS_PUBLISHER_NAME` -> fail the workflow contract test; do not allow ambient credentials to change artifact identity.
- Unsigned artifact without the explicit `AllowUnsigned` verifier flag -> fail before artifact upload.
- COS bucket versioning is not `Closed` or the state is unreadable -> fail before every production write.
- COS CLI missing-object probes must capture stdout and stderr together because v1.0.8 can emit `cos object not found:<key>` on stdout. Match that exact diagnostic as missing; all other read failures remain fail-closed.
- Existing immutable object has a different hash -> stop; never overwrite or delete it.
- Pointer/public verification fails while the signed artifact is retained -> use **Re-run failed jobs** in the original workflow run so the same artifact is reused.
- Signed artifact expired before a tag exists -> do not rebuild the same version. Roll back only when the prior stable index and all historical artifacts are complete; otherwise enter incident recovery and publish a higher Patch.
- Tag exists but GitHub Release is absent or incomplete -> run detection again and enter `repair-release`; do not rebuild or rewrite COS history.
- Legacy `sw.js` or `manifest.webmanifest` remains reachable but the current build does not reference it -> report diagnostically and continue.

### 5. Good/Base/Bad Cases

- Good: a human merges the aggregate Release PR; CI signs once, validates Builder metadata, writes immutable objects, converges the three pointers, verifies the public CDN, creates the tag/Release, and then deploys the web guide.
- Good temporary exception: CI explicitly disables signing discovery, verifies `NotSigned`, publishes release notes that warn about "Unknown publisher", and retains the same immutable-object protections.
- Base: a non-version `main` commit deploys the web build while desktop release detection skips publication.
- Bad: a failed publish is retried with **Re-run all jobs**, producing a differently timestamped signed installer for an already-created immutable version.

### 6. Tests Required

- Release tests validate Changeset intent, aggregate version output, structured history, and explicit `publish`/`rollback` CLI subcommands.
- Workflow tests parse YAML and assert pinned action SHAs, production/main gates, shared concurrency, verified Tencent CLIs, authenticated COS reads, pointer order, and absence of destructive tag/object deletion.
- COS publication tests emit the real stdout-only `cos object not found:<key>` diagnostic and prove that fresh immutable creation succeeds while access errors still abort before writes.
- While the temporary unsigned exception is active, workflow tests assert both unsigned environment flags, `AllowUnsigned`, and the complete absence of signing secret or publisher expressions.
- Artifact tests validate Builder SHA-512, size, blockmap, exact ProductVersion, Authenticode publisher, and explicit unsigned-only local mode.
- Publish tests cover fresh creation, same-hash reuse, uncertain-create recovery, mismatched immutable failure, public verification failure, and temp cleanup.
- Deployment tests prove the current web hash is public and treat legacy PWA URLs as diagnostics only.
- Run `npm run release:dry-run` on Windows and simulate the aggregate Release PR in a clean clone before allowing the first governed release.

### 7. Wrong vs Correct

#### Wrong

```yaml
# An empty signing configuration fails late and can vary with ambient runner credentials.
env:
  COSSTAGE_REQUIRE_CODE_SIGNING: 'true'
  COSSTAGE_WINDOWS_PUBLISHER_NAME: ${{ vars.WINDOWS_PUBLISHER_NAME }}
```

#### Correct

```yaml
# Temporary exception only; restore enforced signing when a trusted certificate exists.
env:
  CSC_IDENTITY_AUTO_DISCOVERY: 'false'
  COSSTAGE_REQUIRE_CODE_SIGNING: 'false'
```

```powershell
$signatureArgs = @{ AllowUnsigned = $true }
```

#### Wrong

```bash
# Rebuilds and re-signs a version after immutable publication has started.
gh workflow run desktop-release.yml --ref main

# Treats a legacy fallback URL as the source of truth.
wait_until_unreachable "${CDN_URL}sw.js" "Legacy sw.js"
```

#### Correct

```text
Open the original Desktop Release run and choose Re-run failed jobs.
Reuse the retained signed artifact; stop if its immutable hash differs.
```

```bash
grep -R -n -E 'sw\.js|manifest\.webmanifest|navigator\.serviceWorker|serviceWorker\.register' dist && exit 1
report_legacy_url "${CDN_URL}sw.js" "Legacy sw.js"
```

## Scenario: Legacy 1.0.0 update onboarding

### 1. Scope / Trigger

- Applies to the first governed `1.1.0` startup and any change to post-upgrade release notes or update preferences.

### 2. Signatures

- Preference key: `cosstage:update:last-seen-version`.
- Decision helper: `shouldShowWhatsNew(currentVersion: string, lastSeenVersion: string | null): boolean`.
- First governed version: `1.1.0`.

### 3. Contracts

- Production `1.0.0` never wrote the last-seen key. When `1.1.0` starts with a missing key, show the bundled `1.1.0` release entry and write the key only after acknowledgement.
- This bootstrap exception is limited to `1.1.0`. A later fresh install with no key initializes its current version without showing historical release notes.
- A valid lower last-seen version shows the current release. Equal or higher values do not show it and must not be overwritten by a downgrade.
- A malformed stored version cannot suppress the current release. If the bundled current release entry is missing, leave the preference unchanged so the next startup can retry.

### 4. Validation & Error Matrix

- `current=1.1.0`, key missing -> show `1.1.0`; do not initialize early.
- `current>1.1.0`, key missing -> initialize current; do not show historical entries.
- `current>lastSeen` -> show current entry and persist only on acknowledgement.
- `current<=lastSeen` -> do not show; preserve the stored higher/equal value.
- Invalid current SemVer -> do not show.
- Invalid stored SemVer -> show the valid current release.

### 5. Good/Base/Bad Cases

- Good: a manually upgraded `1.0.0` user sees the `1.1.0` migration/update explanation once, acknowledges it, and does not see it again.
- Base: a clean future-version install seeds its current version without replaying old release notes.
- Bad: the component sees a missing key, writes `1.1.0`, and returns before evaluating the first-governed bootstrap rule.

### 6. Tests Required

- Unit tests cover missing-key behavior for `1.0.0`, `1.1.0`, and a later version, plus older/equal/higher/malformed stored values.
- Renderer regression asserts the display decision occurs before missing-key initialization.
- Packaged upgrade smoke uses an isolated profile with a missing key, verifies the `1.1.0` dialog is visible, acknowledges it, and verifies the stored value becomes `1.1.0`.

### 7. Wrong vs Correct

#### Wrong

```typescript
if (lastSeenVersion === null) {
  writeUpdatePreference(LAST_SEEN_VERSION_KEY, currentVersion);
  return;
}
```

#### Correct

```typescript
const showWhatsNew = shouldShowWhatsNew(currentVersion, lastSeenVersion);
if (!showWhatsNew && lastSeenVersion === null) {
  writeUpdatePreference(LAST_SEEN_VERSION_KEY, currentVersion);
}
```

## Scenario: Clean-checkout release determinism

### 1. Scope / Trigger

- Applies when adding POSIX release scripts, direct imports in tests/tooling, dependency updates, or checks that run from a Windows clone, linked worktree, CI runner, or temporary Release PR clone.

### 2. Signatures

- Shell attribute: `*.sh text eol=lf` in `.gitattributes`.
- Deterministic install: `npm ci`.
- Clean-clone sequence: `npm ci -> npm run version-packages -> npm test -> npm run build:electron:win`.
- Unsigned verification: `node scripts/release/verify-release-artifacts.mjs --allow-unsigned`.

### 3. Contracts

- Every `.sh` file is checked out with LF line endings, including when `core.autocrlf=true`; executable scripts retain mode `100755`.
- Tests and release tools must declare every package they import directly. Never rely on a dependency hoisted by Electron, Electron Builder, the parent repository of a linked worktree, or another transitive chain.
- The root package version and release history remain unchanged in the implementation worktree. Version generation and Changeset consumption run only in an isolated clone or the aggregate Release PR.
- Version-sensitive tests derive expectations from the synchronized package version and bundled history instead of hard-coding the pre-release version.
- `release:dry-run` invokes the artifact verifier directly with `--allow-unsigned`; do not depend on npm nested-script option forwarding.

### 4. Validation & Error Matrix

- Shell script contains CRLF after a Windows checkout -> fail before executing Bash.
- Shell script loses executable mode or fails `bash -n` -> fail release tests.
- A test imports an undeclared transitive package -> clean `npm ci` must fail the relevant test; add a direct dependency instead of changing Node resolution paths.
- `npm audit` reports a fixable vulnerability inside existing supported major ranges -> update the lock/declaration, then rebuild and retest.
- Versioned clone still expects the previous bundled version -> fix the test to derive expectations from release data without weakening the production validator.
- Unsigned verification succeeds without explicit `--allow-unsigned` -> security regression; fail the test.

### 5. Good/Base/Bad Cases

- Good: a `core.autocrlf=true` temporary clone installs from lock, aggregates Changesets, passes the full test suite, builds the expected versioned NSIS installer, and verifies matching installer/alias/sidecar hashes.
- Base: the real implementation worktree remains at the prior released version with unconsumed Changesets.
- Bad: tests pass only because Node walks from `.worktrees/<name>` into the parent repository's stale `node_modules` directory.

### 6. Tests Required

- Create an isolated Git fixture with `core.autocrlf=true`; assert shell bytes contain no CRLF, the shebang ends in LF, the index mode is `100755`, and `bash -n` succeeds.
- Assert direct test/tool imports such as archive checksum helpers are present in `package.json`.
- Run `npm audit` and `npm audit --omit=dev`; both must report zero known vulnerabilities after an approved dependency-security update.
- In a system temporary directory outside the repository tree, run the complete clean-clone sequence and verify package/lock/history versions, consumed Changesets, Builder output, unsigned gate, and SHA-256 equality.

### 7. Wrong vs Correct

#### Wrong

```javascript
// Passes only while another dependency happens to hoist this package.
import crc32 from 'buffer-crc32';
```

```json
{
  "scripts": {
    "release:dry-run": "npm run verify:release-artifacts -- --allow-unsigned"
  }
}
```

#### Correct

```json
{
  "devDependencies": {
    "buffer-crc32": "1.0.0"
  },
  "scripts": {
    "release:dry-run": "node scripts/release/verify-release-artifacts.mjs --allow-unsigned"
  }
}
```
