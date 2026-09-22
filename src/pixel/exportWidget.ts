import { encodePng } from './encodePng';
import { styleBoxTres, themeTres, type ThemeWidgetInput } from '@/core/pixel/export/tres';
import { specFor } from '@/core/pixel/widgets';
import type { PixelWidget } from '@/core/pixel/PixelWidget';
import type { PixelProject } from '@/core/pixel/PixelProject';
import type { StateId } from '@/core/pixel/types';

export interface ExportFile {
  name: string;
  blob: Blob;
}

export function sanitizeFilename(name: string): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'widget';
}

/**
 * Normalises a user-entered Godot resource folder: the browser's directory
 * picker only tells us the folder they clicked, not where it sits relative to
 * their Godot project's res:// root, so the .tres files' texture paths need
 * this typed in — 'res://', 'res://ui', 'ui/' all end up as 'res://ui/'.
 */
export function normalizeResPrefix(input: string): string {
  const raw = input.trim().replace(/\\/g, '/');
  const withoutScheme = raw.startsWith('res://') ? raw.slice('res://'.length) : raw;
  const cleaned = withoutScheme.replace(/\/{2,}/g, '/').replace(/^\/+/, '');
  return `res://${cleaned}${cleaned.endsWith('/') || cleaned === '' ? '' : '/'}`;
}

export interface WidgetExportResult {
  files: ExportFile[];
  texturePaths: Partial<Record<StateId, string>>;
  iconPaths: Record<string, string>;
}

/**
 * PNG + a standalone StyleBoxTexture `.tres` per painted state, plus a PNG per
 * icon (no StyleBox wrapper for icons — Godot icons are plain textures). The
 * standalone styleboxes are useful on their own (drag one onto a single theme
 * override); `texturePaths`/`iconPaths` are handed back so the caller can also
 * fold this widget into a combined Theme resource.
 */
export async function exportWidgetFiles(widget: PixelWidget, resPrefix = 'res://'): Promise<WidgetExportResult> {
  const base = sanitizeFilename(widget.name);
  const files: ExportFile[] = [];
  const texturePaths: Partial<Record<StateId, string>> = {};
  const iconPaths: Record<string, string> = {};

  for (const [state, data] of widget.states) {
    const pngName = `${base}_${state}.png`;
    files.push({ name: pngName, blob: await encodePng(data) });
    const resPath = `${resPrefix}${pngName}`;
    texturePaths[state] = resPath;
    files.push({
      name: `${base}_${state}.tres`,
      blob: new Blob([styleBoxTres(resPath, widget.patch)], { type: 'text/plain' }),
    });
  }

  for (const [iconId, data] of widget.icons) {
    const pngName = `${base}_icon_${iconId}.png`;
    files.push({ name: pngName, blob: await encodePng(data) });
    iconPaths[iconId] = `${resPrefix}${pngName}`;
  }

  return { files, texturePaths, iconPaths };
}

export interface BatchProgress {
  done: number;
  total: number;
  /** widget currently being processed */
  name: string;
}

/**
 * Every widget's PNGs + per-state styleboxes, plus one combined `theme.tres`
 * covering every widget that has a Godot theme type (freeform PNGs still
 * export, just aren't wired into the theme — there's nothing to wire them to).
 */
export async function exportProjectFiles(
  project: PixelProject,
  resPrefix = 'res://',
  onProgress?: (p: BatchProgress) => void,
): Promise<ExportFile[]> {
  const files: ExportFile[] = [];
  const themeInputs: ThemeWidgetInput[] = [];
  const total = project.widgets.length;
  let done = 0;

  for (const w of project.widgets) {
    onProgress?.({ done, total, name: w.name });
    const { files: widgetFiles, texturePaths, iconPaths } = await exportWidgetFiles(w, resPrefix);
    files.push(...widgetFiles);
    if (specFor(w.type).themeType) {
      themeInputs.push({ type: w.type, texturePaths, patch: w.patch, iconPaths });
    }
    done++;
  }
  onProgress?.({ done, total, name: '' });

  if (themeInputs.length > 0) {
    files.push({ name: 'theme.tres', blob: new Blob([themeTres(themeInputs)], { type: 'text/plain' }) });
  }
  return files;
}
