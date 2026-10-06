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

/**
 * Blender-subdivision-like rounding at cell resolution: edges and corners get
 * rounded, inner corners filled. Works in grid cells, so it needs a subdivided
 * object to look smooth — adding it to a coarse one subdivides it first.
 */
export interface SmoothModifier {
  id: string;
  type: 'smooth';
  enabled: boolean;
  /** how far the rounding reaches, in voxels (SMOOTH_MIN–SMOOTH_MAX, fractions allowed) */
  radius: number;
}

/**
 * Drops the voxel look: the part is drawn and exported as one smooth surface
 * (see core/mesh/surfaceNets), colours kept hard where they were painted. It doesn't
 * change any voxels, so it acts on the finished part wherever it sits in the
 * stack; the part's voxels stay editable as a cage.
 */
export interface UnvoxelModifier {
  id: string;
  type: 'unvoxel';
  enabled: boolean;
  /** 0 = still voxels, 100 = fully rounded */
  strength: number;
}

export type Modifier = ArrayModifier | MirrorModifier | MoveModifier | RadialModifier | SmoothModifier | UnvoxelModifier;
export type ModifierType = Modifier['type'];

/** Does this modifier change anything right now? */
export function modifierActive(m: Modifier): boolean {
  if (!m.enabled) return false;
  switch (m.type) {
    case 'array':
      return m.count > 1;
    case 'move':
      return m.offset.some((v) => v !== 0);
    case 'unvoxel':
      return m.strength > 0;
    default:
      return true;
  }
}

export interface VoxelPartJson {
  id: string;
  name: string;
  data: VoxelDataJson;
  modifiers?: Modifier[];
  /** left out of the look and the export */
  hidden?: boolean;
}

/** One mesh of an object: its own voxels in the object's shared grid, plus modifiers. */
export class VoxelPart {
  id: string;
  name: string;
  data: VoxelData;
  modifiers: Modifier[];
  /** Switched off: not drawn (but as a cage while it's the part being edited) and not exported. */
  hidden: boolean;

  constructor(opts: { id?: string; name: string; data: VoxelData; modifiers?: Modifier[]; hidden?: boolean }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.data = opts.data;
    this.modifiers = opts.modifiers ?? [];
    this.hidden = opts.hidden ?? false;
  }

  get hasActiveModifiers(): boolean {
    return this.modifiers.some(modifierActive);
  }

  /** Is it rounded off? Then its own voxels are only the cage of what shows. */
  get isSmoothed(): boolean {
    return this.modifiers.some((m) => (m.type === 'smooth' || m.type === 'unvoxel') && modifierActive(m));
  }

  /** The un-voxel strength (0–100) when the part is drawn as a smooth surface, else 0. */
  get unvoxelStrength(): number {
    let strength = 0;
    for (const m of this.modifiers) if (m.type === 'unvoxel' && modifierActive(m)) strength = m.strength;
    return strength;
  }

  clone(): VoxelPart {
    return new VoxelPart({
      name: this.name,
      data: this.data.clone(),
      modifiers: this.modifiers.map((m) => cloneModifier(m, crypto.randomUUID())),
      hidden: this.hidden,
    });
  }

  toJSON(): VoxelPartJson {
    const json: VoxelPartJson = {
      id: this.id,
      name: this.name,
      data: this.data.toJSON(),
      modifiers: this.modifiers.map((m) => cloneModifier(m, m.id)),
    };
    if (this.hidden) json.hidden = true;
    return json;
  }

  static fromJSON(json: VoxelPartJson): VoxelPart {
    return new VoxelPart({
      id: json.id,
      name: json.name,
      data: VoxelData.fromJSON(json.data),
      modifiers: (json.modifiers ?? []).map(normalizeModifier),
      hidden: json.hidden === true,
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
    case 'smooth':
      return { id, type, enabled: true, radius: 2 };
    case 'unvoxel':
      return { id, type, enabled: true, strength: 50 };
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
    case 'smooth': {
      // files from before the radius had `level` 1–3, which meant as many voxels
      const legacy = (m as { level?: unknown }).level;
      const v = Number(m.radius ?? legacy ?? 2);
      const radius = Number.isFinite(v) ? Math.min(SMOOTH_MAX, Math.max(SMOOTH_MIN, v)) : 2;
      return { id, type: 'smooth', enabled, radius: Math.round(radius * 100) / 100 };
    }
    case 'unvoxel': {
      const v = Number(m.strength ?? 50);
      return { id, type: 'unvoxel', enabled, strength: Number.isFinite(v) ? Math.min(100, Math.max(0, Math.round(v))) : 50 };
    }
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
 * +X → +Z and +Z → −X. Radial copies sit around the centre and smoothing is
 * the same in every direction, so neither changes.
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

/** Smooth radius limits, in voxels — the upper one keeps the re-evaluation per edit bearable. */
export const SMOOTH_MIN = 0.25;
export const SMOOTH_MAX = 6;

/** Box-blur radius in cells for one pass, so all passes together reach `radius` voxels. */
function smoothRadius(radius: number, detail: number): number {
  return Math.max(1, Math.round((radius * detail) / SMOOTH_PASSES));
}

/** Blur passes of the smooth modifier — two box blurs make a tent kernel, rounder than one. */
const SMOOTH_PASSES = 2;

/**
 * Round the part off: blur its occupancy with a box kernel (`SMOOTH_PASSES`
 * times) and keep every cell that ends up more than half full. Flat faces stay
 * where they are, outer edges/corners get rounded, inner ones filled. A cell
 * that wasn't solid before takes the colour of the nearest original voxel.
 * Only the filled bounds plus the reach of the blur are processed.
 *
 * The cut is relative to the fullest spot in reach, so thin rods and plates
 * keep their thickness instead of melting away; new cells still need a
 * half-full blur, so thin bits don't swell either.
 */
export function applySmooth(src: VoxelData, mod: SmoothModifier, detail: number): VoxelData {
  const b = src.filledBounds();
  if (!b) return src;
  const r = smoothRadius(mod.radius, detail);
  const pad = r * SMOOTH_PASSES;
  // the box may reach past the grid (clipping it there would cut into the
  // blur and shrink faces lying on the grid edge); writing out clips instead
  const x0 = b.min.x - pad, y0 = b.min.y - pad, z0 = b.min.z - pad;
  const nx = b.max.x - b.min.x + 2 * pad;
  const ny = b.max.y - b.min.y + 2 * pad;
  const nz = b.max.z - b.min.z + 2 * pad;
  const sy = nx, sz = nx * ny;
  const n = nx * ny * nz;

  // colour + 1 per cell (0 = empty), and the occupancy to blur
  const color = new Int32Array(n);
  let occ = new Float32Array(n);
  src.forEachFilled((x, y, z, c) => {
    const i = x - x0 + (y - y0) * sy + (z - z0) * sz;
    color[i] = c + 1;
    occ[i] = 1;
  });

  // separable box blur, outside the box counts as empty
  let tmp = new Float32Array(n);
  const width = 2 * r + 1;
  const dims = [nx, ny, nz];
  const strides = [1, sy, sz];
  for (let pass = 0; pass < SMOOTH_PASSES; pass++) {
    for (let axis = 0; axis < 3; axis++) {
      const len = dims[axis];
      const step = strides[axis];
      const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
      for (let v = 0; v < dims[va]; v++)
        for (let u = 0; u < dims[ua]; u++) {
          const base = u * strides[ua] + v * strides[va];
          let sum = 0;
          for (let k = 0; k <= Math.min(r, len - 1); k++) sum += occ[base + k * step];
          for (let k = 0; k < len; k++) {
            tmp[base + k * step] = sum / width;
            const add = k + r + 1;
            const drop = k - r;
            if (add < len) sum += occ[base + add * step];
            if (drop >= 0) sum -= occ[base + drop * step];
          }
        }
      [occ, tmp] = [tmp, occ];
    }
  }

  // How full the fullest spot in reach is. Against a thick body that's 1 and
  // the cut sits at the usual half; inside a thin rod or plate the blur never
  // gets near 1, so the cut drops with it — thin bits get rounded, not erased.
  const peak = tmp;
  peak.set(occ);
  const reach = r * SMOOTH_PASSES;
  const line = new Float32Array(Math.max(nx, ny, nz));
  const deque = new Int32Array(line.length);
  for (let axis = 0; axis < 3; axis++) {
    const len = dims[axis];
    const step = strides[axis];
    const [ua, va] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    for (let v = 0; v < dims[va]; v++)
      for (let u = 0; u < dims[ua]; u++) {
        const base = u * strides[ua] + v * strides[va];
        for (let k = 0; k < len; k++) line[k] = peak[base + k * step];
        // sliding-window max over [k - reach, k + reach] with a monotonic deque
        let qh = 0, qt = 0, next = 0;
        for (let k = 0; k < len; k++) {
          for (; next < len && next <= k + reach; next++) {
            while (qt > qh && line[deque[qt - 1]] <= line[next]) qt--;
            deque[qt++] = next;
          }
          while (deque[qh] < k - reach) qh++;
          peak[base + k * step] = line[deque[qh]];
        }
      }
  }

  const solid = color.map((c) => (c !== 0 ? 1 : 0));
  // nearest original colour for every cell (multi-source BFS, 6-connected)
  const queue = new Int32Array(n);
  let head = 0, tail = 0;
  for (let i = 0; i < n; i++) if (color[i] !== 0) queue[tail++] = i;
  while (head < tail) {
    const i = queue[head++];
    const x = i % nx, y = ((i / sy) | 0) % ny, z = (i / sz) | 0;
    const c = color[i];
    if (x > 0 && color[i - 1] === 0) { color[i - 1] = c; queue[tail++] = i - 1; }
    if (x < nx - 1 && color[i + 1] === 0) { color[i + 1] = c; queue[tail++] = i + 1; }
    if (y > 0 && color[i - sy] === 0) { color[i - sy] = c; queue[tail++] = i - sy; }
    if (y < ny - 1 && color[i + sy] === 0) { color[i + sy] = c; queue[tail++] = i + sy; }
    if (z > 0 && color[i - sz] === 0) { color[i - sz] = c; queue[tail++] = i - sz; }
    if (z < nz - 1 && color[i + sz] === 0) { color[i + sz] = c; queue[tail++] = i + sz; }
  }

  const out = new VoxelData(src.sizeX, src.sizeY, src.sizeZ);
  for (let z = 0; z < nz; z++)
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < nx; x++) {
        const i = x + y * sy + z * sz;
        if (occ[i] > (solid[i] ? 0.5 * peak[i] : 0.5) && out.inBounds(x + x0, y + y0, z + z0)) out.set(x + x0, y + y0, z + z0, color[i] - 1);
      }
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
    case 'smooth':
      return applySmooth(src, m, detail);
    case 'unvoxel':
      return src; // changes how the part is meshed, not its voxels
  }
}

/** The part as it's meant to look: its voxels with every enabled modifier applied, top to bottom. */
export function evaluatePart(part: VoxelPart, detail: number): VoxelData {
  let data = part.data;
  for (const m of part.modifiers) if (modifierActive(m)) data = applyModifier(data, m, detail);
  return data;
}

/**
 * Every visible part of an object merged into one grid, modifiers applied.
 * Later parts win where they overlap. `skip` leaves one part's own voxels out
 * (its generated copies stay) — the dimmed context around the part being
 * edited. `voxelOnly` leaves out the un-voxeled parts, which are meshed on
 * their own.
 */
export function mergeParts(parts: VoxelPart[], detail: number, skip?: VoxelPart, voxelOnly = false): VoxelData {
  const first = parts[0].data;
  const out = new VoxelData(first.sizeX, first.sizeY, first.sizeZ);
  for (const part of parts) {
    if (part.hidden || (voxelOnly && part.unvoxelStrength > 0)) continue;
    const evaluated = evaluatePart(part, detail);
    evaluated.forEachFilled((x, y, z, c) => {
      if (part === skip && part.data.get(x, y, z) !== 0) return;
      out.set(x, y, z, c);
    });
  }
  return out;
}

/** A part drawn as a smooth surface instead of voxels: its finished voxels plus how smooth. */
export interface SmoothLayer {
  /** stable per part — `objectId/partId` */
  key: string;
  data: VoxelData;
  strength: number;
}

/** The visible un-voxeled parts of an object, modifiers applied — meshed apart from the voxel parts. */
export function smoothLayers(objectId: string, parts: VoxelPart[], detail: number): SmoothLayer[] {
  return parts
    .filter((p) => !p.hidden && p.unvoxelStrength > 0)
    .map((p) => ({ key: `${objectId}/${p.id}`, data: evaluatePart(p, detail), strength: p.unvoxelStrength }));
}
