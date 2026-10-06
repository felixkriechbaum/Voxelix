import { VoxelData } from '@/core/voxel/VoxelData';
import { REMOVED } from '@/core/voxel/constants';
import type { Project } from './Project';
import type { VoxelObject } from './VoxelObject';
import type { ColorAdjust } from './types';
import { mergeParts, modifierActive, smoothLayers, VoxelPart, type SmoothLayer } from './parts';

/**
 * An object as parts before their modifiers run, plus the holes punched
 * into the finished result afterwards. For an extend object: the base's parts
 * (and modifiers) with the overlay worked into their voxels.
 */
interface ResolvedParts {
  parts: VoxelPart[];
  /** cells an overlay deleted — cleared from the finished look, modifier copies included */
  holes: Array<[number, number, number]>;
}

const NEIGHBOURS: Array<[number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/**
 * An extend object takes over its base's parts and modifier stacks, so the
 * modifiers act on the whole thing, additions included — a mirrored base
 * mirrors a handle the overlay adds, an un-voxeled one smooths it in:
 *  - a colour lands in the part that already has a voxel there, else in the
 *    first part it touches, else in the first part;
 *  - REMOVED deletes the cell from every part (so a mirrored copy of it goes
 *    too) and punches a hole in the finished look (so a generated copy the
 *    overlay deleted stays deleted).
 * Without modifiers that's exactly the base with the overlay laid on top.
 */
function resolveParts(object: VoxelObject, project: Project, seen: Set<string>): ResolvedParts {
  if (object.kind !== 'extend' || !object.baseId || seen.has(object.id)) return { parts: object.parts, holes: [] };
  seen.add(object.id);
  const base = project.getById(object.baseId);
  // a broken link shows the overlay's own voxels (REMOVED markers aren't solid)
  if (!base) return { parts: [new VoxelPart({ id: object.activePartId, name: 'Part 1', data: object.data })], holes: [] };

  const from = resolveParts(base, project, seen);
  const overlay = object.data;
  const parts = from.parts.map((p) => {
    const data = new VoxelData(
      Math.max(p.data.sizeX, overlay.sizeX),
      Math.max(p.data.sizeY, overlay.sizeY),
      Math.max(p.data.sizeZ, overlay.sizeZ),
    );
    p.data.forEachFilled((x, y, z, c) => data.set(x, y, z, c));
    return new VoxelPart({ id: p.id, name: p.name, data, modifiers: p.modifiers, hidden: p.hidden });
  });
  const holes = from.holes.slice();
  overlay.forEachEntry((x, y, z, v) => {
    if (v === REMOVED) {
      for (const p of parts) p.data.clear(x, y, z);
      holes.push([x, y, z]);
      return;
    }
    let owner = -1;
    for (let i = parts.length - 1; i >= 0 && owner < 0; i--) if (parts[i].data.isSolid(x, y, z)) owner = i;
    for (let i = 0; i < parts.length && owner < 0; i++)
      if (NEIGHBOURS.some(([dx, dy, dz]) => parts[i].data.isSolid(x + dx, y + dy, z + dz))) owner = i;
    parts.forEach((p, i) => (i === Math.max(0, owner) ? p.data.setRaw(x, y, z, v) : p.data.clear(x, y, z)));
  });
  return { parts, holes };
}

/** How an object finally looks: every voxel, the voxel parts alone, and the smooth surfaces. */
export interface ResolvedLook {
  /** all of it as voxels — un-voxeled parts included (their cage) */
  data: VoxelData;
  /** only the parts that stay voxels; equals `data` when nothing is un-voxeled */
  voxelData: VoxelData;
  smooth: SmoothLayer[];
}

/** The finished look of any object — extend overlays resolved, modifiers applied. */
export function resolveLook(object: VoxelObject, project: Project): ResolvedLook {
  const { parts, holes } = resolveParts(object, project, new Set());
  const detail = effectiveDetail(object, project);
  const punch = (d: VoxelData) => {
    for (const [x, y, z] of holes) d.clear(x, y, z);
    return d;
  };
  const plain = object.kind !== 'extend' || !object.baseId;
  const data = plain ? object.merged() : punch(mergeParts(parts, detail));
  const smooth = smoothLayers(object.id, parts, detail).map((l) => ({ ...l, data: punch(l.data.clone()) }));
  const voxelData = smooth.length > 0 ? punch(mergeParts(parts, detail, undefined, true)) : data;
  return { data, voxelData, smooth };
}

/** Does any part of this object, or of a base up its extend chain, pass `test`? */
export function someInChain(object: VoxelObject, project: Project, test: (part: VoxelPart) => boolean): boolean {
  const seen = new Set<string>();
  for (let o: VoxelObject | null = object; o && !seen.has(o.id); o = o.baseId ? (project.getById(o.baseId) ?? null) : null) {
    seen.add(o.id);
    if (o.parts.some(test)) return true;
  }
  return false;
}

/** Does anything in this object (or up its extend chain) carry an active modifier? */
export function hasModifiersInChain(object: VoxelObject, project: Project): boolean {
  return someInChain(object, project, (p) => p.modifiers.some(modifierActive));
}

/**
 * The voxel grid an object actually represents once extend-overlays are applied.
 *
 * A normal object resolves to its own data, modifiers applied. An extend
 * object resolves through its base's parts with this overlay worked in (see
 * `resolveParts`): overlay cells holding a colour are written, REMOVED
 * punches a hole, and empty overlay cells inherit the base.
 */
export function resolveEffectiveData(object: VoxelObject, project: Project): VoxelData {
  return resolveLook(object, project).data;
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
  /** the active object's own saturation/brightness shift, or null if unset */
  colorAdjust: ColorAdjust | null;
  /**
   * the active part is smoothed: `baseContext` is the finished object shown
   * as-is, and the part's own voxels are drawn over it as a faint cage
   */
  cage: boolean;
  /** un-voxeled parts, drawn as smooth surfaces — they're left out of the grids above */
  smooth: SmoothLayer[];
  /** show the smooth surfaces dimmed, as context around the part being edited */
  smoothDimmed: boolean;
}

/** Build the render/edit bundle for whichever object is active. */
export function buildActiveRender(object: VoxelObject, project: Project): ActiveRender {
  const detail = effectiveDetail(object, project);
  const colorAdjust = object.colorAdjust ?? null;
  if (object.kind !== 'extend' || !object.baseId) {
    // a smoothed part's result differs from its voxels everywhere, so show it
    // whole (its own cells too) with the part as a cage on top — a hidden part
    // the same way, as a cage over everything else; otherwise the part being
    // edited is bright and the other parts plus any modifier copies (its own
    // included) show dimmed around it
    const cage = object.activePart.isSmoothed || object.activePart.hidden;
    const smooth = smoothLayers(object.id, object.parts, object.detail);
    return {
      editableId: object.id,
      editableData: object.data,
      baseContext: object.isComposite
        ? mergeParts(object.parts, object.detail, cage ? undefined : object.activePart, smooth.length > 0)
        : null,
      baseResolved: null,
      detail,
      colorAdjust,
      cage,
      smooth,
      smoothDimmed: !cage,
    };
  }
  const base = project.getById(object.baseId);
  const baseResolved = base
    ? resolveEffectiveData(base, project)
    : new VoxelData(object.data.sizeX, object.data.sizeY, object.data.sizeZ);
  const look = resolveLook(object, project);
  const size: [number, number, number] = [look.data.sizeX, look.data.sizeY, look.data.sizeZ];

  if (look.smooth.length > 0) {
    // the base is (partly) un-voxeled: show the finished object, all its voxels
    // as the cage to click on and paint, as with a smoothed part
    return {
      editableId: object.id,
      editableData: look.data,
      baseContext: look.voxelData.isEmpty() ? null : look.voxelData,
      baseResolved,
      detail,
      colorAdjust,
      cage: true,
      smooth: look.smooth,
      smoothDimmed: false,
    };
  }

  // the overlay's own colours are the bright, editable mesh; everything else
  // of the finished look — the base, and any copies the base's modifiers make
  // of the overlay — is the dimmed locked context
  const editableData = new VoxelData(...size);
  const baseContext = look.data; // freshly merged, ours to cut into
  object.data.forEachEntry((x, y, z, v) => {
    if (v === REMOVED) return;
    editableData.setRaw(x, y, z, v);
    baseContext.clear(x, y, z);
  });

  return {
    editableId: object.id,
    editableData,
    baseContext,
    baseResolved,
    detail,
    colorAdjust,
    cage: false,
    smooth: [],
    smoothDimmed: false,
  };
}

/**
 * The object as exported, nothing dimmed or caged: an overlay merged with its
 * base, un-voxeled parts as smooth surfaces. For screenshot mode.
 */
export function buildFinishedRender(object: VoxelObject, project: Project): ActiveRender {
  const render = buildActiveRender(object, project);
  const look = resolveLook(object, project);
  return { ...render, editableData: look.voxelData, baseContext: null, cage: false, smooth: look.smooth, smoothDimmed: false };
}

/**
 * Translate a tool write into an overlay write for an extend object.
 * Returns the raw value to store in the overlay grid.
 *
 * A write that matches what the base already has stores 0 — "inherit" — rather
 * than a redundant copy. Without that, any broad operation (a bucket flood, a
 * box fill, a moved selection) reads the *resolved* grid and writes every cell
 * back, baking the whole base into the overlay: nothing renders as locked base
 * any more and later base edits stop showing through.
 */
export function overlayWriteValue(value: number, baseResolved: VoxelData, x: number, y: number, z: number): number {
  const base = baseResolved.get(x, y, z);
  // place / recolour: only store where it actually differs from the base
  if (value !== 0) return value === base ? 0 : value;
  // erase: only mark REMOVED when the base actually has a voxel here
  return base !== 0 ? REMOVED : 0;
}

/**
 * Strip redundant cells from an overlay diff: colours that already match the
 * base, and REMOVED markers where the base has nothing to remove. What is left
 * is the real difference, so the base renders as locked context again and later
 * base edits propagate. Repairs an overlay that got the base baked into it.
 */
export function compactOverlay(
  overlay: VoxelData,
  baseResolved: VoxelData,
): { data: VoxelData; dropped: number } {
  const data = new VoxelData(overlay.sizeX, overlay.sizeY, overlay.sizeZ);
  let dropped = 0;
  overlay.forEachEntry((x, y, z, v) => {
    const base = baseResolved.get(x, y, z);
    const redundant = v === REMOVED ? base === 0 : v === base;
    if (redundant) dropped++;
    else data.setRaw(x, y, z, v);
  });
  return { data, dropped };
}
