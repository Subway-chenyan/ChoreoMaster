import * as THREE from 'three';
import type { Performer, Position, StageConfig, LEDContent } from '../types';
import { mapTo3D, degToRad, getTotalStageWidth, getWingWidth } from './coordinates';
import { denormalizePoints } from '../components/prop-editor/PolygonUtils';
import { buildPlatformOccupancy, isPlatformProp } from './platforms';
import { getPropCenterFromAnchor } from './prop-pivot';
import { createCenteredStageGridMarks, STAGE_THIRD_POSITIONS } from './stage-grid';
import { getLedBottomHeight, getLedZPosition, resolveStageBackgroundUrl } from './stage-config';
import {
  DEFAULT_PERFORMER_LABEL_FONT_SIZE,
  getPerformerDimensions,
  getStageLabelFontSize,
  normalizeLabelFontSize,
} from '../electron/stage-defaults';

export type CameraAngle = 'judge' | 'overhead' | 'rear-overhead';

interface OfflineSceneResult {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  updateAtTime: (
    timeMs: number,
    positions: Record<string, Position>,
    rotations?: Record<string, number>,
    hiddenGroupIds?: string[],
  ) => void;
  /** Pre-capture LED video frames for fast offline export. Call before the render loop. */
  prerenderLEDVideo: (inPointMs: number, outPointMs: number, fps?: number) => Promise<void>;
  dispose: () => void;
}

/** Build camera for a given angle and stage dimensions */
function createCamera(angle: CameraAngle, stageConfig: StageConfig, aspect: number): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const { width, depth } = stageConfig;
  const totalWidth = Math.max(
    getTotalStageWidth(stageConfig),
    stageConfig.ledWidth ?? stageConfig.width,
  );
  cam.aspect = aspect;
  const verticalFov = THREE.MathUtils.degToRad(cam.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const fitDistance = totalWidth / (2 * Math.tan(horizontalFov / 2));

  if (angle === 'judge') {
    // 评委视角：舞台前方正中，眼高1.7m，距前缘14m
    cam.position.set(0, 1.7, depth / 2 + Math.max(14, fitDistance));
    cam.lookAt(0, 1.0, 0);
  } else if (angle === 'overhead') {
    // 前方45°俯视：舞台前方上空
    const dist = Math.max(depth / 2 + 18, fitDistance * 1.15);
    cam.position.set(0, dist, dist);
    cam.lookAt(0, 0, 0);
  } else {
    // 后方45°俯视：舞台后方上空，便于检查背场到前场的移动关系
    const dist = Math.max(depth / 2 + 18, fitDistance * 1.15);
    cam.position.set(0, dist, -dist);
    cam.lookAt(0, 0, 0);
  }
  cam.updateProjectionMatrix();
  return cam;
}

/** Build stage floor (plane + grid + edge lines) matching StageFloor.tsx */
function createStageFloor(stageConfig: StageConfig, gridScale: number, includeGrid: boolean): THREE.Group {
  const group = new THREE.Group();
  const { width, depth } = stageConfig;
  const wingWidth = getWingWidth(stageConfig);
  const totalWidth = width + wingWidth * 2;
  const showStageLines = stageConfig.showStageLines !== false;

  // Floor plane
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.2 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  group.add(floor);

  if (wingWidth > 0) {
    const wingGeo = new THREE.PlaneGeometry(wingWidth, depth);
    wingGeo.rotateX(-Math.PI / 2);
    const wingMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9, metalness: 0.1 });
    const leftWing = new THREE.Mesh(wingGeo, wingMat);
    leftWing.position.set(-(width + wingWidth) / 2, -0.01, 0);
    leftWing.receiveShadow = true;
    group.add(leftWing);
    const rightWing = leftWing.clone();
    rightWing.position.x = (width + wingWidth) / 2;
    group.add(rightWing);

    if (showStageLines) {
      const boundaryGeo = new THREE.BoxGeometry(0.06, 0.05, depth);
      const boundaryMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const leftBoundary = new THREE.Mesh(boundaryGeo, boundaryMat);
      leftBoundary.position.set(-width / 2, 0.025, 0);
      group.add(leftBoundary);
      const rightBoundary = leftBoundary.clone();
      rightBoundary.position.x = width / 2;
      group.add(rightBoundary);
    }
  }

  // Grid
  if (includeGrid) {
    createCenteredStageGridMarks(totalWidth, gridScale).forEach((mark) => {
      const geometry = new THREE.BoxGeometry(mark.offsetMeters === 0 ? 0.035 : 0.02, 0.018, depth);
      const material = new THREE.MeshBasicMaterial({
        color: mark.offsetMeters === 0 ? 0xcbd5e1 : 0x475569,
        transparent: true,
        opacity: mark.offsetMeters === 0 ? 0.8 : 0.55,
      });
      const line = new THREE.Mesh(geometry, material);
      line.position.set(mark.offsetMeters, 0.01, 0);
      group.add(line);
    });

    const depthGridMarks = createCenteredStageGridMarks(depth, gridScale);
    depthGridMarks.forEach((mark) => {
      const geometry = new THREE.BoxGeometry(totalWidth, 0.018, mark.offsetMeters === 0 ? 0.035 : 0.02);
      const material = new THREE.MeshBasicMaterial({
        color: mark.offsetMeters === 0 ? 0xcbd5e1 : 0x475569,
        transparent: true,
        opacity: mark.offsetMeters === 0 ? 0.8 : 0.55,
      });
      const line = new THREE.Mesh(geometry, material);
      line.position.set(0, 0.01, mark.offsetMeters);
      group.add(line);
    });

    if (showStageLines) STAGE_THIRD_POSITIONS.forEach((position) => {
      const geometry = new THREE.BoxGeometry(totalWidth, 0.035, 0.065);
      const material = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.85 });
      const line = new THREE.Mesh(geometry, material);
      line.position.set(0, 0.025, -depth / 2 + position * depth);
      group.add(line);
    });
  }

  // Front marker sits just outside the playable stage area, towards the audience.
  const redGeo = new THREE.BoxGeometry(totalWidth, 0.05, 0.1);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const redLine = new THREE.Mesh(redGeo, redMat);
  redLine.position.set(0, 0.02, depth / 2 + 0.05);
  group.add(redLine);

  // Blue line at back edge
  const blueGeo = new THREE.BoxGeometry(totalWidth, 0.05, 0.1);
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const blueLine = new THREE.Mesh(blueGeo, blueMat);
  blueLine.position.set(0, 0.02, depth / 2);
  group.add(blueLine);

  return group;
}

/** Create LED wall mesh matching LEDTV.tsx */
function createLEDMesh(stageConfig: StageConfig): THREE.Mesh {
  const height = stageConfig.ledHeight || 6;
  const width = stageConfig.ledWidth ?? stageConfig.width;
  const bottomHeight = getLedBottomHeight(stageConfig);

  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x111111,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, bottomHeight + height / 2, getLedZPosition(stageConfig) - 0.1);
  return mesh;
}

function createDirectionArrow(scale: number = 1, y: number = 0.06): THREE.Group {
  const group = new THREE.Group();
  group.position.y = y;
  group.scale.setScalar(scale);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.055, 0.64), material);
  shaft.position.z = 0.28;
  group.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.46, 16), material.clone());
  head.position.z = 0.78;
  head.rotation.x = Math.PI / 2;
  group.add(head);
  return group;
}

/** Create a performer mesh group matching Performer3D.tsx (no drag, no selection rings) */
function createPerformerMesh(color: string, includeDirectionArrow: boolean = true): THREE.Group {
  const group = new THREE.Group();
  const performerHeight = 1.8;
  const baseColor = new THREE.Color(color);

  // Body group (centered at performer height / 2)
  const bodyGroup = new THREE.Group();
  bodyGroup.position.y = performerHeight / 2;

  // Cylinder body
  const bodyGeo = new THREE.CylinderGeometry(0.25, 0.25, 1, 16);
  const bodyMat = new THREE.MeshStandardMaterial({ color: baseColor });
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = -0.4;
  body.castShadow = true;
  body.receiveShadow = true;
  bodyGroup.add(body);

  // Sphere head
  const headGeo = new THREE.SphereGeometry(0.2, 16, 16);
  const headMat = new THREE.MeshStandardMaterial({ color: baseColor });
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 0.25;
  head.castShadow = true;
  bodyGroup.add(head);

  // Nose
  const noseGeo = new THREE.BoxGeometry(0.05, 0.05, 0.1);
  const noseMat = new THREE.MeshStandardMaterial({ color: 0x333333 });
  const nose = new THREE.Mesh(noseGeo, noseMat);
  nose.position.set(0, 0.25, 0.2);
  bodyGroup.add(nose);

  group.add(bodyGroup);
  if (includeDirectionArrow) {
    group.add(createDirectionArrow(0.9));
  }
  return group;
}

function createLabelSprite(text: string, height: number, fontSize: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const normalizedFontSize = normalizeLabelFontSize(fontSize, DEFAULT_PERFORMER_LABEL_FONT_SIZE);
  const scaleFactor = normalizedFontSize / DEFAULT_PERFORMER_LABEL_FONT_SIZE;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
  ctx.roundRect(8, 8, 496, 112, 20);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `600 ${Math.round(normalizedFontSize * 4.8)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(0, height, 0);
  sprite.scale.set(2.8 * scaleFactor, 0.7 * scaleFactor, 1);
  sprite.renderOrder = 1000;
  return sprite;
}

/** Create face material matching Prop3D.tsx createFaceMaterial */
function createFaceMaterial(faceTexture?: { dataUrl?: string }, fallbackColor: string = '#475569'): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ color: fallbackColor, transparent: true, opacity: 1, side: THREE.FrontSide });
  if (faceTexture?.dataUrl) {
    const texture = new THREE.TextureLoader().load(faceTexture.dataUrl);
    texture.colorSpace = THREE.SRGBColorSpace;
    mat.map = texture;
    mat.color.set('#ffffff');
  }
  return mat;
}

/** Create a prop mesh matching Prop3D.tsx */
function createPropMesh(performer: Performer, includeDirectionArrow: boolean = true): THREE.Group {
  const group = new THREE.Group();
  const dims = { width: performer.width || 1, height: performer.height || 1, depth: performer.depth || 1 };

  const isExtruded = performer.propGeometryType === 'extruded' &&
    performer.polygonPoints && performer.polygonPoints.length >= 3;

  if (isExtruded && performer.polygonPoints) {
    const h = performer.extrudeHeight || dims.height;
    const denorm = denormalizePoints(performer.polygonPoints, dims.width, dims.depth);
    const cx = denorm.reduce((s, p) => s + p.x, 0) / denorm.length;
    const cy = denorm.reduce((s, p) => s + p.y, 0) / denorm.length;
    const shape = new THREE.Shape();
    shape.moveTo(denorm[0].x - cx, denorm[0].y - cy);
    for (let i = 1; i < denorm.length; i++) shape.lineTo(denorm[i].x - cx, denorm[i].y - cy);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, h / 2, 0);

    const hasTextures = performer.extrudedTextures;
    if (hasTextures) {
      const mats = [
        createFaceMaterial(hasTextures.side, performer.color),
        createFaceMaterial(hasTextures.top, performer.color),
        createFaceMaterial(hasTextures.bottom, performer.color),
      ];
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: performer.color }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  } else {
    // Box prop
    const geo = new THREE.BoxGeometry(dims.width, dims.height, dims.depth);
    const hasTextures = (performer.boxTextures && Object.keys(performer.boxTextures).length > 0) || performer.textureDataUrl;

    if (hasTextures) {
      const mats = [
        createFaceMaterial(performer.boxTextures?.right, performer.color),
        createFaceMaterial(performer.boxTextures?.left, performer.color),
        createFaceMaterial(performer.boxTextures?.top, performer.color),
        createFaceMaterial(performer.boxTextures?.bottom, performer.color),
        createFaceMaterial(performer.boxTextures?.front || (performer.textureDataUrl ? { dataUrl: performer.textureDataUrl } : undefined), performer.color),
        createFaceMaterial(performer.boxTextures?.back, performer.color),
      ];
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      const mat = new THREE.MeshStandardMaterial({ color: performer.color });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  if (includeDirectionArrow) {
    group.add(createDirectionArrow(
      Math.max(0.75, Math.min(1.5, dims.width)),
      -dims.height / 2 + 0.06,
    ));
  }
  return group;
}

/** Configure a texture to match LEDTV.tsx configureTexture */
function configureLEDTexture(texture: THREE.Texture): void {
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, 1);
}

/** Get the video time for a given timeline position (matching LEDTV.tsx) */
function getTimelineVideoTime(video: HTMLVideoElement, timelineTimeSec: number, shouldLoop: boolean): number {
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, timelineTimeSec);
  if (shouldLoop) return timelineTimeSec % duration;
  return Math.min(Math.max(0, timelineTimeSec), Math.max(0, duration - 0.001));
}

/**
 * Create an offline 3D renderer that builds the same scene as Scene3D.
 * Returns renderer, scene, camera, and helpers for frame-by-frame rendering.
 */
export function createOfflineScene(
  width: number,
  height: number,
  stageConfig: StageConfig,
  performers: Performer[],
  cameraAngle: CameraAngle,
  gridScale: number = 1,
  mediaCache: Record<string, string> = {},
  includeGrid: boolean = true,
  includeLabels: boolean = true,
  includeDirectionArrows: boolean = true,
): OfflineSceneResult {
  // Renderer
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    powerPreference: 'high-performance',
  });
  renderer.setSize(width, height);
  renderer.setPixelRatio(1); // Export at exact resolution
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  // Scene
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1f2937); // Same as 2D export background

  // Lights (matching Scene3D.tsx)
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const directional = new THREE.DirectionalLight(0xffffff, 0.8);
  directional.position.set(10, 20, 10);
  directional.castShadow = true;
  scene.add(directional);

  // Camera
  const camera = createCamera(cameraAngle, stageConfig, width / height);
  camera.updateProjectionMatrix();

  // Stage floor
  const floor = createStageFloor(stageConfig, gridScale, includeGrid);
  scene.add(floor);
  let stageBackgroundTexture: THREE.Texture | null = null;
  const stageBackgroundUrl = resolveStageBackgroundUrl(stageConfig, mediaCache);
  if (stageBackgroundUrl) {
    stageBackgroundTexture = new THREE.TextureLoader().load(
      stageBackgroundUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
      },
      undefined,
      (error) => console.warn('3D 导出舞台底图加载失败，将继续导出基础舞台：', error),
    );
    const backgroundGeometry = new THREE.PlaneGeometry(getTotalStageWidth(stageConfig), stageConfig.depth);
    backgroundGeometry.rotateX(-Math.PI / 2);
    const backgroundMaterial = new THREE.MeshBasicMaterial({
      map: stageBackgroundTexture,
      transparent: true,
      opacity: stageConfig.background?.opacity ?? 0.5,
      toneMapped: false,
    });
    const backgroundMesh = new THREE.Mesh(backgroundGeometry, backgroundMaterial);
    backgroundMesh.position.y = 0.005;
    backgroundMesh.receiveShadow = true;
    floor.add(backgroundMesh);
  }

  // LED wall
  const ledMesh = createLEDMesh(stageConfig);
  scene.add(ledMesh);

  // LED content handling
  let ledVideoElement: HTMLVideoElement | null = null;
  let ledVideoTexture: THREE.VideoTexture | null = null;
  let ledImageTexture: THREE.Texture | null = null;
  // Pre-captured video frames for fast offline export
  let ledFrameCache: Map<number, ImageBitmap> | null = null;
  let ledFrameCacheCanvas: HTMLCanvasElement | null = null;
  let ledFrameInterval = 1; // seconds between cached frames

  const ledContent = stageConfig.ledContent;
  if (ledContent?.type === 'video' && ledContent.value && mediaCache[ledContent.value]) {
    const video = document.createElement('video');
    video.src = mediaCache[ledContent.value];
    video.loop = ledContent.loop ?? true;
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const tex = new THREE.VideoTexture(video);
    configureLEDTexture(tex);
    ledVideoElement = video;
    ledVideoTexture = tex;
    (ledMesh.material as THREE.MeshBasicMaterial).map = tex;
    (ledMesh.material as THREE.MeshBasicMaterial).color.set('#ffffff');
    video.load();

    // Also create a canvas-based texture for the frame cache path
    ledFrameCacheCanvas = document.createElement('canvas');
    ledFrameCacheCanvas.width = 640;  // reasonable capture resolution
    ledFrameCacheCanvas.height = 360;
  } else if (ledContent?.type === 'image' && ledContent.value && mediaCache[ledContent.value]) {
    const tex = new THREE.TextureLoader().load(mediaCache[ledContent.value]);
    configureLEDTexture(tex);
    ledImageTexture = tex;
    (ledMesh.material as THREE.MeshBasicMaterial).map = tex;
    (ledMesh.material as THREE.MeshBasicMaterial).color.set('#ffffff');
  } else if (ledContent?.type === 'color' && ledContent.value) {
    (ledMesh.material as THREE.MeshBasicMaterial).color.set(ledContent.value);
  }

  // Performer/Prop mesh tracking
  const meshMap = new Map<string, THREE.Group>(); // performerId -> mesh group
  const propMaterials: THREE.Material[] = []; // For cleanup

  // Create meshes for all performers
  performers.forEach(p => {
    let mesh: THREE.Group;
    if (p.type === 'prop') {
      mesh = createPropMesh(p, includeDirectionArrows);
      // Collect materials for cleanup
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          if (Array.isArray(child.material)) {
            propMaterials.push(...child.material);
          } else {
            propMaterials.push(child.material);
          }
        }
      });
    } else {
      mesh = createPerformerMesh(p.color, includeDirectionArrows);
    }
    if (includeLabels) {
      const dims = getPerformerDimensions(p);
      const labelHeight = p.type === 'prop' ? dims.height + 0.6 : dims.height + 0.7;
      const labelFontSize = getStageLabelFontSize(
        p,
        stageConfig.performerLabelFontSize,
        stageConfig.propLabelFontSize,
      );
      mesh.add(createLabelSprite(p.name, labelHeight, labelFontSize));
    }
    mesh.visible = false; // Hidden until updateAtTime sets positions
    meshMap.set(p.id, mesh);
    scene.add(mesh);
  });

  /**
   * Pre-capture LED video frames for fast offline export.
   * Seeks through the video at regular intervals, captures each frame as ImageBitmap.
   * Call this ONCE before the render loop. After this, updateAtTime uses cached frames (no seek).
   */
  async function prerenderLEDVideo(inPointMs: number, outPointMs: number, fps: number = 30): Promise<void> {
    if (!ledVideoElement || !ledFrameCacheCanvas) return;

    const video = ledVideoElement;
    const canvas = ledFrameCacheCanvas;
    const ctx = canvas.getContext('2d')!;

    // Wait for video metadata
    if (video.readyState < HTMLMediaElement.HAVE_METADATA) {
      await new Promise<void>(resolve => {
        const onReady = () => { video.removeEventListener('loadedmetadata', onReady); resolve(); };
        video.addEventListener('loadedmetadata', onReady, { once: true });
        setTimeout(resolve, 3000); // fallback
      });
    }

    const videoDuration = video.duration;
    if (!Number.isFinite(videoDuration) || videoDuration <= 0) return;

    const shouldLoop = video.loop;
    const inSec = inPointMs / 1000;
    const outSec = outPointMs / 1000;
    const exportDurationSec = Math.max(0.1, outSec - inSec);
    const maxCachedFrames = Math.max(30, Math.min(180, Math.ceil(exportDurationSec * Math.min(fps, 10))));
    const maxCaptureBudgetMs = 8000;

    // Treat LED pre-capture as an optimization only; bound time and sample count to avoid export stalls.
    ledFrameInterval = Math.max(0.1, exportDurationSec / maxCachedFrames);
    ledFrameCache = new Map();

    const captureTimes: number[] = [];
    for (let t = inSec; t <= outSec; t += ledFrameInterval) {
      const videoTime = shouldLoop ? t % videoDuration : Math.min(t, videoDuration - 0.001);
      captureTimes.push(Math.round(videoTime / ledFrameInterval) * ledFrameInterval);
    }
    // Deduplicate
    const uniqueTimes = [...new Set(captureTimes)].sort((a, b) => a - b);
    const captureDeadline = performance.now() + maxCaptureBudgetMs;
    let completed = true;

    for (const vt of uniqueTimes) {
      if (performance.now() > captureDeadline) {
        completed = false;
        break;
      }
      video.currentTime = vt;
      await new Promise<void>(resolve => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked, { once: true });
        setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 400);
      });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const bitmap = await createImageBitmap(canvas);
      ledFrameCache.set(Math.round(vt / ledFrameInterval) * ledFrameInterval, bitmap);
    }

    // Switch LED material from VideoTexture to CanvasTexture for frame-cache playback
    if (completed && ledFrameCacheCanvas && ledFrameCache.size > 0) {
      const canvasTex = new THREE.CanvasTexture(ledFrameCacheCanvas);
      configureLEDTexture(canvasTex);
      (ledMesh.material as THREE.MeshBasicMaterial).map = canvasTex;
      (ledMesh.material as THREE.MeshBasicMaterial).color.set('#ffffff');
      // Dispose old video texture
      if (ledVideoTexture) {
        ledVideoTexture.dispose();
        ledVideoTexture = null;
      }
    } else if (!completed && ledFrameCache) {
      ledFrameCache.forEach(bitmap => bitmap.close());
      ledFrameCache.clear();
      ledFrameCache = null;
    }
  }

  /**
   * Update all performer/prop positions at a given time.
   * Positions are set directly (no lerp interpolation) for deterministic frame output.
   * If frame cache exists, uses cached frames (fast). Otherwise falls back to direct seek.
   */
  function updateAtTime(
    timeMs: number,
    positions: Record<string, Position>,
    rotations: Record<string, number> = {},
    hiddenGroupIds: string[] = [],
  ): void {
    const visiblePerformers = performers.filter((p) => !p.groupId || !hiddenGroupIds.includes(p.groupId));
    const platformOccupancy = buildPlatformOccupancy(visiblePerformers, positions, stageConfig);

    performers.forEach(p => {
      const mesh = meshMap.get(p.id);
      if (!mesh) return;

      const pos = positions[p.id];
      if (!pos || (p.groupId && hiddenGroupIds.includes(p.groupId))) {
        mesh.visible = false;
        return;
      }

      mesh.visible = true;
      const rotation = rotations[p.id] ?? p.rotation ?? 0;
      const renderPosition = p.type === 'prop'
        ? getPropCenterFromAnchor(pos, rotation, p, stageConfig)
        : pos;
      const [x3d, y3d, z3d] = mapTo3D({
        ...renderPosition,
        z: (renderPosition.z || 0) + (platformOccupancy.entityLiftById[p.id] ?? 0),
      }, stageConfig);

      if (p.type === 'prop') {
        const dims = { height: p.height || 1 };
        mesh.position.set(x3d, y3d + dims.height / 2, z3d);
      } else {
        mesh.position.set(x3d, y3d, z3d);
      }

      // Rotation
      mesh.rotation.y = -degToRad(rotation);
    });

    // Update LED image texture
    if (ledImageTexture) {
      ledImageTexture.needsUpdate = true;
    }

    // Update LED video texture
    if (ledVideoElement) {
      if (ledFrameCache && ledFrameCacheCanvas) {
        // Fast path: use pre-captured frame cache
        const timeSec = timeMs / 1000;
        const videoTime = ledVideoElement.loop
          ? timeSec % (ledVideoElement.duration || 1)
          : Math.min(timeSec, (ledVideoElement.duration || 1) - 0.001);
        const cacheKey = Math.round(videoTime / ledFrameInterval) * ledFrameInterval;
        const frame = ledFrameCache.get(cacheKey);
        if (frame) {
          const ctx = ledFrameCacheCanvas.getContext('2d')!;
          ctx.drawImage(frame, 0, 0, ledFrameCacheCanvas.width, ledFrameCacheCanvas.height);
          // The material map is now a CanvasTexture on this canvas
          const map = (ledMesh.material as THREE.MeshBasicMaterial).map;
          if (map) map.needsUpdate = true;
        }
      } else if (ledVideoTexture && ledVideoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
        // Slow path: direct seek (for real-time MediaRecorder playback)
        const timeSec = timeMs / 1000;
        const desired = getTimelineVideoTime(ledVideoElement, timeSec, ledVideoElement.loop);
        const drift = Math.abs(ledVideoElement.currentTime - desired);
        if (drift > 0.08) {
          try { ledVideoElement.currentTime = desired; } catch { }
        }
        ledVideoTexture.needsUpdate = true;
      }
    }
  }

  function dispose(): void {
    // Dispose LED resources
    if (ledVideoElement) {
      ledVideoElement.pause();
      ledVideoElement.removeAttribute('src');
      ledVideoElement.load();
    }
    if (ledVideoTexture) ledVideoTexture.dispose();
    if (ledImageTexture) ledImageTexture.dispose();
    if (stageBackgroundTexture) stageBackgroundTexture.dispose();
    // Dispose frame cache
    if (ledFrameCache) {
      ledFrameCache.forEach(bitmap => bitmap.close());
      ledFrameCache.clear();
      ledFrameCache = null;
    }
    ledFrameCacheCanvas = null;

    // Dispose prop materials and textures
    propMaterials.forEach(mat => {
      if (mat instanceof THREE.MeshStandardMaterial || mat instanceof THREE.MeshBasicMaterial) {
        if (mat.map) mat.map.dispose();
      }
      mat.dispose();
    });

    // Dispose all mesh geometries
    meshMap.forEach(mesh => {
      mesh.traverse(child => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
        } else if (child instanceof THREE.Sprite) {
          child.material.map?.dispose();
          child.material.dispose();
        }
      });
    });

    // Dispose floor and LED geometries
    scene.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    });

    renderer.dispose();
  }

  return { renderer, scene, camera, updateAtTime, prerenderLEDVideo, dispose };
}

/**
 * Pre-load all prop textures as data URLs (matching 2D export behavior).
 * Returns a promise that resolves when all textures are ready.
 */
export async function preloadPropTextures(performers: Performer[]): Promise<void> {
  const texturePromises = performers
    .filter(p => p.type === 'prop')
    .map(async (p) => {
      const texUrl = p.boxTextures?.front?.dataUrl || p.textureDataUrl;
      if (!texUrl) return;
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = texUrl;
      });
    });
  await Promise.all(texturePromises);
}

export async function preloadStageBackground(
  stageConfig: StageConfig,
  mediaCache: Record<string, string>,
): Promise<void> {
  const url = resolveStageBackgroundUrl(stageConfig, mediaCache);
  if (!url) return;
  await new Promise<void>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('舞台底图加载失败'));
    image.src = url;
  });
}

/**
 * Pre-load LED video and wait for metadata to be ready.
 * Returns a promise that resolves when the video is ready for seeking.
 */
export async function preloadLEDVideo(
  stageConfig: StageConfig,
  mediaCache: Record<string, string>,
): Promise<void> {
  const content = stageConfig.ledContent;
  if (content?.type !== 'video' || !content.value || !mediaCache[content.value]) return;

  return new Promise<void>((resolve) => {
    const video = document.createElement('video');
    video.src = mediaCache[content.value!];
    video.muted = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const onReady = () => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      // Don't keep this video around - the offline scene creates its own
      video.removeAttribute('src');
      video.load();
      resolve();
    };

    video.addEventListener('loadedmetadata', onReady);
    video.addEventListener('loadeddata', onReady);
    // Fallback: resolve after 3s even if video doesn't load
    const timeout = setTimeout(() => {
      video.removeEventListener('loadedmetadata', onReady);
      video.removeEventListener('loadeddata', onReady);
      resolve();
    }, 3000);
    video.addEventListener('loadeddata', () => clearTimeout(timeout), { once: true });
    video.load();
  });
}
