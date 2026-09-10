import * as THREE from 'three';
import type { ProjectModelAsset } from '../types.ts';
import {
  createModelAssetInstance,
  releaseModelAssetInstance,
} from './model-runtime.ts';
import { MODEL_PREVIEW_PADDING } from './model-preview-layout.ts';

const THUMBNAIL_SIZE = 512;
type ModelPreviewView = 'front' | 'top';

export interface ModelPreviewImages {
  thumbnailDataUrl: string;
  floorplanDataUrl: string;
}

async function waitForTextures(root: THREE.Object3D): Promise<void> {
  const images = new Set<HTMLImageElement>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture
          && typeof HTMLImageElement !== 'undefined'
          && value.image instanceof HTMLImageElement
          && !value.image.complete) {
          images.add(value.image);
        }
      });
    });
  });
  await Promise.all(Array.from(images).map((image) => new Promise<void>((resolve) => {
    const finish = () => resolve();
    image.addEventListener('load', finish, { once: true });
    image.addEventListener('error', finish, { once: true });
    window.setTimeout(finish, 3000);
  })));
}

function createThumbnailRenderer(): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  canvas.width = THUMBNAIL_SIZE;
  canvas.height = THUMBNAIL_SIZE;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.setClearColor(0x0f172a, 1);
  return renderer;
}

async function renderModelView(
  model: THREE.Object3D,
  view: ModelPreviewView,
  suppliedRenderer?: THREE.WebGLRenderer,
): Promise<string> {
  const renderer = suppliedRenderer ?? createThumbnailRenderer();
  const ownsRenderer = suppliedRenderer === undefined;
  const scene = new THREE.Scene();
  scene.background = view === 'front' ? new THREE.Color(0x0f172a) : null;
  renderer.setClearColor(0x0f172a, view === 'front' ? 1 : 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.1));
  const keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  keyLight.position.set(4, 6, 8);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0x7dd3fc, 1.4);
  rimLight.position.set(-5, 3, -4);
  scene.add(rimLight);
  scene.add(model);

  try {
    await waitForTextures(model);
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    if (bounds.isEmpty()) throw new Error('模型没有可渲染内容');
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    const halfSpan = Math.max(size.x, view === 'front' ? size.y : size.z, 0.001) * MODEL_PREVIEW_PADDING / 2;
    const camera = new THREE.OrthographicCamera(-halfSpan, halfSpan, halfSpan, -halfSpan, 0.01, 10000);
    if (view === 'front') {
      camera.position.set(center.x, center.y, bounds.max.z + Math.max(size.z, halfSpan) * 3 + 1);
    } else {
      camera.position.set(center.x, bounds.max.y + Math.max(size.y, halfSpan) * 3 + 1, center.z);
      // Screen top is stage-back (-Z); screen bottom is stage-front (+Z).
      camera.up.set(0, 0, -1);
    }
    camera.lookAt(center);
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  } finally {
    scene.remove(model);
    if (ownsRenderer) {
      renderer.dispose();
      renderer.forceContextLoss();
    }
  }
}

/** Render a canonical front view: camera on +Z looking toward the model. */
export function renderModelFrontThumbnail(model: THREE.Object3D): Promise<string> {
  return renderModelView(model, 'front');
}

/** Render the real model from +Y for the 2D stage floorplan. */
export function renderModelTopThumbnail(model: THREE.Object3D): Promise<string> {
  return renderModelView(model, 'top');
}

export async function renderModelPreviewImages(model: THREE.Object3D): Promise<ModelPreviewImages> {
  const renderer = createThumbnailRenderer();
  try {
    return {
      thumbnailDataUrl: await renderModelView(model, 'front', renderer),
      floorplanDataUrl: await renderModelView(model, 'top', renderer),
    };
  } finally {
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function generateModelAssetPreviews(asset: ProjectModelAsset): Promise<ModelPreviewImages> {
  const renderer = createThumbnailRenderer();
  let instance: THREE.Group | null = null;
  try {
    instance = await createModelAssetInstance(asset, renderer);
    return {
      thumbnailDataUrl: await renderModelView(instance, 'front', renderer),
      floorplanDataUrl: await renderModelView(instance, 'top', renderer),
    };
  } finally {
    if (instance) releaseModelAssetInstance(instance);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function generateModelAssetTopThumbnail(asset: ProjectModelAsset): Promise<string> {
  const renderer = createThumbnailRenderer();
  let instance: THREE.Group | null = null;
  try {
    instance = await createModelAssetInstance(asset, renderer);
    return await renderModelView(instance, 'top', renderer);
  } finally {
    if (instance) releaseModelAssetInstance(instance);
    renderer.dispose();
    renderer.forceContextLoss();
  }
}

export async function generateModelAssetFrontThumbnail(asset: ProjectModelAsset): Promise<string> {
  return (await generateModelAssetPreviews(asset)).thumbnailDataUrl;
}
