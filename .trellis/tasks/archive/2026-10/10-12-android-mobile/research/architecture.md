# Architecture decision

Capacitor reuses the existing React editor and adds an Android native project, file sharing and lifecycle hooks. A Flutter rewrite would duplicate scene math, the project contract and all desktop behavior. A PWA alone would not produce the requested Android application. Choose Capacitor 8 with packaged local web assets and IndexedDB; keep desktop Electron APIs separate.

Sources: https://capacitorjs.com/docs ; https://capacitorjs.com/docs/getting-started/environment-setup ; https://capacitorjs.com/docs/apis/share ; https://capacitorjs.com/docs/apis/filesystem . Capacitor 8 requires Node 22+, Android Studio 2025.2.1+. Validate actual installed platform build files for SDK/JDK requirements.

ArrangeUs snapshot path evidence: ../arrus-import/reverse_arrangeus/flutter/APP_MODULES.md (224 application paths: scene view model, timeline, action menus, crews, formations, file import/export). Static assets inspected; no live interaction was executed. Borrow principles (stage-first editing, contextual actions and formation navigation); develop original CosStage UI/assets.

Preserve desktop ZIP layout (root project.json, assets/*); shared parser goes into electron/project-document.ts because it is pure TypeScript and already within Electron's build root. Browser storage gets no filesystem or Node dependency. Imported assets are blobs; object URLs exist only in runtime render copies. All risky archive and save boundaries need behavioral tests.
