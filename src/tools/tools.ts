import * as THREE from 'three';
import type { Tool, ToolContext, PointerInfo, ToolId } from './types';

const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

function cursorAdd(v: THREE.Vector3, color = 0x8fd3ff) {
  return { min: v.clone(), max: v.clone().addScalar(1), color };
}

/** Place or erase single voxels, click or drag. */
export class PlaceEraseTool implements Tool {
  private drawing = false;
  private visited = new Set<string>();
  constructor(public readonly id: 'place' | 'erase') {}

  private target(ctx: ToolContext, p: PointerInfo) {
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit) return null;
    return this.id === 'place' ? hit.place : hit.remove;
  }

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const t = this.target(ctx, p);
    if (!t || !ctx.data.inBounds(t.x, t.y, t.z)) return;
    this.drawing = true;
    this.visited.clear();
    ctx.begin(this.id === 'place' ? 'Place' : 'Erase');
    this.stamp(ctx, t);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const t = this.target(ctx, p);
    if (!this.drawing) {
      ctx.setCursor(t ? cursorAdd(t, this.id === 'place' ? 0x8fd3ff : 0xff8f8f) : null);
      return;
    }
    if (t && ctx.data.inBounds(t.x, t.y, t.z)) this.stamp(ctx, t);
  }

  pointerUp(ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    ctx.commit();
  }

  clearPreview(ctx: ToolContext): void {
    if (this.drawing) {
      this.drawing = false;
      ctx.commit();
    }
    ctx.setCursor(null);
  }

  private stamp(ctx: ToolContext, t: THREE.Vector3): void {
    const k = key(t.x, t.y, t.z);
    if (this.visited.has(k)) return;
    this.visited.add(k);
    ctx.write(t.x, t.y, t.z, this.id === 'place' ? ctx.colorIndex + 1 : 0);
  }
}

/** Two-corner cuboid fill / erase. */
export class BoxTool implements Tool {
  readonly id: ToolId = 'box';
  mode: 'fill' | 'erase' = 'fill';
  private start: THREE.Vector3 | null = null;
  private end: THREE.Vector3 | null = null;

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit) return;
    const v = this.mode === 'erase' && hit.remove ? hit.remove : hit.place;
    this.start = clampToGrid(v, ctx);
    this.end = this.start.clone();
    this.updateCursor(ctx);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!this.start) {
      if (hit) ctx.setCursor(cursorAdd(hit.place, this.mode === 'erase' ? 0xff8f8f : 0x8fd3ff));
      else ctx.setCursor(null);
      return;
    }
    if (hit) {
      const v = this.mode === 'erase' && hit.remove ? hit.remove : hit.place;
      this.end = clampToGrid(v, ctx);
    }
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
      color: this.mode === 'erase' ? 0xff6b6b : 0x6bd1ff,
    });
  }
}

/** Recolour existing voxels without adding or removing. */
export class PaintTool implements Tool {
  readonly id: ToolId = 'paint';
  private drawing = false;
  private visited = new Set<string>();

  pointerDown(ctx: ToolContext, p: PointerInfo): void {
    if (p.button !== 0) return;
    this.drawing = true;
    this.visited.clear();
    ctx.begin('Paint');
    this.stamp(ctx, p);
  }

  pointerMove(ctx: ToolContext, p: PointerInfo): void {
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!this.drawing) {
      ctx.setCursor(hit?.remove ? cursorAdd(hit.remove, 0xffe08a) : null);
      return;
    }
    this.stamp(ctx, p);
  }

  pointerUp(ctx: ToolContext): void {
    if (!this.drawing) return;
    this.drawing = false;
    ctx.commit();
  }

  clearPreview(ctx: ToolContext): void {
    if (this.drawing) {
      this.drawing = false;
      ctx.commit();
    }
    ctx.setCursor(null);
  }

  private stamp(ctx: ToolContext, p: PointerInfo): void {
    const hit = ctx.pick(p.clientX, p.clientY);
    if (!hit?.remove) return;
    const t = hit.remove;
    if (!ctx.data.isSolid(t.x, t.y, t.z)) return;
    const k = key(t.x, t.y, t.z);
    if (this.visited.has(k)) return;
    this.visited.add(k);
    ctx.write(t.x, t.y, t.z, ctx.colorIndex + 1);
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
    default:
      return new PlaceEraseTool('place');
  }
}
