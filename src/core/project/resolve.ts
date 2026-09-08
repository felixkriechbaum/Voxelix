import { VoxelData } from '@/core/voxel/VoxelData';
import { REMOVED } from '@/core/voxel/constants';
import type { Project } from './Project';
import type { VoxelObject } from './VoxelObject';

/**
 * The voxel grid an object actually represents once extend-overlays are applied.
 *
 * A normal object resolves to its own data. An extend object resolves to its
 * base's resolved data with this object's overlay applied on top: overlay cells
 * holding a colour value are written, cells holding REMOVED punch a hole, and
 * empty overlay cells inherit the base.
 */
export function resolveEffectiveData(
  object: VoxelObject,
  project: Project,
  seen = new Set<string>(),
): VoxelData {
  if (object.kind !== 'extend' || !object.baseId || seen.has(object.id)) {
    return object.data;
  }
  seen.add(object.id);
  const base = project.getById(object.baseId);
  if (!base) return object.data;

  const baseData = resolveEffectiveData(base, project, seen);
  const result = new VoxelData(
    Math.max(baseData.sizeX, object.data.sizeX),
    Math.max(baseData.sizeY, object.data.sizeY),
    Math.max(baseData.sizeZ, object.data.sizeZ),
  );
  baseData.forEachFilled((x, y, z, c) => result.set(x, y, z, c));
  object.data.forEachEntry((x, y, z, v) => {
    if (v === REMOVED) result.clear(x, y, z);
    else result.setRaw(x, y, z, v);
  });
  return result;
}

/**
 * `object` plus every object that extends it, directly or transitively. Used by
 * ops that must keep a base and its whole overlay chain in lockstep (rotate,
 * subdivide).
 */
export function extendFamily(object: VoxelObject, project: Project): VoxelObject[] {
  const family = [object];
  for (let i = 0; i < family.length; i++) {
    for (const o of project.objects) {
      if (o.baseId === family[i].id && !family.includes(o)) family.push(o);
    }
  }
  return family;
}

function rotatedClone(data: VoxelData, quarterTurns: number): VoxelData {
  const out = data.clone();
  for (let i = 0; i < (quarterTurns & 3); i++) out.rotateY(1);
  return out;
}

/** Fraction of an overlay's REMOVED markers that land on an actual base voxel. */
function removedOnBase(overlay: VoxelData, base: VoxelData): number {
  let total = 0;
  let hits = 0;
  overlay.forEachEntry((x, y, z, v) => {
    if (v !== REMOVED) return;
    total++;
    if (base.isSolid(x, y, z)) hits++;
  });
  return total === 0 ? 0 : hits / total;
}

/**
 * When an overlay's grid has drifted out of orientation with its base (base
 * rotated, overlay not), pick the 90° Y-rotation of the overlay that lines its
 * REMOVED markers back up with base voxels. Returns a rotated clone, or null
 * when the current orientation is already the best fit.
 */
export function alignOverlayToBase(overlay: VoxelData, base: VoxelData): VoxelData | null {
  const swapped = overlay.sizeX === base.sizeZ && overlay.sizeZ === base.sizeX;
  const same = overlay.sizeX === base.sizeX && overlay.sizeZ === base.sizeZ;
  if (same) {
    // dims already match — only spin 180° if it clearly improves the fit
    const r2 = rotatedClone(overlay, 2);
    return removedOnBase(r2, base) > removedOnBase(overlay, base) + 0.15 ? r2 : null;
  }
  if (swapped) {
    // must be a quarter turn off; take whichever direction fits better
    const r1 = rotatedClone(overlay, 1);
    const r3 = rotatedClone(overlay, 3);
    return removedOnBase(r1, base) >= removedOnBase(r3, base) ? r1 : r3;
  }
  return null; // dimensions not related by a rotation — leave it alone
}

/** Grid cells per voxel edge for an object (an overlay follows its base). */
export function effectiveDetail(object: VoxelObject, project: Project): number {
  if (object.kind === 'extend' && object.baseId) {
    const base = project.getById(object.baseId);
    if (base) return base.detail;
  }
  return object.detail;
}

export interface ActiveRender {
  editableId: string;
  /** grid the tools read and the editable mesh is built from */
  editableData: VoxelData;
  /** for extend objects: the locked base shown dimmed underneath, else null */
  baseContext: VoxelData | null;
  /** for extend objects: resolved base, used to decide place vs. remove-marker */
  baseResolved: VoxelData | null;
  /** grid cells per voxel edge — drives the voxel-grid overlay */
  detail: number;
}

/** Build the render/edit bundle for whichever object is active. */
export function buildActiveRender(object: VoxelObject, project: Project): ActiveRender {
  const detail = effectiveDetail(object, project);
  if (object.kind !== 'extend' || !object.baseId) {
    return {
      editableId: object.id,
      editableData: object.data,
      baseContext: null,
      baseResolved: null,
      detail,
    };
  }
  const base = project.getById(object.baseId);
  const baseResolved = base
    ? resolveEffectiveData(base, project)
    : new VoxelData(object.data.sizeX, object.data.sizeY, object.data.sizeZ);

  const size: [number, number, number] = [
    Math.max(baseResolved.sizeX, object.data.sizeX),
    Math.max(baseResolved.sizeY, object.data.sizeY),
    Math.max(baseResolved.sizeZ, object.data.sizeZ),
  ];

  const editableData = new VoxelData(...size);
  const baseContext = new VoxelData(...size);
  baseResolved.forEachFilled((x, y, z, c) => baseContext.set(x, y, z, c));

  object.data.forEachEntry((x, y, z, v) => {
    // whatever the overlay touches leaves the locked base context...
    baseContext.clear(x, y, z);
    // ...and non-removed overlay cells make up the editable mesh
    if (v !== REMOVED) editableData.setRaw(x, y, z, v);
  });

  return { editableId: object.id, editableData, baseContext, baseResolved, detail };
}

/**
 * Translate a tool write into an overlay write for an extend object.
 * Returns the raw value to store in the overlay grid.
 */
export function overlayWriteValue(value: number, baseResolved: VoxelData, x: number, y: number, z: number): number {
  if (value !== 0) return value; // place / recolour
  // erase: only mark REMOVED when the base actually has a voxel here
  return baseResolved.isSolid(x, y, z) ? REMOVED : 0;
}
