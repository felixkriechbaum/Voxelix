import { VoxelData } from '@/core/voxel/VoxelData';
import type { VoxelDataJson } from '@/core/voxel/types';

/**
 * Blender-style array modifier: repeats the part `count` times along `axis`,
 * each copy one part-length further on plus `gap` voxels. Non-destructive —
 * the copies are generated from the part's current voxels every time, so the
 * modifier can be changed or removed at any point.
 */
export interface ArrayModifier {
  id: string;
  type: 'array';
  enabled: boolean;
  /** total number of instances, the original included */
  count: number;
  axis: 0 | 1 | 2;
  /** which way along the axis the copies go */
  direction: 1 | -1;
  /** extra space between instances, in voxels (0 = touching) */
  gap: number;
}

/** Mirrors the part across the plane through the grid centre that flips `axis`. */
export interface MirrorModifier {
  id: string;
  type: 'mirror';
  enabled: boolean;
  axis: 0 | 1 | 2;
}

/** Shifts the part by whole voxels — positions a part without redrawing it. */
export interface MoveModifier {
  id: string;
  type: 'move';
  enabled: boolean;
  /** offset in voxels along x / y / z */
  offset: [number, number, number];
}

/** Copies the part around the vertical axis through the grid centre: 2 (180°) or 4 (90° steps). */
export interface RadialModifier {
  id: string;
  type: 'radial';
  enabled: boolean;
  count: 2 | 4;
}

export type Modifier = ArrayModifier | MirrorModifier | MoveModifier | RadialModifier;
export type ModifierType = Modifier['type'];

/** Does this modifier change anything right now? */
export function modifierActive(m: Modifier): boolean {
  if (!m.enabled) return false;
  switch (m.type) {
    case 'array':
      return m.count > 1;
    case 'move':
      return m.offset.some((v) => v !== 0);
    default:
      return true;
  }
}

export interface VoxelPartJson {
  id: string;
  name: string;
  data: VoxelDataJson;
  modifiers?: Modifier[];
}

/** One mesh of an object: its own voxels in the object's shared grid, plus modifiers. */
export class VoxelPart {
  id: string;
  name: string;
  data: VoxelData;
  modifiers: Modifier[];

  constructor(opts: { id?: string; name: string; data: VoxelData; modifiers?: Modifier[] }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.data = opts.data;
    this.modifiers = opts.modifiers ?? [];
  }

  get hasActiveModifiers(): boolean {
    return this.modifiers.some(modifierActive);
  }

  clone(): VoxelPart {
    return new VoxelPart({
      name: this.name,
      data: this.data.clone(),
      modifiers: this.modifiers.map((m) => cloneModifier(m, crypto.randomUUID())),
    });
  }

  toJSON(): VoxelPartJson {
    return { id: this.id, name: this.name, data: this.data.toJSON(), modifiers: this.modifiers.map((m) => cloneModifier(m, m.id)) };
  }

  static fromJSON(json: VoxelPartJson): VoxelPart {
    return new VoxelPart({
      id: json.id,
      name: json.name,
      data: VoxelData.fromJSON(json.data),
      modifiers: (json.modifiers ?? []).map(normalizeModifier),
    });
  }
}

export function newArrayModifier(axis: 0 | 1 | 2 = 0): ArrayModifier {
  return { id: crypto.randomUUID(), type: 'array', enabled: true, count: 2, axis, direction: 1, gap: 0 };
}

export function newModifier(type: ModifierType): Modifier {
  const id = crypto.randomUUID();
  switch (type) {
    case 'array':
      return newArrayModifier(0);
    case 'mirror':
      return { id, type, enabled: true, axis: 0 };
    case 'move':
      return { id, type, enabled: true, offset: [0, 0, 0] };
    case 'radial':
      return { id, type, enabled: true, count: 4 };
  }
}

function cloneModifier(m: Modifier, id: string): Modifier {
  return m.type === 'move' ? { ...m, id, offset: [...m.offset] as [number, number, number] } : { ...m, id };
}

const axisOf = (a: unknown): 0 | 1 | 2 => (a === 1 || a === 2 ? a : 0);
const whole = (v: unknown, lo: number, hi: number, fallback: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number(v ?? fallback)) || 0));

/** Clamp a modifier to sane values — for loading files and after UI edits. */
export function normalizeModifier(m: Modifier): Modifier {
  const id = m.id ?? crypto.randomUUID();
  const enabled = m.enabled !== false;
  switch (m.type) {
    case 'mirror':
      return { id, type: 'mirror', enabled, axis: axisOf(m.axis) };
    case 'move': {
      const o = Array.isArray(m.offset) ? m.offset : [0, 0, 0];
      return { id, type: 'move', enabled, offset: [0, 1, 2].map((i) => whole(o[i], -192, 192, 0)) as [number, number, number] };
    }
    case 'radial':
      return { id, type: 'radial', enabled, count: m.count === 2 ? 2 : 4 };
    default: {
      // 'array' — also any older file whose modifiers had no type yet
      const a = m as ArrayModifier;
      return {
        id,
        type: 'array',
        enabled,
        count: whole(a.count, 1, 64, 2),
        axis: axisOf(a.axis),
        direction: a.direction === -1 ? -1 : 1,
        gap: whole(a.gap, 0, 64, 0),
      };
    }
  }
}

/**
 * How a modifier follows a 90° turn of the whole object about Y (see
 * VoxelData.rotateY): clockwise sends +X → −Z and +Z → +X, counter-clockwise
 * +X → +Z and +Z → −X. Radial copies sit around the centre, so they don't change.
 */
export function rotateModifierY(m: Modifier, dir: 1 | -1): void {
  if (m.type === 'array') {
    if (m.axis === 1) return;
    const flips = dir === 1 ? m.axis === 0 : m.axis === 2;
    m.axis = m.axis === 0 ? 2 : 0;
    if (flips) m.direction = m.direction === 1 ? -1 : 1;
  } else if (m.type === 'mirror') {
    if (m.axis !== 1) m.axis = m.axis === 0 ? 2 : 0;
  } else if (m.type === 'move') {
    const [x, y, z] = m.offset;
    m.offset = dir === 1 ? [z, y, -x] : [-z, y, x];
  }
}

/**
 * Apply one array modifier to `src` (same grid size out). `detail` is grid
 * cells per voxel, so the gap is measured in voxels like everything in the UI.
 * Copies falling outside the grid are clipped.
 */
export function applyArray(src: VoxelData, mod: ArrayModifier, detail: number): VoxelData {
  const bounds = src.filledBounds();
  if (!bounds || mod.count <= 1) return src;
  const axis = mod.axis;
  const lo = [bounds.min.x, bounds.min.y, bounds.min.z][axis];
  const hi = [bounds.max.x, bounds.max.y, bounds.max.z][axis];
  // relative offset: one whole part-length per copy (bounds max is exclusive), plus the gap
  const step = Math.max(1, hi - lo + mod.gap * detail);
  const out = src.clone();
  src.forEachFilled((x, y, z, c) => {
    for (let i = 1; i < mod.count; i++) {
      const p = [x, y, z];
      p[axis] += step * i * mod.direction;
      if (out.inBounds(p[0], p[1], p[2])) out.set(p[0], p[1], p[2], c);
    }
  });
  return out;
}

/** Mirror across the grid-centre plane that flips `axis`; the original stays. */
export function applyMirror(src: VoxelData, mod: MirrorModifier): VoxelData {
  const size = [src.sizeX, src.sizeY, src.sizeZ][mod.axis];
  const out = src.clone();
  src.forEachFilled((x, y, z, c) => {
    const p = [x, y, z];
    p[mod.axis] = size - 1 - p[mod.axis];
    out.set(p[0], p[1], p[2], c);
  });
  return out;
}

/** Shift by whole voxels; whatever leaves the grid is clipped. */
export function applyMove(src: VoxelData, mod: MoveModifier, detail: number): VoxelData {
  const [dx, dy, dz] = mod.offset.map((v) => v * detail);
  const out = new VoxelData(src.sizeX, src.sizeY, src.sizeZ);
  src.forEachFilled((x, y, z, c) => {
    if (out.inBounds(x + dx, y + dy, z + dz)) out.set(x + dx, y + dy, z + dz, c);
  });
  return out;
}

/**
 * Copies turned about the vertical axis through the grid centre — 180° for
 * 2, every 90° for 4. Only right angles, so voxels stay on the grid. On a
 * non-square footprint the turned copies can reach past the grid and are clipped.
 */
export function applyRadial(src: VoxelData, mod: RadialModifier): VoxelData {
  const out = src.clone();
  const cx = src.sizeX / 2;
  const cz = src.sizeZ / 2;
  const turns = mod.count === 2 ? [2] : [1, 2, 3];
  src.forEachFilled((x, y, z, c) => {
    // cell centre relative to the grid centre
    const px = x + 0.5 - cx;
    const pz = z + 0.5 - cz;
    for (const t of turns) {
      const [rx, rz] = t === 1 ? [pz, -px] : t === 2 ? [-px, -pz] : [-pz, px];
      const nx = Math.floor(cx + rx);
      const nz = Math.floor(cz + rz);
      if (out.inBounds(nx, y, nz)) out.set(nx, y, nz, c);
    }
  });
  return out;
}

function applyModifier(src: VoxelData, m: Modifier, detail: number): VoxelData {
  switch (m.type) {
    case 'array':
      return applyArray(src, m, detail);
    case 'mirror':
      return applyMirror(src, m);
    case 'move':
      return applyMove(src, m, detail);
    case 'radial':
      return applyRadial(src, m);
  }
}

/** The part as it's meant to look: its voxels with every enabled modifier applied, top to bottom. */
export function evaluatePart(part: VoxelPart, detail: number): VoxelData {
  let data = part.data;
  for (const m of part.modifiers) if (modifierActive(m)) data = applyModifier(data, m, detail);
  return data;
}

/**
 * Every part of an object merged into one grid, modifiers applied. Later parts
 * win where they overlap. `skip` leaves one part's own voxels out (its
 * generated copies stay) — the dimmed context around the part being edited.
 */
export function mergeParts(parts: VoxelPart[], detail: number, skip?: VoxelPart): VoxelData {
  const first = parts[0].data;
  const out = new VoxelData(first.sizeX, first.sizeY, first.sizeZ);
  for (const part of parts) {
    const evaluated = evaluatePart(part, detail);
    evaluated.forEachFilled((x, y, z, c) => {
      if (part === skip && part.data.get(x, y, z) !== 0) return;
      out.set(x, y, z, c);
    });
  }
  return out;
}
