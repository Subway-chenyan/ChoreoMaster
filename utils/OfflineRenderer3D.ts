import * as THREE from 'three';
import type { Performer, Position, StageConfig, LEDContent } from '../types';
import { mapTo3D, degToRad } from './coordinates';
import { denormalizePoints } from '../components/prop-editor/PolygonUtils';

export type CameraAngle = 'judge' | 'overhead';

interface OfflineSceneResult {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  updateAtTime: (timeMs: number, positions: Record<string, Position>, hiddenGroupIds?: string[]) => void;
  dispose: () => void;
}

/** Build camera for a given angle and stage dimensions */
function createCamera(angle: CameraAngle, stageConfig: StageConfig): THREE.PerspectiveCamera {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  const { width, depth } = stageConfig;

  if (angle === 'judge') {
    // 评委视角：舞台前方正中，眼高1.7m，距前缘6m
    cam.position.set(0, 1.7, depth / 2 + 6);
    cam.lookAt(0, 1.2, 0);
  } else {
    // 45°俯视：舞台侧前方上方
    const dist = depth / 2 + 12;
    cam.position.set(0, dist, dist);
    cam.lookAt(0, 0, 0);
  }
  cam.updateProjectionMatrix();
  return cam;
}

/** Build stage floor (plane + grid + edge lines) matching StageFloor.tsx */
function createStageFloor(width: number, depth: number, gridScale: number): THREE.Group {
  const group = new THREE.Group();

  // Floor plane
  const floorGeo = new THREE.PlaneGeometry(width, depth);
  floorGeo.rotateX(-Math.PI / 2);
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8, metalness: 0.2 });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.y = -0.01;
  floor.receiveShadow = true;
  group.add(floor);

  // Grid
  const divisions = Math.round(4 * gridScale);
  const grid = new THREE.GridHelper(width, divisions, 0x444444, 0x222222);
  grid.position.y = 0.01;
  grid.scale.z = depth / width;
  group.add(grid);

  // Red line at front edge
  const redGeo = new THREE.BoxGeometry(width, 0.05, 0.1);
  const redMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
  const redLine = new THREE.Mesh(redGeo, redMat);
  redLine.position.set(0, 0.02, -depth / 2);
  group.add(redLine);

  // Blue line at back edge
  const blueGeo = new THREE.BoxGeometry(width, 0.05, 0.1);
  const blueMat = new THREE.MeshBasicMaterial({ color: 0x3b82f6 });
  const blueLine = new THREE.Mesh(blueGeo, blueMat);
  blueLine.position.set(0, 0.02, depth / 2);
  group.add(blueLine);

  return group;
}

/** Create LED wall mesh matching LEDTV.tsx */
function createLEDMesh(stageConfig: StageConfig): THREE.Mesh {
  const height = stageConfig.ledHeight || 6;
  const width = stageConfig.width;
  const depth = stageConfig.depth;

  const geo = new THREE.PlaneGeometry(width, height);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x111111,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(0, height / 2, -depth / 2 - 0.1);
  return mesh;
}

/** Create a performer mesh group matching Performer3D.tsx (no drag, no selection rings) */
function createPerformerMesh(color: string): THREE.Group {
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
  return group;
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
function createPropMesh(performer: Performer): THREE.Group {
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
    let mat: THREE.Material;
    if (hasTextures) {
      const mats = [
        createFaceMaterial(hasTextures.side, performer.color),
        createFaceMaterial(hasTextures.top, performer.color),
        createFaceMaterial(hasTextures.bottom, performer.color),
      ];
      mat = mats;
      // Assign material groups
      const mesh = new THREE.Mesh(geo, mats);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    } else {
      mat = new THREE.MeshStandardMaterial({ color: performer.color });
      const mesh = new THREE.Mesh(geo, mat);
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
  const camera = createCamera(cameraAngle, stageConfig);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();

  // Stage floor
  const floor = createStageFloor(stageConfig.width, stageConfig.depth, gridScale);
  scene.add(floor);

  // LED wall
  const ledMesh = createLEDMesh(stageConfig);
  scene.add(ledMesh);

  // LED content handling
  let ledVideoElement: HTMLVideoElement | null = null;
  let ledVideoTexture: THREE.VideoTexture | null = null;
  let ledImageTexture: THREE.CanvasTexture | null = null;

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
  } else if (ledContent?.type === 'image' && ledContent.value && mediaCache[ledContent.value]) {
    const img = new Image();
    img.src = mediaCache[ledContent.value];
    const tex = new THREE.CanvasTexture(img);
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
      mesh = createPropMesh(p);
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
      mesh = createPerformerMesh(p.color);
    }
    mesh.visible = false; // Hidden until updateAtTime sets positions
    meshMap.set(p.id, mesh);
    scene.add(mesh);
  });

  /**
   * Update all performer/prop positions at a given time.
   * Positions are set directly (no lerp interpolation) for deterministic frame output.
   */
  function updateAtTime(timeMs: number, positions: Record<string, Position>, hiddenGroupIds: string[] = []): void {
    performers.forEach(p => {
      const mesh = meshMap.get(p.id);
      if (!mesh) return;

      const pos = positions[p.id];
      if (!pos || (p.groupId && hiddenGroupIds.includes(p.groupId))) {
        mesh.visible = false;
        return;
      }

      mesh.visible = true;
      const [x3d, y3d, z3d] = mapTo3D(pos, stageConfig);

      if (p.type === 'prop') {
        const dims = { height: p.height || 1 };
        mesh.position.set(x3d, y3d + dims.height / 2, z3d);
      } else {
        mesh.position.set(x3d, y3d, z3d);
      }

      // Rotation
      mesh.rotation.y = -degToRad(p.rotation || 0);
    });

    // Update LED video texture
    if (ledVideoElement && ledVideoTexture) {
      const timeSec = timeMs / 1000;
      if (ledVideoElement.readyState >= HTMLMediaElement.HAVE_METADATA) {
        const desired = getTimelineVideoTime(ledVideoElement, timeSec, ledVideoElement.loop);
        if (Number.isFinite(desired) && Math.abs(ledVideoElement.currentTime - desired) > 0.03) {
          try { ledVideoElement.currentTime = desired; } catch { /* ignore seek errors */ }
        }
        ledVideoTexture.needsUpdate = true;
      }
    }

    // Update LED image texture (mark for update)
    if (ledImageTexture) {
      ledImageTexture.needsUpdate = true;
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

  return { renderer, scene, camera, updateAtTime, dispose };
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
