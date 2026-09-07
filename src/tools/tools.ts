import * as THREE from 'three';
import type { Tool, ToolContext, PointerInfo, ToolId } from './types';
import type { BuildPlane } from '@/viewport/Picker';
import {
  clampSelection,
  makeSelection,
  selectionContains,
  translateSelection,
} from '@/core/ops/selection';
import { moveSelection } from '@/editor/selectionOps';

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function cursorAdd(v: THREE.Vector3, color = 0x8fd3ff) {
  return { min: v.clone(), max: v.clone().addScalar(1), color };
}

/** Snap a cell down to the brush grid (block-aligned placement). */
function brushOrigin(v: THREE.Vector3, b: number): THREE.Vector3 {
  return new THREE.Vector3(
    Math.floor(v.x / b) * b,
    Math.floor(v.y / b) * b,
    Math.floor(v.z / b) * b,
  );
}

/** The axis (0=x, 1=y, 2=z) a face normal points along. */
function normalAxis(n: THREE.Vector3): 0 | 1 | 2 {
  const ax = Math.abs(n.x);
  const ay = Math.abs(n.y);
  const az = Math.abs(n.z);
  return ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
}

/** Every integer cell on the 3D line from `a` to `b`, endpoints included. */
function lineCells(a: THREE.Vector3, b: THREE.Vector3): Array<[number, number, number]> {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
  if (steps === 0) return [[Math.round(a.x), Math.round(a.y), Math.round(a.z)]];
  const out: Array<[number, number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    out.push([Math.round(a.x + dx * t), Math.round(a.y + dy * t), Math.round(a.z + dz * t)]);
  }
  return out;
}

/** Snap `t` onto the single axis it has moved furthest along from `anchor`. */
function axisLock(anchor: THREE.Vector3, t: THREE.Vector3): THREE.Vector3 {
  const dx = Math.abs(t.x - anchor.x);
  const dy = Math.abs(t.y - anchor.y);
  const dz = Math.abs(t.z - anchor.z);
  const out = anchor.clone();
  if (dx >= dy && dx >= dz) out.x = t.x;
  else if (dy >= dz) out.y = t.y;
  else out.z = t.z;
  return out;
}

/**
 * Place or erase voxels, click or drag. A drag locks to the plane of the first
 * hit (the face you clicked) so it never wanders onto another face or drills into
 * the object. Hold Shift to further constrain to a straight line.
 */
export class PlaceEraseTool implements Tool {
  private drawing = false;
  private visited = new Set<string>();
  private anchor: THREE.Vector3 | null = null;
  private last: THREE.Vector3 | null = null;
  private lockAxis: 0 | 1 | 2 = 1;
  private lockValue = 0;
  constructor(public readonly id: 'place' | 'erase') {}

  private target(ctx: ToolContext, p: PointerInfo) {
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit) return null;
    return this.id === 'place' ? hit.place : hit.remove;
  }

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    const t = hit && (this.id === 'place' ? hit.place : hit.remove);
    if (!hit || !t || !ctx.data.inBounds(t.x, t.y, t.z)) return;
    this.drawing = true;
    this.visited.clear();
    this.anchor = t.clone();
    this.last = null;
    this.lockAxis = normalAxis(hit.normal);
    this.lockValue = t.getComponent(this.lockAxis);

    ctx.begin(this.id === 'place' ? 'Place' : 'Erase');
    this.stamp(ctx, t);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const color = this.id === 'place' ? 0x4db8ff : 0xff2d2d;
    if (!this.drawing) {
      const t = this.target(ctx, p);
      if (t) {
        const b = ctx.brushSize;
        const o = brushOrigin(t, b);
        ctx.setCursor({ min: o, max: o.clone().addScalar(b), color });
      } else {
        ctx.setCursor(null);
      }
      return;
    }
    let t = ctx.pickOnPlane(p.clientX, p.clientY, this.lockAxis, this.lockValue);
    if (!t) return;
    if (p.shiftKey && this.anchor) t = axisLock(this.anchor, t);
    this.stamp(ctx, t);
  }

  pointerUp(ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.anchor = this.last = null;
    ctx.commit();
  }

  clearPreview(ctx: ToolContext): void {
    if (this.drawing) {
      this.drawing = false;
      this.anchor = this.last = null;
      ctx.commit();
    }
    ctx.setCursor(null);
  }

  private stamp(ctx: ToolContext, t: THREE.Vector3): void {
    const value = this.id === 'place' ? ctx.colorIndex + 1 : 0;
    const b = ctx.brushSize;
    for (const [lx, ly, lz] of lineCells(this.last ?? t, t)) {
      const ox = Math.floor(lx / b) * b;
      const oy = Math.floor(ly / b) * b;
      const oz = Math.floor(lz / b) * b;
      const k = key(ox, oy, oz);
      if (this.visited.has(k)) continue;
      this.visited.add(k);
      for (let dz = 0; dz < b; dz++)
        for (let dy = 0; dy < b; dy++)
          for (let dx = 0; dx < b; dx++) {
            if (ctx.data.inBounds(ox + dx, oy + dy, oz + dz)) {
              ctx.write(ox + dx, oy + dy, oz + dz, value);
            }
          }
    }
    this.last = t.clone();
  }
}

/** Two-corner cuboid fill / erase. */
export class BoxTool implements Tool {
  readonly id: ToolId = 'box';
  mode: 'fill' | 'erase' = 'fill';
  private start: THREE.Vector3 | null = null;
  private end: THREE.Vector3 | null = null;
  private lockAxis: 0 | 1 | 2 = 1;
  private lockValue = 0;

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit) return;
    const v = this.mode === 'erase' && hit.remove ? hit.remove : hit.place;
    this.start = clampToGrid(v, ctx);
    this.end = this.start.clone();
    // the box stays flat on the plane of the first corner for the whole drag
    this.lockAxis = normalAxis(hit.normal);
    this.lockValue = this.start.getComponent(this.lockAxis);
    this.updateCursor(ctx);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.start) {
      const hit = ctx.pick(p.clientX, p.clientY);
      if (hit) ctx.setCursor(cursorAdd(hit.place, this.mode === 'erase' ? 0xff2d2d : 0x4db8ff));
      else ctx.setCursor(null);
      return;
    }
    const t = ctx.pickOnPlane(p.clientX, p.clientY, this.lockAxis, this.lockValue);
    if (t) this.end = clampToGrid(t, ctx);
    this.updateCursor(ctx);
  }

  pointerUp(ctx: ToolContext): void {
    if (!this.start || !this.end) return;
    const [a, b] = ordered(this.start, this.end);
    ctx.begin(this.mode === 'fill' ? 'Box fill' : 'Box erase');
    for (let z = a.z; z <= b.z; z++)
      for (let y = a.y; y <= b.y; y++)
        for (let x = a.x; x <= b.x; x++) {
          if (!ctx.data.inBounds(x, y, z)) continue;
          ctx.write(x, y, z, this.mode === 'fill' ? ctx.colorIndex + 1 : 0);
        }
    ctx.commit();
    this.start = this.end = null;
    ctx.setCursor(null);
  }

  clearPreview(ctx: ToolContext): void {
    this.start = this.end = null;
    ctx.setCursor(null);
  }

  private updateCursor(ctx: ToolContext): void {
    if (!this.start || !this.end) return;
    const [a, b] = ordered(this.start, this.end);
    ctx.setCursor({
      min: new THREE.Vector3(a.x, a.y, a.z),
      max: new THREE.Vector3(b.x + 1, b.y + 1, b.z + 1),
      color: this.mode === 'erase' ? 0xff2d2d : 0x4db8ff,
    });
  }
}

/** Recolour existing voxels without adding or removing. Hold Shift for a line. */
export class PaintTool implements Tool {
  readonly id: ToolId = 'paint';
  private drawing = false;
  private visited = new Set<string>();
  private anchor: THREE.Vector3 | null = null;
  private last: THREE.Vector3 | null = null;
  private lockAxis: 0 | 1 | 2 = 1;
  private lockValue = 0;

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit?.remove) return;
    this.drawing = true;
    this.visited.clear();
    this.anchor = hit.remove.clone();
    this.last = null;
    this.lockAxis = normalAxis(hit.normal);
    this.lockValue = hit.remove.getComponent(this.lockAxis);
    ctx.begin('Paint');
    this.stamp(ctx, hit.remove);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    if (!this.drawing) {
      const hit = ctx.pick(p.clientX, p.clientY);
      ctx.setCursor(hit?.remove ? cursorAdd(hit.remove, 0xffe08a) : null);
      return;
    }
    let t = ctx.pickOnPlane(p.clientX, p.clientY, this.lockAxis, this.lockValue);
    if (!t) return;
    if (p.shiftKey && this.anchor) t = axisLock(this.anchor, t);
    this.stamp(ctx, t);
  }

  pointerUp(ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    this.anchor = this.last = null;
    ctx.commit();
  }

  clearPreview(ctx: ToolContext): void {
    if (this.drawing) {
      this.drawing = false;
      this.anchor = this.last = null;
      ctx.commit();
    }
    ctx.setCursor(null);
  }

  private stamp(ctx: ToolContext, t: THREE.Vector3): void {
    const value = ctx.colorIndex + 1;
    for (const [x, y, z] of lineCells(this.last ?? t, t)) {
      if (!ctx.data.isSolid(x, y, z)) continue;
      const k = key(x, y, z);
      if (this.visited.has(k)) continue;
      this.visited.add(k);
      ctx.write(x, y, z, value);
    }
    this.last = t.clone();
  }
}

/** Pick the colour of the voxel under the cursor into the active palette slot. */
export class EyedropperTool implements Tool {
  readonly id: ToolId = 'eyedropper';

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit?.remove) return;
    const c = ctx.data.getColor(hit.remove.x, hit.remove.y, hit.remove.z);
    if (c >= 0) ctx.pickColor(c);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const hit = ctx.pick(p.clientX, p.clientY);
    ctx.setCursor(hit?.remove ? cursorAdd(hit.remove, 0xffffff) : null);
  }

  pointerUp(): void {}

  clearPreview(ctx: ToolContext): void {
    ctx.setCursor(null);
  }
}

function clampToGrid(v: THREE.Vector3, ctx: ToolContext): THREE.Vector3 {
  return new THREE.Vector3(
    Math.max(0, Math.min(ctx.data.sizeX - 1, v.x)),
    Math.max(0, Math.min(ctx.data.sizeY - 1, v.y)),
    Math.max(0, Math.min(ctx.data.sizeZ - 1, v.z)),
  );
}

/** The two axes (0=x,1=y,2=z) that lie in the given build plane. */
function planeAxes(plane: BuildPlane): [number, number] {
  if (plane === 'xy') return [0, 1];
  if (plane === 'yz') return [1, 2];
  return [0, 2];
}

/** Box-select voxels, then drag inside the box to slide them on the build plane. */
export class SelectTool implements Tool {
  readonly id: ToolId = 'select';
  private phase: 'idle' | 'box' | 'move' = 'idle';
  private cornerA: THREE.Vector3 | null = null;
  private cornerB: THREE.Vector3 | null = null;
  private moveFrom: THREE.Vector3 | null = null;
  private moveDelta: [number, number, number] = [0, 0, 0];

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit) return;
    const sel = ctx.selection;
    const under = hit.remove ?? hit.place;

    if (sel && hit.remove && selectionContains(sel, under.x, under.y, under.z)) {
      this.phase = 'move';
      this.moveFrom = under.clone();
      this.moveDelta = [0, 0, 0];
      return;
    }
    this.phase = 'box';
    this.cornerA = clampToGrid(under, ctx);
    this.cornerB = this.cornerA.clone();
    this.drawBox(ctx, this.cornerA, this.cornerB, 0x8bffa0);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const hit = ctx.pick(p.clientX, p.clientY);

    if (this.phase === 'idle') {
      ctx.setCursor(null);
      return;
    }
    if (this.phase === 'box') {
      if (hit) this.cornerB = clampToGrid(hit.remove ?? hit.place, ctx);
      if (this.cornerA && this.cornerB) this.drawBox(ctx, this.cornerA, this.cornerB, 0x8bffa0);
      return;
    }
    // move
    const sel = ctx.selection;
    if (!hit || !this.moveFrom || !sel) return;
    const to = hit.remove ?? hit.place;
    const raw = [to.x - this.moveFrom.x, to.y - this.moveFrom.y, to.z - this.moveFrom.z];
    const d: [number, number, number] = [0, 0, 0];
    for (const ax of planeAxes(ctx.buildPlane)) d[ax] = Math.round(raw[ax]);
    this.moveDelta = d;
    const preview = translateSelection(sel, d);
    ctx.setCursor({
      min: new THREE.Vector3(...preview.min),
      max: new THREE.Vector3(preview.max[0] + 1, preview.max[1] + 1, preview.max[2] + 1),
      color: 0xffe08a,
    });
  }

  pointerUp(ctx: ToolContext): void {
    if (this.phase === 'box' && this.cornerA && this.cornerB) {
      const box = makeSelection(
        [this.cornerA.x, this.cornerA.y, this.cornerA.z],
        [this.cornerB.x, this.cornerB.y, this.cornerB.z],
      );
      ctx.setSelection(clampSelection(box, ctx.data));
    } else if (this.phase === 'move' && ctx.selection) {
      moveSelection(ctx, ctx.selection, this.moveDelta);
    }
    this.reset(ctx);
  }

  clearPreview(ctx: ToolContext): void {
    this.reset(ctx);
  }

  private reset(ctx: ToolContext): void {
    this.phase = 'idle';
    this.cornerA = this.cornerB = this.moveFrom = null;
    this.moveDelta = [0, 0, 0];
    ctx.setCursor(null);
  }

  private drawBox(ctx: ToolContext, a: THREE.Vector3, b: THREE.Vector3, color: number): void {
    const s = makeSelection([a.x, a.y, a.z], [b.x, b.y, b.z]);
    ctx.setCursor({
      min: new THREE.Vector3(...s.min),
      max: new THREE.Vector3(s.max[0] + 1, s.max[1] + 1, s.max[2] + 1),
      color,
    });
  }
}

function ordered(a: THREE.Vector3, b: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  return [
    new THREE.Vector3(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.min(a.z, b.z)),
    new THREE.Vector3(Math.max(a.x, b.x), Math.max(a.y, b.y), Math.max(a.z, b.z)),
  ];
}

export function createTool(id: ToolId): Tool {
  switch (id) {
    case 'place':
      return new PlaceEraseTool('place');
    case 'erase':
      return new PlaceEraseTool('erase');
    case 'box':
      return new BoxTool();
    case 'paint':
      return new PaintTool();
    case 'eyedropper':
      return new EyedropperTool();
    case 'select':
      return new SelectTool();
    default:
      return new PlaceEraseTool('place');
  }
}
