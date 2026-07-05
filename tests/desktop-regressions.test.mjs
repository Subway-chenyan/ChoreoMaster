import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('tutorial example resolves beside the current document for packaged Electron', async () => {
  const source = await read('components/ProjectBrowser.tsx');
  assert.match(source, /new URL\('\.\/tutorial-project\.json', window\.location\.href\)/);
  assert.doesNotMatch(source, /fetch\('\/tutorial-project\.json'\)/);
});

test('project asset protocol forwards media request headers', async () => {
  const source = await read('electron/main.ts');
  assert.match(source, /request\.headers\.get\('range'\)/);
});

test('timeline height is the total panel height', async () => {
  const source = await read('components/Timeline.tsx');
  assert.match(source, /style=\{\{ height: heightPx \}\}/);
  assert.match(source, /const trackHeight = Math\.max\(84, heightPx - toolbarHeight\)/);
  assert.match(source, /ctx\.fillRect\(0, 0, (totalWidth|renderWidth), trackHeight\)/);
});

test('3D labels stay below application overlays', async () => {
  const [performer, prop] = await Promise.all([
    read('3d_components/Performer3D.tsx'),
    read('3d_components/Prop3D.tsx'),
  ]);

  assert.match(performer, /zIndexRange=\{\[40, 0\]\}/);
  assert.match(prop, /zIndexRange=\{\[40, 0\]\}/);
});

test('desktop export uses native binary save path and bounded recording waits', async () => {
  const [app, preload, ipc, offline] = await Promise.all([
    read('App.tsx'),
    read('electron/preload.ts'),
    read('electron/ipc-handlers.ts'),
    read('utils/OfflineRenderer3D.ts'),
  ]);

  assert.match(preload, /writeBinaryFile: \(filePath: string, content: Uint8Array\) => Promise<void>/);
  assert.match(ipc, /ipcMain\.handle\('fs:writeBinaryFile'/);
  assert.match(app, /const isDesktopElectron = Boolean\(window\.electronAPI\?\.isElectron\)/);
  assert.match(app, /const hasWebCodecs = typeof VideoEncoder !== 'undefined'/);
  assert.match(app, /requestElectronExportPath\(downloadBaseName, initialExtension\)/);
  assert.match(app, /const \{ Muxer, ArrayBufferTarget, FileSystemWritableFileStreamTarget \} = await import\('mp4-muxer'\)/);
  assert.match(app, /const arrayBufferTarget = !mp4Writable \? new ArrayBufferTarget\(\) : null/);
  assert.match(app, /const bytes = new Uint8Array\(arrayBufferTarget\.buffer\)/);
  assert.match(app, /Math\.max\(totalMs \+ 15000, 30000\), '3D 实时录制'/);
  assert.match(app, /const ledRenderer = isDesktopElectron \? null : await create2DExportLedRenderer\(\)/);
  assert.match(app, /setExportProgress\(0\.02\)/);
  assert.match(offline, /const maxCachedFrames = Math\.max\(30, Math\.min\(180, Math\.ceil\(exportDurationSec \* Math\.min\(fps, 10\)\)\)\)/);
  assert.match(offline, /ledFrameInterval = Math\.max\(0\.1, exportDurationSec \/ maxCachedFrames\)/);
});

test('video export probes mobile-safe codecs and stops feeding a closed encoder', async () => {
  const app = await read('App.tsx');

  assert.match(app, /codec: `avc1\.4200\$\{level\}`/);
  assert.match(app, /VideoEncoder\.isConfigSupported\(config\)/);
  assert.match(app, /mimeType: 'video\/mp4;codecs=avc1\.42001E,mp4a\.40\.2'/);
  assert.match(app, /const realtimeFormat = getMediaRecorderExportFormat\(\)/g);
  assert.match(app, /startMediaRecorderWithFallback\(stream, recorderFormats, 100\)/g);
  assert.match(app, /downloadBlob\(blob, `\$\{downloadBaseName\}\.\$\{activeRealtimeFormat\.extension\}`\)/g);
  assert.match(app, /const canFastExport = videoEncoderConfig != null/g);
  assert.match(app, /if \(videoEncoderError\) throw videoEncoderError/g);
  assert.match(app, /if \(videoEncoder\?\.state === 'closed'\)/g);
  assert.match(app, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);\s+ledRenderer\?\.dispose\(\)/);
  assert.match(app, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\);\s+offline\.dispose\(\)/);
  assert.doesNotMatch(app, /alert\('高速导出失败/);
});

test('Electron build excludes the embedded Agent and FFmpeg', async () => {
  const [pkg, builder, main, preload, agentService] = await Promise.all([
    read('package.json'),
    read('electron-builder.config.cjs'),
    read('electron/main.ts'),
    read('electron/preload.ts'),
    read('services/choreoAgentService.ts'),
  ]);

  assert.doesNotMatch(pkg, /build:agent|ffmpeg-static/);
  assert.doesNotMatch(builder, /agent-backend|ffmpeg/);
  assert.doesNotMatch(main, /AgentBackendManager|agent-backend/);
  assert.doesNotMatch(preload, /agent:getRuntime|agent:restart/);
  assert.doesNotMatch(agentService, /electronAPI\.agent|agent:getRuntime/);
});

test('COS deploy verification does not fail on reachable legacy PWA URLs', async () => {
  const workflow = await read('.github/workflows/deploy-cos.yml');

  assert.match(workflow, /Current build still references legacy PWA artifacts/);
  assert.match(workflow, /grep -R -n -E 'sw\\.js\|manifest\\.webmanifest\|navigator\\.serviceWorker\|serviceWorker\\.register' dist/);
  assert.match(workflow, /report_legacy_url\(\) \{/);
  assert.match(workflow, /does not fail deploy because CDN\/static-site fallback can keep legacy URLs at 200/);
  assert.match(workflow, /report_legacy_url "\$\{CDN_URL\}sw\.js" "Legacy sw\.js"/);
  assert.doesNotMatch(workflow, /wait_until_unreachable/);
  assert.doesNotMatch(workflow, /still reachable after CDN purge wait/);
});

test('packaged Electron uses the branded application icons', async () => {
  const [builder, main] = await Promise.all([
    read('electron-builder.config.cjs'),
    read('electron/main.ts'),
  ]);

  assert.match(builder, /icon: 'build\/icon\.ico'/);
  assert.doesNotMatch(builder, /signAndEditExecutable:\s*false/);
  assert.match(main, /app\.isPackaged/);
  assert.match(main, /path\.join\(path\.dirname\(process\.execPath\), 'icon\.png'\)/);
});

test('stage grid uses meter spacing, centered ruler marks, and third divisions', async () => {
  const [app, stage, stageFloor, offline, grid] = await Promise.all([
    read('App.tsx'),
    read('components/Stage.tsx'),
    read('3d_components/StageFloor.tsx'),
    read('utils/OfflineRenderer3D.ts'),
    read('utils/stage-grid.ts'),
  ]);

  assert.match(grid, /MIN_STAGE_GRID_SPACING = 0\.1/);
  assert.match(grid, /MAX_STAGE_GRID_SPACING = 2\.5/);
  assert.match(grid, /DEFAULT_STAGE_GRID_SPACING = 1/);
  assert.match(grid, /STAGE_THIRD_POSITIONS = \[1 \/ 3, 2 \/ 3\]/);
  assert.match(stage, /createCenteredStageGridMarks\(totalStageWidth, gridScale\)/);
  assert.match(stage, /createCenteredStageGridMarks\(stageConfig\.depth, gridScale\)/);
  assert.match(stage, /formatStageGridLabel\(mark\.offsetMeters\)/);
  assert.match(stage, /snapStagePosition/);
  assert.match(stageFloor, /depthGridMarks\.map/);
  assert.match(stageFloor, /STAGE_THIRD_POSITIONS\.map/);
  assert.match(offline, /createCenteredStageGridMarks\(totalWidth, gridScale\)/);
  assert.match(offline, /depthGridMarks/);
  assert.match(await read('3d_components/Scene3D.tsx'), /snapToGrid/);
  assert.match(app, /const \[snapToGrid, setSnapToGrid\] = useState\(false\)/);
  assert.match(app, /aria-label="吸附到网格"/);
  assert.match(app, /step=\{STAGE_GRID_SPACING_STEP\}/);
  assert.match(app, /createCenteredStageGridMarks\(stageD, gridScale\)/);
  assert.match(stage, /shouldShowStageGridLabels\(gridScale\)/);
});

test('stage background upload uses a custom width dialog and sidebar controls', async () => {
  const [app, dialog, sidebar] = await Promise.all([
    read('App.tsx'),
    read('components/StageBackgroundDialog.tsx'),
    read('components/Sidebar.tsx'),
  ]);

  assert.match(app, /StageBackgroundDialog/);
  assert.match(app, /calculateStageDimensionsFromImage/);
  assert.match(app, /setStageConfig\(data\.stageConfig\)/);
  assert.match(dialog, /role="dialog"/);
  assert.doesNotMatch(`${app}\n${dialog}`, /\bprompt\s*\(/);
  assert.match(sidebar, /舞台底图/);
  assert.match(sidebar, /舞台划线/);
  assert.match(sidebar, /LED 距舞台后沿/);
});

test('project saving preserves editor state and exposes autosave feedback', async () => {
  const [app, sidebar, ipc, preload] = await Promise.all([
    read('App.tsx'),
    read('components/Sidebar.tsx'),
    read('electron/ipc-handlers.ts'),
    read('electron/preload.ts'),
  ]);
  const saveHandler = app.slice(
    app.indexOf('const handleSaveProject'),
    app.indexOf('const handleImportProjectPackage'),
  );

  assert.doesNotMatch(saveHandler, /setPerformers\(saved\.data\.performers\)/);
  assert.doesNotMatch(saveHandler, /setFrames\(saved\.data\.frames\)/);
  assert.doesNotMatch(saveHandler, /setStageConfig\(saved\.data\.stageConfig\)/);
  assert.match(app, /AUTO_SAVE_INTERVAL_MS = 5 \* 60 \* 1000/);
  assert.match(app, /SAVE_SUCCESS_DURATION_MS = 2000/);
  assert.match(app, /saveInFlightRef/);
  assert.match(app, /saveRequestedRef/);
  assert.match(app, /window\.setInterval/);
  assert.match(app, /保存成功/);
  assert.match(app, /role="status"/);
  assert.match(sidebar, /上次保存/);
  assert.match(sidebar, /保存中/);
  const ipcSaveHandler = ipc.slice(
    ipc.indexOf("ipcMain.handle('project:save'"),
    ipc.indexOf("ipcMain.handle('project:ingestAsset'"),
  );
  assert.doesNotMatch(ipcSaveHandler, /loadManagedProject/);
  assert.match(preload, /save: \(projectId: string, projectData: ProjectDocument\) => Promise<void>/);
});

test('2D stage renders background, LED marker, arrows, and actor rotation controls', async () => {
  const stage = await read('components/Stage.tsx');
  const app = await read('App.tsx');

  assert.match(stage, /resolveStageBackgroundUrl/);
  assert.match(stage, /getLedStageYPercent/);
  assert.match(stage, /data-direction-arrow/);
  assert.match(stage, /showDirectionArrows\?: boolean/);
  assert.match(stage, /showDirectionArrows = true/);
  assert.match(stage, /\{showDirectionArrows && <DirectionArrow \/>\}/);
  assert.match(stage, /viewBox="0 0 32 44"/);
  assert.match(stage, /bottom-\[-16px\] left-1\/2/);
  assert.match(stage, /h-11 w-8/);
  assert.match(stage, /strokeWidth="5"/);
  assert.match(stage, /showDirectionArrows \? '-bottom-10' : '-bottom-6'/);
  assert.match(stage, /\* 180 \/ Math\.PI\) - 90/);
  assert.doesNotMatch(stage, /\* 180 \/ Math\.PI\) \+ 90/);
  assert.match(stage, /data-performer-id=\{performer\.id\}/);
  assert.match(stage, /onRotationStart\?\.\(performer\.id\)/);
  assert.match(stage, /rotations\[performer\.id\] \?\? performer\.rotation \?\? 0/);
  assert.match(app, /const \[showDirectionArrows, setShowDirectionArrows\] = useState\(true\)/);
  assert.match(app, /setShowDirectionArrows\(!showDirectionArrows\)/);
  assert.match(app, /showDirectionArrows \? <Eye size=\{18\} \/> : <EyeOff size=\{18\} \/>/);
  assert.match(app, /showDirectionArrows=\{showDirectionArrows\}/);
});

test('2D export direction arrows default toward the stage front', async () => {
  const app = await read('App.tsx');

  assert.match(app, /const arrowSize = size \* 1\.35/);
  assert.match(app, /ctx\.lineWidth = Math\.max\(4, 3 \* scale\)/);
  assert.match(app, /ctx\.moveTo\(0, -arrowSize \* 0\.22\)/);
  assert.match(app, /ctx\.lineTo\(0, arrowSize \* 0\.38\)/);
  assert.match(app, /ctx\.moveTo\(0, arrowSize \* 0\.55\)/);
  assert.match(app, /if \(showDirectionArrows\) \{\s*drawDirectionArrow/);
  assert.match(app, /ctx\.rotate\(rot\)/);
  assert.doesNotMatch(app, /ctx\.rotate\(-rot\)/);
});

test('live 3D stage uses the background, LED depth, and direction arrows', async () => {
  const [scene, floor, led, performer, prop] = await Promise.all([
    read('3d_components/Scene3D.tsx'),
    read('3d_components/StageFloor.tsx'),
    read('components/LEDTV.tsx'),
    read('3d_components/Performer3D.tsx'),
    read('3d_components/Prop3D.tsx'),
  ]);

  assert.match(scene, /stageConfig=\{stageConfig\}/);
  assert.match(floor, /resolveStageBackgroundUrl/);
  assert.match(floor, /showStageLines/);
  assert.match(led, /getLedZPosition/);
  assert.match(performer, /DirectionArrow3D/);
  assert.match(prop, /DirectionArrow3D/);
  assert.match(scene, /showDirectionArrows = true/);
  assert.match(scene, /showDirectionArrows,/);
  assert.match(performer, /\{showDirectionArrows && <DirectionArrow3D/);
  assert.match(prop, /\{showDirectionArrows && <DirectionArrow3D/);
  assert.match(await read('3d_components/DirectionArrow3D.tsx'), /0\.14, 0\.055, 0\.64/);
  assert.match(await read('3d_components/DirectionArrow3D.tsx'), /0\.26, 0\.46, 16/);
});

test('offline 3D renderer includes stage background, LED depth, and arrows', async () => {
  const offline = await read('utils/OfflineRenderer3D.ts');

  assert.match(offline, /resolveStageBackgroundUrl/);
  assert.match(offline, /getLedZPosition/);
  assert.match(offline, /createDirectionArrow/);
  assert.match(offline, /includeDirectionArrows: boolean = true/);
  assert.match(offline, /createPropMesh\(p, includeDirectionArrows\)/);
  assert.match(offline, /createPerformerMesh\(p\.color, includeDirectionArrows\)/);
  assert.match(offline, /0\.14, 0\.055, 0\.64/);
  assert.match(offline, /0\.26, 0\.46, 16/);
  assert.match(offline, /showStageLines/);
});

test('stage selection box converts client pixels into transformed local coordinates', async () => {
  const stage = await read('components/Stage.tsx');

  assert.match(stage, /const scaleX = stage\.offsetWidth \/ rect\.width/);
  assert.match(stage, /const scaleY = stage\.offsetHeight \/ rect\.height/);
  assert.match(stage, /width: Math\.abs\(selectionBox\.endX - selectionBox\.startX\) \* scaleX/);
  assert.match(stage, /style=\{getSelectionBoxStyle\(\)\}/);
});

test('CosStage rebrand preserves upgrade and legacy compatibility identifiers', async () => {
  const [pkg, builder, ipc] = await Promise.all([
    read('package.json'),
    read('electron-builder.config.cjs'),
    read('electron/ipc-handlers.ts'),
  ]);

  assert.match(pkg, /"name": "cosstage-desktop"/);
  assert.match(builder, /appId: 'com\.choreomaster\.app'/);
  assert.match(ipc, /Legacy ChoreoMaster JSON/);
});

test('timeline native scrollbar is isolated from seeking and wheel input scrolls horizontally', async () => {
  const source = await read('components/Timeline.tsx');

  assert.match(source, /onWheel=\{handleTimelineWheel\}/);
  assert.match(source, /data-timeline-content/);
  assert.doesNotMatch(source, /ref=\{containerRef\}[\s\S]{0,160}onPointerDown=\{handlePointerDown\}/);
});

test('sidebar moves compatible multi-selection through menu and drag-and-drop', async () => {
  const [sidebar, app] = await Promise.all([
    read('components/Sidebar.tsx'),
    read('App.tsx'),
  ]);

  assert.match(sidebar, /performerIds: string\[\]/);
  assert.match(sidebar, /resolveGroupAction/);
  assert.match(sidebar, /onAddPerformersToGroup\(contextMenuState\.performerIds/);
  assert.match(sidebar, /onRemovePerformersFromGroup/);
  assert.match(sidebar, /dragState\.performerIds\.length/);
  assert.match(app, /handleRemovePerformersFromGroup/);
});

test('cross-project clipboard carries entities, scene state, and portable assets', async () => {
  const [app, helper, help] = await Promise.all([
    read('App.tsx'),
    read('utils/cross-project-clipboard.ts'),
    read('components/HelpModal.tsx'),
  ]);

  assert.doesNotMatch(app, /interface ClipboardItem/);
  assert.doesNotMatch(app, /positions: Record<string, Position>; \/\/ Map FrameID/);
  assert.match(app, /currentSceneState\.positions/);
  assert.match(app, /currentSceneState\.rotations/);
  assert.match(app, /kind: 'formation'/);
  assert.match(app, /performers: portablePerformers/);
  assert.match(app, /groups: performerGroups/);
  assert.match(app, /pastePerformerPayload/);
  assert.match(app, /pasteFormationPayload/);
  assert.match(helper, /makePerformersPortable/);
  assert.match(help, /跨项目/);
});
