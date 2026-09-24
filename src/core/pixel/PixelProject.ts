import { createDefaultPalette, type Palette } from '@/core/palette';
import { PixelWidget } from './PixelWidget';
import { specFor } from './widgets';
import type { PixelProjectJson, WidgetType } from './types';

export class PixelProject {
  id: string;
  name: string;
  palette: Palette;
  widgets: PixelWidget[];
  activeWidgetId: string | null;

  constructor(opts: {
    id?: string;
    name: string;
    palette?: Palette;
    widgets?: PixelWidget[];
    activeWidgetId?: string | null;
  }) {
    this.id = opts.id ?? crypto.randomUUID();
    this.name = opts.name;
    this.palette = opts.palette ?? createDefaultPalette();
    this.widgets = opts.widgets ?? [];
    this.activeWidgetId = opts.activeWidgetId ?? this.widgets[0]?.id ?? null;
  }

  static createNew(name: string, widgetType: WidgetType = 'button'): PixelProject {
    const project = new PixelProject({ name });
    const first = PixelWidget.createNew(specFor(widgetType).label, widgetType);
    project.widgets.push(first);
    project.activeWidgetId = first.id;
    return project;
  }

  getActive(): PixelWidget | null {
    return this.widgets.find((w) => w.id === this.activeWidgetId) ?? null;
  }

  getById(id: string): PixelWidget | null {
    return this.widgets.find((w) => w.id === id) ?? null;
  }

  addWidget(type: WidgetType, name?: string): PixelWidget {
    const widget = PixelWidget.createNew(this.uniqueName(name ?? specFor(type).label), type);
    this.widgets.push(widget);
    return widget;
  }

  remove(id: string): void {
    this.widgets = this.widgets.filter((w) => w.id !== id);
    if (this.activeWidgetId === id) this.activeWidgetId = this.widgets[0]?.id ?? null;
  }

  rename(id: string, name: string): void {
    const w = this.getById(id);
    const trimmed = name.trim();
    if (w && trimmed) w.name = this.uniqueName(trimmed, id);
  }

  private uniqueName(base: string, excludeId?: string): string {
    const names = new Set(this.widgets.filter((w) => w.id !== excludeId).map((w) => w.name));
    if (!names.has(base)) return base;
    for (let i = 2; ; i++) {
      const candidate = `${base} ${i}`;
      if (!names.has(candidate)) return candidate;
    }
  }

  toJSON(): PixelProjectJson {
    return {
      format: 'voxelix-pixel',
      version: 2,
      id: this.id,
      name: this.name,
      palette: this.palette,
      widgets: this.widgets.map((w) => w.toJSON()),
      activeWidgetId: this.activeWidgetId,
    };
  }

  static fromJSON(json: PixelProjectJson): PixelProject {
    return new PixelProject({
      id: json.id,
      name: json.name,
      palette: json.palette,
      widgets: json.widgets.map(PixelWidget.fromJSON),
      activeWidgetId: json.activeWidgetId,
    });
  }
}
