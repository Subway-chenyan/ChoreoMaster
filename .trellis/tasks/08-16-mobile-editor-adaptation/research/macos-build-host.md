# macOS Build Host Research

## Verified topology

- SSH alias `aliyun` reaches Ubuntu 24.04, Linux 6.8, x86_64.
- A service listens on `127.0.0.1:2222` on that server and presents SSH host keys.
- A Windows-side ProxyJump connection reaches the forwarded Mac directly: `ssh -J aliyun -p 2222 witchone@127.0.0.1`.
- Transport and host-key negotiation succeed. Initial key authentication failed because `~/.ssh/authorized_keys` on the Mac was a directory rather than an OpenSSH authorization file.
- The incorrectly shaped directory was preserved as `~/.ssh/authorized_keys.directory-backup-20260817-1410`. A correct mode-0600 authorization file now contains the existing Windows Ed25519 public key.
- Password authentication was used once for the repair and was not persisted. Windows ProxyJump key authentication now succeeds non-interactively.
- The host is `WitchOnedeMac-mini`, macOS 26.2 (build 25C56), Apple Silicon `arm64`, user `witchone`.
- Git 2.50.1, Python 3.9.6, Apple clang 17, `hdiutil`, `codesign`, and Xcode Command Line Tools are available.
- NVM provides Node 20.20.0 and npm 10.8.2 through `.zshrc`. Non-interactive SSH commands must use `zsh -lic` or explicitly source NVM because the default SSH environment does not include Node on PATH.
- A dedicated Ed25519 identity was created on the Ubuntu relay during the earlier topology assumption. It is not used by the corrected Windows ProxyJump path and is retained without further changes until cleanup is explicitly authorized.

Observed forwarded SSH host-key fingerprints:

- RSA: `SHA256:r9pyLWNRDz0kVOhJvSz37Za6My4btHFm41ymdQ5bdOI`
- ECDSA: `SHA256:2o91GYeFXlaFIAUSl6Zt/KT9dlZrE0SWJI8elHjQjWE`
- ED25519: `SHA256:t9iUuSSppmvx8NFU+RXQ+wGl+JnCUSDlfpgsXNOHr5M`

## Constraint

The Ubuntu host can relay source and commands, but a distribution-grade macOS artifact must be built, signed, and notarized on macOS. Electron and electron-builder documentation explicitly require macOS/Xcode for Apple signing workflows and warn against expecting every platform artifact to build correctly from one OS.

## Recommended paths

1. Selected and verified: connect directly from Windows with ProxyJump and the authorized Windows Ed25519 key, transfer the reviewed source over the same direct connection, then build on the Mac using an NVM-loaded login shell.
2. Alternative: add a manually triggered GitHub Actions job using a macOS runner and download the artifact. Apple certificates and notarization credentials stay in encrypted CI secrets if a signed release is later required.
3. If neither is available, finish Android and defer the macOS artifact rather than label an unreliable Ubuntu cross-build as a verified Mac package.

## Sources

- electron-builder multi-platform builds: https://www.electron.build/docs/features/multi-platform-build/
- Electron code signing: https://www.electronjs.org/docs/latest/tutorial/code-signing
- GitHub-hosted runners: https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job
