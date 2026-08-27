# Android Packaging Research

## Current project state

- CosStage uses a React/Vite renderer already shared with Electron.
- There is no native Android project or Capacitor dependency.
- Node 22.22.0 and JDK 17 are available on the Windows development machine.
- Android SDK command-line tools 19.0, platform tools 35.0.2, Android 34/35 platforms, build tools through 36.0.0, and an Android 36 Google Play x86_64 system image are installed under `C:\Users\13355\AppData\Local\Android\Sdk` but are not on PATH.
- No Android Virtual Device is configured yet.
- `.env.example` defaults `VITE_AI_BACKEND_URL` to `http://127.0.0.1:8000`. In an Android WebView, loopback resolves to the Android device, not the developer PC.

## Recommended MVP

Use Capacitor 8 as a thin Android shell around the existing Vite `dist` output. This preserves one React editor implementation and adds only the native project needed for Android lifecycle, insets, back behavior, WebView hosting, installation, and packaging. Capacitor 8 requires Node 22+, Android Studio 2025.2.1+, and an Android SDK; the command-line tooling already present is sufficient for the planned Gradle/ADB flow.

Use `@capacitor/app` for a native Android Back listener and `@capacitor/system-bars` for injected safe-area variables. Keep local HTTP access in the Android debug manifest only rather than enabling cleartext in the production Capacitor configuration.

The first artifact should be a debug APK. Android's Gradle `assembleDebug` flow signs the package with a debug key and is appropriate for direct emulator/device installation. Production signing and Play Store AAB publication are separate release tasks.

## Required verification

1. Create an AVD from the installed API 36 system image, or connect a physical Android device with USB debugging.
2. Build the Vite renderer and synchronize it into the Capacitor Android project.
3. Build and install a debug APK.
4. Exercise phone portrait and landscape, safe insets, tools drawer, compact/expanded timeline, Android back, soft keyboard, project persistence, and backend-unavailable messaging.
5. Record the APK path, emulator/device API level, and smoke-test outcome.

## Sources

- Capacitor documentation: https://capacitorjs.com/docs
- Capacitor environment setup: https://capacitorjs.com/docs/getting-started/environment-setup
- Capacitor App Back API: https://capacitorjs.com/docs/apis/app
- Capacitor configuration and System Bars inset handling: https://capacitorjs.com/docs/config
- Android command-line build documentation: https://developer.android.com/build/building-cmdline
- Android release preparation: https://developer.android.com/build/build-for-release
