import { VoxelData } from '@/core/voxel/VoxelData';
import { createDefaultPalette, type Palette } from '@/core/palette';
import { VoxelObject } from './VoxelObject';
import { CELLS_PER_VOXEL } from '@/core/voxel/constants';
import {
  defaultExportSettings,
  normalizeExportSettings,
  type ExportSettings,
  type ProjectJson,
} from './types';

export class Project {
  id: string;
  name: string;
  palette: Palette;
  exportSettings: ExportSettings;
  objects: VoxelObject[];
  activeObjectId: string | null;

  constructor(opts: {
    id?: string;
    name: string;
    palette?: Palette;
    exportSettings?: ExportSettings;
    objects?: VoxelObject[];
    activeObjectId?: string | null;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.palette = opts.palette ?? createDefaultPalette();
    this.exportSettings = opts.exportSettings ?? defaultExportSettings();
    this.objects = opts.objects ?? [];
    this.activeObjectId = opts.activeObjectId ?? this.objects[0]?.id ?? null;
  }

  static createNew(name: string): Project {
    const project = new Project({ name });
    const first = project.addObject('Object', [16, 16, 16]);
    project.activeObjectId = first.id;
    return project;
  }

  getActive(): VoxelObject | null {
    return this.objects.find((o) => o.id === this.activeObjectId) ?? null;
  }

  getById(id: string): VoxelObject | null {
    return this.objects.find((o) => o.id === id) ?? null;
  }

  private uniqueName(base: string): string {
    const names = new Set(this.objects.map((o) => o.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!names.has(candidate)) return candidate;
    }
  }

  addObject(name: string, size: [number, number, number]): VoxelObject {
    const obj = new VoxelObject({
      name: this.uniqueName(name),
      data: new VoxelData(size[0], size[1], size[2]),
    });
    this.objects.push(obj);
    return obj;
  }

  /** Create a linked overlay object that builds on top of `id`. */
  extend(id: string): VoxelObject | null {
    const base = this.getById(id);
    if (!base) return null;
    const overlay = new VoxelObject({
      name: this.uniqueName(`${base.name} extend`),
      kind: 'extend',
      baseId: base.id,
      data: new VoxelData(base.data.sizeX, base.data.sizeY, base.data.sizeZ),
      pivot: base.pivot,
      detail: base.detail, // overlay grid lines up with the base
    });
    const idx = this.objects.findIndex((o) => o.id === id);
    this.objects.splice(idx + 1, 0, overlay);
    return overlay;
  }

  /** Independent, unlinked copy. */
  duplicate(id: string): VoxelObject | null {
    const src = this.getById(id);
    if (!src) return null;
    const copy = new VoxelObject({
      name: this.uniqueName(`${src.name} copy`),
      kind: 'normal',
      data: src.data.clone(),
      pivot: src.pivot,
      detail: src.detail,
    });
    const idx = this.objects.findIndex((o) => o.id === id);
    this.objects.splice(idx + 1, 0, copy);
    return copy;
  }

  remove(id: string): void {
    this.objects = this.objects.filter((o) => o.id !== id && o.baseId !== id);
    if (this.activeObjectId === id) this.activeObjectId = this.objects[0]?.id ?? null;
  }

  rename(id: string, name: string): void {
    const obj = this.getById(id);
    if (obj) obj.name = this.uniqueName(name.trim() || obj.name);
  }

  toJSON(): ProjectJson {
    return {
      format: 'voxeleditor-project',
      version: 1,
      id: this.id,
      name: this.name,
      palette: this.palette,
      exportSettings: this.exportSettings,
      objects: this.objects.map((o) => o.toJSON()),
      activeObjectId: this.activeObjectId,
    };
  }

  static fromJSON(json: ProjectJson): Project {
    if (json.format !== 'voxeleditor-project') {
      throw new Error('Not a voxeleditor project file');
    }
    const objects = json.objects.map((o) => VoxelObject.fromJSON(o));
    // a mid-transition file may carry detail 2/3 — normalise to the fixed grid
    for (const o of objects) {
      if (o.detail > 1 && o.detail < CELLS_PER_VOXEL) {
        o.data.upscale(CELLS_PER_VOXEL / o.detail);
        o.detail = CELLS_PER_VOXEL;
      }
    }
    const byId = new Map(objects.map((o) => [o.id, o]));
    for (const o of objects) {
      if (o.kind === 'extend' && o.baseId) o.detail = byId.get(o.baseId)?.detail ?? o.detail;
    }
    return new Project({
      id: json.id,
      name: json.name,
      palette: json.palette,
      exportSettings: normalizeExportSettings(json.exportSettings),
      objects,
      activeObjectId: json.activeObjectId,
    });
  }
}
