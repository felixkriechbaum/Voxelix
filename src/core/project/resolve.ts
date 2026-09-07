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

/** Grid cells per block edge for an object (an overlay follows its base). */
export function effectiveSubdivision(object: VoxelObject, project: Project): number {
  if (object.kind === 'extend' && object.baseId) {
    const base = project.getById(object.baseId);
    if (base) return base.subdivision;
  }
  return object.subdivision;
}

export interface ActiveRender {
  editableId: string;
  /** grid the tools read and the editable mesh is built from */
  editableData: VoxelData;
  /** for extend objects: the locked base shown dimmed underneath, else null */
  baseContext: VoxelData | null;
  /** for extend objects: resolved base, used to decide place vs. remove-marker */
  baseResolved: VoxelData | null;
  /** grid cells per block edge (viewport scales the meshes by 1 / this) */
  subdivision: number;
}

/** Build the render/edit bundle for whichever object is active. */
export function buildActiveRender(object: VoxelObject, project: Project): ActiveRender {
  const subdivision = effectiveSubdivision(object, project);
  if (object.kind !== 'extend' || !object.baseId) {
    return {
      editableId: object.id,
      editableData: object.data,
      baseContext: null,
      baseResolved: null,
      subdivision,
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

  return { editableId: object.id, editableData, baseContext, baseResolved, subdivision };
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
