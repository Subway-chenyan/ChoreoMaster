import type {
  BoxTextures,
  ExtrudedTextures,
  FaceTexture,
  Frame,
  Performer,
  PerformerGroup,
  Position,
} from '../types';

export interface SceneClipboardEntry {
  position: Position;
  rotation?: number;
}

export interface PerformerClipboardPayload {
  kind: 'performers';
  performers: Performer[];
  groups: PerformerGroup[];
  scene: Record<string, SceneClipboardEntry>;
}

export interface FrameClipboardUpdate {
  positions: Record<string, Position>;
  rotations: Record<string, number>;
}

export interface PerformerPasteResult {
  performers: Performer[];
  groups: PerformerGroup[];
  frameUpdates: Record<string, FrameClipboardUpdate>;
}

function cloneValue<T>(value: T): T {
  return structuredClone(value);
}

function remapPerformer(
  performer: Performer,
  performerIdMap: Map<string, string>,
  groupIdMap: Map<string, string>,
): Performer {
  const next = cloneValue(performer);
  next.id = performerIdMap.get(performer.id) ?? performer.id;

  const nextGroupId = performer.groupId ? groupIdMap.get(performer.groupId) : undefined;
  if (nextGroupId) {
    next.groupId = nextGroupId;
  } else {
    delete next.groupId;
  }

  const nextBoundToId = performer.boundToId ? performerIdMap.get(performer.boundToId) : undefined;
  if (nextBoundToId) {
    next.boundToId = nextBoundToId;
  } else {
    delete next.boundToId;
  }

  return next;
}

export function pastePerformerPayload(
  payload: PerformerClipboardPayload,
  targetFrameId: string,
  createId: () => string,
): PerformerPasteResult {
  const groupIdMap = new Map(payload.groups.map((group) => [group.id, createId()]));
  const performerIdMap = new Map(payload.performers.map((performer) => [performer.id, createId()]));
  const groups = payload.groups.map((group) => ({
    ...cloneValue(group),
    id: groupIdMap.get(group.id) ?? group.id,
  }));
  const performers = payload.performers.map((performer) => (
    remapPerformer(performer, performerIdMap, groupIdMap)
  ));
  const frameUpdate: FrameClipboardUpdate = { positions: {}, rotations: {} };

  Object.entries(payload.scene).forEach(([sourceId, entry]) => {
    const targetId = performerIdMap.get(sourceId);
    if (!targetId) return;
    frameUpdate.positions[targetId] = { ...entry.position };
    if (typeof entry.rotation === 'number' && Number.isFinite(entry.rotation)) {
      frameUpdate.rotations[targetId] = entry.rotation;
    }
  });

  return {
    performers,
    groups,
    frameUpdates: { [targetFrameId]: frameUpdate },
  };
}

export interface FormationClipboardPayload {
  kind: 'formation';
  performers: Performer[];
  groups: PerformerGroup[];
  frame: Frame;
}

export interface FormationPasteResult {
  performers: Performer[];
  groups: PerformerGroup[];
  frame: Frame;
}

function remapPositions(
  positions: Record<string, Position>,
  performerIdMap: Map<string, string>,
): Record<string, Position> {
  return Object.fromEntries(
    Object.entries(positions).flatMap(([sourceId, position]) => {
      const targetId = performerIdMap.get(sourceId);
      return targetId ? [[targetId, { ...position }]] : [];
    }),
  );
}

function remapRotations(
  rotations: Record<string, number> | undefined,
  performerIdMap: Map<string, string>,
): Record<string, number> {
  if (!rotations) return {};
  return Object.fromEntries(
    Object.entries(rotations).flatMap(([sourceId, rotation]) => {
      const targetId = performerIdMap.get(sourceId);
      return targetId ? [[targetId, rotation]] : [];
    }),
  );
}

export function pasteFormationPayload(
  payload: FormationClipboardPayload,
  startTime: number,
  createId: () => string,
): FormationPasteResult {
  const groupIdMap = new Map(payload.groups.map((group) => [group.id, createId()]));
  const performerIdMap = new Map(payload.performers.map((performer) => [performer.id, createId()]));
  const frameId = createId();
  const groups = payload.groups.map((group) => ({
    ...cloneValue(group),
    id: groupIdMap.get(group.id) ?? group.id,
  }));
  const performers = payload.performers.map((performer) => (
    remapPerformer(performer, performerIdMap, groupIdMap)
  ));
  const frame: Frame = {
    ...cloneValue(payload.frame),
    id: frameId,
    name: `${payload.frame.name} (复制)`,
    startTime,
    positions: remapPositions(payload.frame.positions, performerIdMap),
    rotations: remapRotations(payload.frame.rotations, performerIdMap),
    hiddenGroupIds: (payload.frame.hiddenGroupIds ?? []).flatMap((sourceId) => {
      const targetId = groupIdMap.get(sourceId);
      return targetId ? [targetId] : [];
    }),
  };

  return { performers, groups, frame };
}

export type LoadAssetAsDataUrl = (url: string) => Promise<string>;

async function loadPortableDataUrl(
  source: string,
  loadAssetAsDataUrl: LoadAssetAsDataUrl,
): Promise<string> {
  if (source.startsWith('data:')) return source;
  const dataUrl = await loadAssetAsDataUrl(source);
  if (!dataUrl.startsWith('data:')) {
    throw new Error(`Clipboard asset loader returned a non-data URL for ${source}`);
  }
  return dataUrl;
}

async function makeFaceTexturePortable(
  texture: FaceTexture | undefined,
  loadAssetAsDataUrl: LoadAssetAsDataUrl,
): Promise<FaceTexture | undefined> {
  if (!texture) return undefined;
  const source = texture.dataUrl ?? texture.assetPath;
  if (!source) return texture.fileName ? { fileName: texture.fileName } : undefined;
  return {
    dataUrl: await loadPortableDataUrl(source, loadAssetAsDataUrl),
    ...(texture.fileName ? { fileName: texture.fileName } : {}),
  };
}

async function makeTextureMapPortable<T extends BoxTextures | ExtrudedTextures>(
  textures: T | undefined,
  loadAssetAsDataUrl: LoadAssetAsDataUrl,
): Promise<T | undefined> {
  if (!textures) return undefined;
  const entries = await Promise.all(
    Object.entries(textures).map(async ([slot, texture]) => [
      slot,
      await makeFaceTexturePortable(texture, loadAssetAsDataUrl),
    ] as const),
  );
  return Object.fromEntries(entries) as T;
}

export async function makePerformersPortable(
  performers: Performer[],
  loadAssetAsDataUrl: LoadAssetAsDataUrl,
): Promise<Performer[]> {
  return Promise.all(performers.map(async (performer) => {
    const next = cloneValue(performer);
    const legacyTextureSource = next.textureDataUrl ?? next.textureAssetPath;
    if (legacyTextureSource) {
      next.textureDataUrl = await loadPortableDataUrl(legacyTextureSource, loadAssetAsDataUrl);
    }
    delete next.textureAssetPath;

    next.boxTextures = await makeTextureMapPortable(next.boxTextures, loadAssetAsDataUrl);
    next.extrudedTextures = await makeTextureMapPortable(next.extrudedTextures, loadAssetAsDataUrl);
    return next;
  }));
}
