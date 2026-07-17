import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('pausing playback selects the formation that owns the current timeline position', async () => {
  const app = await read('App.tsx');

  assert.match(app, /findEditableFrameAtTime/);
  assert.match(
    app,
    /if \(isPlaying\) \{[\s\S]{0,320}findEditableFrameAtTime\(currentTime, frames\)[\s\S]{0,220}setCurrentFrameId\([\s\S]{0,220}setSelectedPerformerIds\(\[\]\)/,
  );
  assert.match(
    app,
    /const handleSelectFrame = \(id: string\) => \{[\s\S]{0,260}if \(isPlaying\) \{[\s\S]{0,100}handlePlayPause\(\)[\s\S]{0,260}setCurrentFrameId\(id\)/,
  );
  assert.match(
    app,
    /const handleSeek = \(time: number\) => \{[\s\S]{0,260}findEditableFrameAtTime\(time, frames\)/,
  );
});

test('tutorial example resolves beside the current document for packaged Electron', async () => {
  const source = await read('components/ProjectBrowser.tsx');
  assert.match(source, /new URL\('\.\/tutorial-project\.json', window\.location\.href\)/);
  assert.doesNotMatch(source, /fetch\('\/tutorial-project\.json'\)/);
});

test('desktop project import and export use portable packages instead of loose JSON', async () => {
  const [app, ipc, browser] = await Promise.all([
    read('App.tsx'),
    read('electron/ipc-handlers.ts'),
    read('components/ProjectBrowser.tsx'),
  ]);

  assert.match(app, /const handleExportProject = async \(\): Promise<boolean> => \{[\s\S]{0,180}projectTransfers\.exportProjectPackage\(\)/);
  assert.match(app, /const handleImportProject = async \(e: React\.ChangeEvent<HTMLInputElement>\) => \{[\s\S]{0,180}projectTransfers\.importProjectPackage\(\)/);
  assert.doesNotMatch(app, /window\.electronAPI\.saveFile\(defaultName\)/);
  assert.doesNotMatch(app, /window\.electronAPI\.openFile\(\[\s*\{\s*name: 'CosStage Project', extensions: \['json'\]/);
  assert.match(ipc, /defaultName = `\$\{content\.name \|\| 'CosStage-project'\}\.zip`/);
  assert.match(ipc, /name: '项目压缩包 \(\*\.zip\)', extensions: \['zip'\]/);
  assert.match(ipc, /extensions: \['zip', 'choreo'\]/);
  assert.match(browser, /导出项目压缩包/);
});

test('project reset backup prompt is localized and does not use browser confirm', async () => {
  const app = await read('App.tsx');

  assert.match(app, /type ResetProjectDialogMode = 'backup-choice' \| 'backup-failed'/);
  assert.match(app, /const projectTransfers = useProjectTransfers\(/);
  assert.match(app, /const handleExportProject = async \(\): Promise<boolean>/);
  assert.match(app, /const handleExportProjectJsonBackup = async \(\): Promise<boolean>/);
  assert.match(app, /const handleExportResetBackup = async \(\): Promise<boolean>/);
  assert.match(app, /window\.electronAPI\.saveTextFile\(fileName, JSON\.stringify\(projectData, null, 2\)/);
  assert.match(app, /const exported = await handleExportResetBackup\(\)/);
  assert.match(app, /resetProjectDialogMode === 'backup-choice' \? '清空前是否先导出备份？' : '备份尚未完成'/);
  assert.match(app, /如果当前项目包无法导出，会自动改为 JSON 备份/);
  assert.match(app, /备份文件没有成功导出/);
  assert.match(app, /返回编辑/);
  assert.match(app, /放弃备份并清空/);
  assert.doesNotMatch(
    app,
    /Do you want to export the current project before resetting|Click OK to Export|Click Cancel to reset without exporting/
  );
});

test('desktop project lifecycle is durable, non-destructive, and uses custom dialogs', async () => {
  const [app, browser, sidebar, service, desktopService, transfers, contract] = await Promise.all([
    read('App.tsx'),
    read('components/ProjectBrowser.tsx'),
    read('components/Sidebar.tsx'),
    read('electron/project-service.ts'),
    read('services/desktopProjectService.ts'),
    read('hooks/useProjectTransfers.ts'),
    read('electron/project-contract.ts'),
  ]);

  assert.match(app, /const initialDocument: ProjectDocument = \{[\s\S]{0,260}createPersistedDesktopProject\(name, initialDocument\)/);
  assert.match(app, /createPersistedDesktopProject\(name, initialDocument\);[\s\S]{0,100}setCurrentProjectId\(id\)/);
  assert.match(desktopService, /await window\.electronAPI\.project\.save\(created\.id, \{ \.\.\.document, name \}\)/);
  assert.match(desktopService, /await window\.electronAPI\.project\.delete\(created\.id\)/);
  assert.match(service, /if \(hasRecoverableContent\(existing\)\) \{[\s\S]{0,100}createRecoverySnapshot/);
  assert.match(service, /export async function duplicateManagedProject/);
  assert.match(transfers, /if \(!await saveBeforeProjectOperation\(\)\) return;/);
  assert.match(transfers, /window\.electronAPI\.project\.importChoreography\(\)/);
  assert.match(contract, /export interface ProjectMeta/);
  assert.match(browser, /aria-labelledby="delete-project-dialog-title"/);
  assert.match(sidebar, /aria-labelledby="delete-group-dialog-title"/);
  assert.doesNotMatch(`${app}\n${browser}\n${sidebar}`, /window\.(?:alert|confirm|prompt)\(/);
});

test('sandboxed Electron loads the preload bridge as CommonJS', async () => {
  const [main, builder] = await Promise.all([
    read('electron/main.ts'),
    read('electron-builder.config.cjs'),
  ]);
  const preloadMatch = main.match(/preload: path\.join\(__dirname, '([^']+)'\)/);

  assert.equal(preloadMatch?.[1], 'preload.cjs');
  assert.match(builder, /'dist-electron\/preload\.cjs'/);
  assert.doesNotMatch(builder, /'dist-electron\/preload\.js'/);

  const compiledPreload = await read('dist-electron/preload.cjs');
  assert.doesNotMatch(compiledPreload, /^\s*import\s/m);
  assert.match(compiledPreload, /require\(["']electron["']\)/);
  assert.match(main, /sandbox: true/);
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

test('desktop export uses native binary save dialog and bounded recording waits', async () => {
  const [app, preload, ipc, offline] = await Promise.all([
    read('App.tsx'),
    read('electron/preload.cts'),
    read('electron/ipc-handlers.ts'),
    read('utils/OfflineRenderer3D.ts'),
  ]);

  assert.match(preload, /saveBinaryFile: \(defaultName: string, content: Uint8Array/);
  assert.match(ipc, /ipcMain\.handle\(\s*'dialog:saveBinaryFile'/);
  assert.match(app, /const isDesktopElectron = Boolean\(window\.electronAPI\?\.isElectron\)/);
  assert.match(app, /const hasWebCodecs = typeof VideoEncoder !== 'undefined'/);
  assert.match(app, /saveBlobToElectron\(downloadBaseName, activeRealtimeFormat\.extension, blob\)/);
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
    read('electron/preload.cts'),
    read('services/choreoAgentService.ts'),
  ]);

  assert.doesNotMatch(pkg, /build:agent|ffmpeg-static/);
  assert.doesNotMatch(builder, /agent-backend|ffmpeg/);
  assert.doesNotMatch(main, /AgentBackendManager|agent-backend/);
  assert.doesNotMatch(preload, /agent:getRuntime|agent:restart/);
  assert.doesNotMatch(agentService, /electronAPI\.agent|agent:getRuntime/);
});

test('COS deploy verification does not fail on reachable legacy PWA URLs', async () => {
  const workflow = await read('.github/workflows/web-deploy.yml');

  assert.match(workflow, /Current build still references legacy PWA artifacts/);
  assert.match(workflow, /grep -R -n -E 'sw\\.js\|manifest\\.webmanifest\|navigator\\.serviceWorker\|serviceWorker\\.register' dist/);
  assert.match(workflow, /report_legacy_url\(\) \{/);
  assert.match(workflow, /Legacy URL diagnostic:/);
  assert.match(workflow, /report_legacy_url "sw\.js"/);
  assert.match(workflow, /report_legacy_url "manifest\.webmanifest"/);
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
  assert.match(sidebar, /LED 底部离地高度/);
  assert.match(sidebar, /ledBottomHeight/);
});

test('project saving preserves editor state and exposes autosave feedback', async () => {
  const [app, sidebar, ipc, preload] = await Promise.all([
    read('App.tsx'),
    read('components/Sidebar.tsx'),
    read('electron/ipc-handlers.ts'),
    read('electron/preload.cts'),
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
  assert.match(led, /getLedBottomHeight/);
  assert.match(led, /bottomHeight \+ height \/ 2/);
  assert.match(performer, /DirectionArrow3D/);
  assert.match(prop, /DirectionArrow3D/);
  assert.match(scene, /showDirectionArrows = true/);
  assert.match(scene, /showDirectionArrows,/);
  assert.match(performer, /\{showDirectionArrows && <DirectionArrow3D/);
  assert.match(prop, /\{showDirectionArrows && <DirectionArrow3D/);
  assert.match(await read('3d_components/DirectionArrow3D.tsx'), /0\.14, 0\.055, 0\.64/);
  assert.match(await read('3d_components/DirectionArrow3D.tsx'), /0\.26, 0\.46, 16/);
});

test('3D drag editing is transient and uses the shared interaction policy', async () => {
  const [appSource, stage3DSource, scene3DSource] = await Promise.all([
    read('App.tsx'),
    read('components/Stage3D.tsx'),
    read('3d_components/Scene3D.tsx'),
  ]);

  assert.match(appSource, /const \[is3DDragEnabled, setIs3DDragEnabled\] = useState\(false\)/);
  assert.match(
    appSource,
    /useEffect\(\(\) => \{\s*setIs3DDragEnabled\(false\);\s*\}, \[activeProjectClipboardKey\]\);/,
  );
  assert.match(appSource, /\{viewMode === '3d' && \([\s\S]{0,1200}aria-pressed=\{is3DDragEnabled\}/);
  assert.match(appSource, /aria-label=\{is3DDragEnabled \? '锁定 3D 对象' : '启用 3D 拖动编辑'\}/);
  assert.match(
    appSource,
    /aria-pressed=\{is3DDragEnabled\}[\s\S]{0,500}<span className="whitespace-nowrap text-xs font-medium">3D 拖动编辑<\/span>/,
  );
  assert.match(appSource, /<Stage3D[\s\S]*dragEnabled=\{is3DDragEnabled\}/);

  const projectDocumentStart = appSource.indexOf('const buildProjectDocument = useCallback');
  const projectDocumentEnd = appSource.indexOf('// Initialize Audio Context', projectDocumentStart);
  assert.notEqual(projectDocumentStart, -1);
  assert.notEqual(projectDocumentEnd, -1);
  assert.doesNotMatch(appSource.slice(projectDocumentStart, projectDocumentEnd), /is3DDragEnabled/);

  const projectSnapshotStart = appSource.indexOf('const getProjectStateString = useCallback');
  const projectSnapshotEnd = appSource.indexOf('// Track changes to project', projectSnapshotStart);
  assert.notEqual(projectSnapshotStart, -1);
  assert.notEqual(projectSnapshotEnd, -1);
  const projectSnapshotSource = appSource.slice(projectSnapshotStart, projectSnapshotEnd);
  assert.match(projectSnapshotSource, /const currentProjectStateString = useMemo/);
  assert.match(
    projectSnapshotSource,
    /latestProjectSnapshotRef\.current = \{\s*projectId: currentProjectId,\s*document: buildProjectDocument\(\),\s*state: currentProjectStateString,\s*\};/,
  );
  assert.doesNotMatch(projectSnapshotSource, /is3DDragEnabled/);

  const appSyntaxTree = ts.createSourceFile(
    'App.tsx',
    appSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const localStorageCalls = [];
  const pushUndoActionCalls = [];
  const persistedStorageMethods = new Set(['getItem', 'setItem', 'removeItem']);

  const getStaticMember = (expression) => {
    if (ts.isPropertyAccessExpression(expression)) {
      return { receiver: expression.expression, name: expression.name.text };
    }
    if (
      ts.isElementAccessExpression(expression)
      && expression.argumentExpression
      && ts.isStringLiteralLike(expression.argumentExpression)
    ) {
      return { receiver: expression.expression, name: expression.argumentExpression.text };
    }
    return null;
  };
  const isLocalStorageReceiver = (expression) => (
    (ts.isIdentifier(expression) && expression.text === 'localStorage')
    || getStaticMember(expression)?.name === 'localStorage'
  );

  const visitCallExpressions = (node) => {
    if (ts.isCallExpression(node)) {
      const member = getStaticMember(node.expression);
      if (member) {
        if (
          persistedStorageMethods.has(member.name)
          && isLocalStorageReceiver(member.receiver)
        ) {
          localStorageCalls.push(node);
        }
        if (member.name === 'pushUndoAction') pushUndoActionCalls.push(node);
      } else if (ts.isIdentifier(node.expression) && node.expression.text === 'pushUndoAction') {
        pushUndoActionCalls.push(node);
      }
    }
    ts.forEachChild(node, visitCallExpressions);
  };

  visitCallExpressions(appSyntaxTree);
  assert.ok(localStorageCalls.length > 0, 'expected to inspect existing localStorage calls');
  assert.ok(pushUndoActionCalls.length > 0, 'expected to inspect existing pushUndoAction calls');
  for (const call of localStorageCalls) {
    assert.doesNotMatch(
      call.getText(appSyntaxTree),
      /\bis3DDragEnabled\b/,
      '3D drag editing mode must remain outside localStorage calls',
    );
  }
  for (const call of pushUndoActionCalls) {
    assert.doesNotMatch(
      call.getText(appSyntaxTree),
      /\bis3DDragEnabled\b/,
      '3D drag editing mode must remain outside undo history calls',
    );
  }

  assert.match(stage3DSource, /dragEnabled\?: boolean/);
  assert.match(stage3DSource, /dragEnabled=\{dragEnabled\}/);
  assert.match(
    scene3DSource,
    /const interactionPolicy = resolveThreeInteractionPolicy\(\{\s*dragEnabled,\s*readonly,\s*isDragging,\s*\}\);/,
  );
  assert.match(
    scene3DSource,
    /onPositionChange: interactionPolicy\.canDragObjects\s*\? \(newPos: Position\) => handlePositionChange\(p\.id, newPos\)\s*: undefined/,
  );
  assert.match(scene3DSource, /enableRotate=\{interactionPolicy\.enableRotate\}/);
  assert.match(scene3DSource, /enablePan=\{interactionPolicy\.enablePan\}/);
  assert.match(scene3DSource, /enableZoom=\{interactionPolicy\.enableZoom\}/);
  assert.doesNotMatch(scene3DSource, /enableRotate=\{[^}]*hasSelection/);
});

test('3D pointer lifecycle captures accepted drags and commits exact final updates', async () => {
  const [performer3DSource, prop3DSource, scene3DSource, appSource] = await Promise.all([
    read('3d_components/Performer3D.tsx'),
    read('3d_components/Prop3D.tsx'),
    read('3d_components/Scene3D.tsx'),
    read('App.tsx'),
  ]);

  assert.match(performer3DSource, /canStartThreeObjectDrag/);
  assert.match(performer3DSource, /isMatchingCapturedPointer/);
  assert.match(prop3DSource, /isMatchingCapturedPointer/);
  assert.match(prop3DSource, /canStartThreeObjectDrag/);
  assert.match(performer3DSource, /event\.button/);
  assert.match(prop3DSource, /event\.button/);
  assert.match(performer3DSource, /setPointerCapture/);
  assert.match(prop3DSource, /setPointerCapture/);
  assert.match(performer3DSource, /onPointerCancel=\{handlePlanePointerCancel\}/);
  assert.match(prop3DSource, /onPointerCancel=\{handlePlanePointerCancel\}/);
  for (const source of [performer3DSource, prop3DSource]) {
    assert.match(source, /const \{ camera, raycaster, pointer, gl \} = useThree\(\)/);
    assert.match(source, /const canvas = gl\.domElement/);
    assert.match(source, /canvas\.addEventListener\('pointercancel', handleCanvasPointerTermination\)/);
    assert.match(source, /canvas\.addEventListener\('lostpointercapture', handleCanvasPointerTermination\)/);
    assert.match(source, /canvas\.removeEventListener\('pointercancel', handleCanvasPointerTermination\)/);
    assert.match(source, /canvas\.removeEventListener\('lostpointercapture', handleCanvasPointerTermination\)/);
    assert.match(source, /isMatchingCapturedPointer\(captured\?\.pointerId, event\.pointerId\)/);
    assert.match(source, /const finishActiveDrag = useCallback\(\(notifyDragEnd: boolean = true\) => \{/);
    assert.match(source, /if \(dragEnabled\) return;\s*finishActiveDrag\(\);/);
    assert.match(source, /finishActiveDrag\(false\);/);
    assert.match(source, /onDragEndRef\.current\?\.\(finalPosition\)/);
  }
  assert.match(
    performer3DSource,
    /if \(!isPlaneDraggingRef\.current && !isHeightDraggingRef\.current\) return;/,
  );
  assert.match(prop3DSource, /if \(!isPlaneDraggingRef\.current\) return;/);
  assert.match(
    performer3DSource,
    /isPlaneDraggingRef\.current = false;\s*isHeightDraggingRef\.current = false;[\s\S]{0,200}releaseCapturedPointer\(\);/,
  );
  assert.match(
    prop3DSource,
    /isPlaneDraggingRef\.current = false;[\s\S]{0,200}releaseCapturedPointer\(\);/,
  );
  assert.match(performer3DSource, /onLostPointerCapture=\{handleHeightPointerCancel\}/);
  assert.match(
    performer3DSource,
    /const handleHeightDragEnd = useCallback\([\s\S]{0,220}finishActiveDrag\(\);/,
  );
  assert.match(performer3DSource, /event\.nativeEvent\.clientY/);
  assert.doesNotMatch(performer3DSource, /event\.pointer\.y/);
  assert.match(performer3DSource, /camera\.position\.distanceTo/);
  assert.match(performer3DSource, /resolveThreeHeightFromPointerDrag/);
  assert.match(prop3DSource, /getPropAnchorFromCenter/);
  assert.match(scene3DSource, /onDragEnd\?\.\(\[draggedId\], \[committedUpdate\]\)/);
  assert.match(appSource, /type: 'move-performers',[\s\S]{0,220}before:[\s\S]{0,220}after:/);
  assert.match(appSource, /if \(last\.type === 'move-performers'\)[\s\S]{0,260}last\.before/);
  assert.match(appSource, /if \(last\.type === 'move-performers'\)[\s\S]{0,260}last\.after/);
});

test('offline 3D renderer includes stage background, LED depth, and arrows', async () => {
  const offline = await read('utils/OfflineRenderer3D.ts');

  assert.match(offline, /resolveStageBackgroundUrl/);
  assert.match(offline, /getLedZPosition/);
  assert.match(offline, /getLedBottomHeight/);
  assert.match(offline, /bottomHeight \+ height \/ 2/);
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

test('short formation frames render as keyframes in timeline and sidebar', async () => {
  const [timeline, sidebar, helper] = await Promise.all([
    read('components/Timeline.tsx'),
    read('components/Sidebar.tsx'),
    read('utils/frame-keyframes.ts'),
  ]);

  assert.match(helper, /KEYFRAME_DURATION_THRESHOLD_MS = 500/);
  assert.match(helper, /MIN_FRAME_DURATION_MS = 100/);
  assert.match(timeline, /normalizeFrameDuration\(draggingState\.originalDuration \+ deltaTime\)/);
  assert.match(timeline, /KEYFRAME_MIN_VISUAL_WIDTH_PX/);
  assert.match(timeline, /isKeyframeFrame\(frame\)/);
  assert.match(timeline, /关键帧/);
  assert.match(sidebar, /isKeyframeFrame\(f\)/);
  assert.match(sidebar, /关键帧/);
  assert.match(sidebar, /formatFrameDuration\(f\.duration\)/);
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

test('product guide renders release history with explicit async states and no web bundled fallback', async () => {
  const [guide, versions, releaseHistory] = await Promise.all([
    read('components/ProductGuide.tsx'),
    read('components/ProductGuideVersions.tsx'),
    read('utils/release-history.ts'),
  ]);

  assert.match(guide, /import \{ ProductGuideVersions \} from '\.\/ProductGuideVersions'/);
  assert.match(guide, /scrollToSection\('operations'\)[\s\S]*scrollToSection\('versions'\)[\s\S]*scrollToSection\('terms'\)/);
  assert.match(guide, /<ProductGuideOperations \/>[\s\S]*<ProductGuideVersions \/>[\s\S]*<section id="terms"/);
  assert.match(versions, /view\.status === 'loading'/);
  assert.match(versions, /view\.status === 'error'/);
  assert.match(versions, /view\.status === 'success'/);
  assert.match(versions, /let active = true/);
  assert.match(versions, /return \(\) => \{ active = false; \}/);
  assert.match(versions, /aria-label="版本更新"/);
  assert.match(versions, /view\.data\.history\.latestVisibleVersion &&/);
  assert.doesNotMatch(versions, /view\.data\.history\.currentVersion/);
  assert.match(versions, /shouldStripDedicatedMajorSections\(release, change\)/);
  assert.match(versions, /ordinaryReleaseChangeText/);
  assert.match(versions, /重大变化/);
  assert.match(versions, /迁移说明/);

  const webBranch = releaseHistory.slice(releaseHistory.indexOf('let response: ReleaseHistoryResponse'));
  assert.match(webBranch, /fetchImpl\(PUBLISHED_RELEASES_URL, \{ cache: 'no-store' \}\)/);
  assert.doesNotMatch(webBranch, /bundledHistory/);
});

test('desktop update install is gated by project save', async () => {
  const [app, notification] = await Promise.all([
    read('App.tsx'),
    read('components/UpdateNotification.tsx'),
  ]);

  assert.match(app, /<UpdateNotification beforeInstall=\{saveBeforeProjectOperation\}/);
  assert.match(notification, /if \(await beforeInstall\(\)\) await window\.electronAPI\.update\.install\(\)/);
  assert.match(notification, /state\.updateKind === 'major'/);
  assert.match(notification, /正在保存项目…/);
  assert.doesNotMatch(notification, /dangerouslySetInnerHTML|window\.(?:alert|confirm|prompt)\(/);
});

test('desktop update modals serialize focus and update errors remain reachable', async () => {
  const [notification, modal] = await Promise.all([
    read('components/UpdateNotification.tsx'),
    read('components/UpdateModal.tsx'),
  ]);

  assert.match(notification, /\(isAvailable \|\| isDownloaded \|\| isError\)/);
  assert.match(notification, /showMajorDialog \? null : whatsNewRelease/);
  assert.match(modal, /previousActiveElement/);
  assert.match(modal, /event\.key !== 'Tab'/);
  assert.match(modal, /focusable\[focusable\.length - 1\]\?\.focus\(\)/);
});

test('first governed release checks the legacy migration prompt before initializing its preference', async () => {
  const notification = await read('components/UpdateNotification.tsx');
  const decisionIndex = notification.indexOf(
    'const showWhatsNew = shouldShowWhatsNew(currentVersion, lastSeenVersion)',
  );
  const initializeIndex = notification.indexOf('if (lastSeenVersion === null)');

  assert.ok(decisionIndex >= 0);
  assert.ok(initializeIndex >= 0);
  assert.ok(decisionIndex < initializeIndex);
});

test('desktop release preserves builder identity and commits stable pointers in order', async () => {
  const [builder, release, publish, rollback] = await Promise.all([
    read('electron-builder.config.cjs'),
    read('.github/workflows/desktop-release.yml'),
    read('scripts/release/publish-cos.sh'),
    read('.github/workflows/desktop-rollback.yml'),
  ]);

  assert.match(builder, /appId: 'com\.choreomaster\.app'/);
  assert.match(builder, /releaseNotesFile: 'build\/release-notes\.md'/);
  assert.match(release, /group: desktop-release-stable/);
  assert.match(release, /cancel-in-progress: false/);
  assert.doesNotMatch(release, /Get-FileHash\s+-Algorithm\s+SHA512/);
  assert.match(publish, /downloads\/metadata\/\$VERSION\/latest\.yml/);

  const aliasWrite = publish.indexOf(
    'coscli cp "$alias_path" "cos://production/downloads/CosStage-Setup-x64.exe"',
  );
  const indexWrite = publish.indexOf(
    'coscli cp releases.next.json "cos://production/downloads/releases.json"',
  );
  const latestWrite = publish.indexOf(
    'coscli cp desktop/latest.yml "cos://production/downloads/latest.yml"',
  );
  assert.ok(aliasWrite >= 0 && aliasWrite < indexWrite && indexWrite < latestWrite);
  assert.equal(publish.lastIndexOf('coscli cp'), latestWrite);

  assert.match(rollback, /group: desktop-release-stable/);
  assert.match(rollback, /cos:\/\/production\/downloads\/metadata\/\$VERSION\/latest\.yml/);
});
