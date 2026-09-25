import { encodePng } from './encodePng';
import { styleBoxTres, themeTres, type ThemeItem, type ThemeTypeInput } from '@/core/pixel/export/tres';
import { serializePixelProject } from '@/core/pixel/pixelProjectFile';
import { specFor } from '@/core/pixel/widgets';
import type { PixelWidget } from '@/core/pixel/PixelWidget';
import type { PixelProject } from '@/core/pixel/PixelProject';
import { PIXEL_FILE_EXT } from '@/core/pixel/types';

export interface ExportFile {
  name: string;
  blob: Blob;
}

export function sanitizeFilename(name: string, fallback = 'widget'): string {
  return name.trim().replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || fallback;
}

export function exportPixelProjectFile(project: PixelProject): ExportFile {
  return {
    name: `${sanitizeFilename(project.name, 'project')}${PIXEL_FILE_EXT}`,
    blob: new Blob([serializePixelProject(project)], { type: 'application/json' }),
  };
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
  /** null for widgets without a Godot theme type (freeform, TextureProgressBar) */
  theme: ThemeTypeInput | null;
}

/**
 * A PNG per *painted* state, plus a standalone StyleBoxTexture `.tres` for
 * each painted style state (drag one onto a single theme override). Also
 * hands back this widget's Theme items so the caller can fold it into a
 * combined Theme:
 * - an unpainted state reuses the image its spec `from` chain resolves to
 *   (hover -> normal), so Godot never drops back to its own grey default;
 * - an unpainted style with nothing to fall back on (a focus ring you left
 *   blank) becomes a StyleBoxEmpty — blank on purpose, not "use the default";
 * - an unpainted icon is left out, so Godot's own icon (often empty) stays.
 */
export async function exportWidgetFiles(widget: PixelWidget, resPrefix = 'res://'): Promise<WidgetExportResult> {
  const base = sanitizeFilename(widget.name);
  const spec = specFor(widget.type);
  const files: ExportFile[] = [];
  /** `${elementId}:${stateId}` -> res:// path of its PNG */
  const texturePaths = new Map<string, string>();
  const usedNames = new Set<string>();

  for (const [elementId, el] of widget.elements) {
    const kind = spec.elements.find((e) => e.id === elementId)?.kind ?? 'texture';
    for (const [state, stack] of el.states) {
      // layers are flattened on export — Godot gets exactly what the canvas shows
      const data = stack.composite();
      if (data.bounds() === null) continue;
      let stem = `${base}_${sanitizeFilename(state, 'state')}`;
      if (usedNames.has(stem)) stem = `${base}_${sanitizeFilename(elementId, 'part')}_${sanitizeFilename(state, 'state')}`;
      usedNames.add(stem);
      files.push({ name: `${stem}.png`, blob: await encodePng(data) });
      const resPath = `${resPrefix}${stem}.png`;
      texturePaths.set(`${elementId}:${state}`, resPath);
      if (kind === 'style') {
        files.push({
          name: `${stem}.tres`,
          blob: new Blob([styleBoxTres(resPath, el.patch, el.contentMargins)], { type: 'text/plain' }),
        });
      }
    }
  }

  if (!spec.themeType) return { files, theme: null };

  const items: ThemeItem[] = [];
  for (const es of spec.elements) {
    const el = widget.element(es.id);
    if (!el || es.kind === 'texture') continue;
    for (const ss of es.states) {
      const resolved = widget.resolveState(es.id, ss.id);
      const path = resolved ? (texturePaths.get(`${es.id}:${resolved.id}`) ?? null) : null;
      if (es.kind === 'icon') {
        if (path) items.push({ kind: 'icon', name: ss.id, texturePath: path });
      } else {
        items.push({ kind: 'style', name: ss.id, texturePath: path, patch: el.patch, contentMargins: el.contentMargins });
      }
    }
  }
  const colors = (spec.colors ?? [])
    .filter((c) => widget.colors.has(c.id))
    .map((c) => ({ name: c.id, rgba: widget.colors.get(c.id)!, themeType: c.themeType }));
  return { files, theme: { themeType: spec.themeType, items, colors } };
}

export interface BatchProgress {
  done: number;
  total: number;
  /** widget currently being processed */
  name: string;
}

/**
 * The editable `.voxui` project, every widget's PNGs + per-state styleboxes,
 * and one combined `theme.tres` covering every widget that has a Godot theme
 * type (freeform / TextureProgressBar PNGs still export, just aren't wired
 * into the theme — there's nothing to wire them to). Two widgets of the same
 * theme type both write their items; the later one in the list wins.
 */
export async function exportProjectFiles(
  project: PixelProject,
  resPrefix = 'res://',
  onProgress?: (p: BatchProgress) => void,
): Promise<ExportFile[]> {
  // Keep the editable source first so it is the least likely file to be lost
  // if a browser limits the fallback path's sequence of separate downloads.
  const files: ExportFile[] = [exportPixelProjectFile(project)];
  const themeInputs: ThemeTypeInput[] = [];
  const total = project.widgets.length;
  let done = 0;

  for (const w of project.widgets) {
    onProgress?.({ done, total, name: w.name });
    const { files: widgetFiles, theme } = await exportWidgetFiles(w, resPrefix);
    files.push(...widgetFiles);
    if (theme) themeInputs.push(theme);
    done++;
  }
  onProgress?.({ done, total, name: '' });

  if (themeInputs.length > 0) {
    files.push({ name: 'theme.tres', blob: new Blob([themeTres(themeInputs)], { type: 'text/plain' }) });
  }
  return files;
}
