import { specFor } from '@/core/pixel/widgets';
import type { ContentMargins, NinePatch, StateId, WidgetType } from '@/core/pixel/types';

function styleBoxMarginLines(patch: NinePatch, contentMargins: ContentMargins): string {
  return (
    `texture_margin_left = ${patch.left}.0\n` +
    `texture_margin_top = ${patch.top}.0\n` +
    `texture_margin_right = ${patch.right}.0\n` +
    `texture_margin_bottom = ${patch.bottom}.0\n` +
    `content_margin_left = ${contentMargins.left}.0\n` +
    `content_margin_top = ${contentMargins.top}.0\n` +
    `content_margin_right = ${contentMargins.right}.0\n` +
    `content_margin_bottom = ${contentMargins.bottom}.0`
  );
}

/** A Godot 4 StyleBoxTexture with texture slicing and content padding. */
export function styleBoxTres(texturePath: string, patch: NinePatch, contentMargins: ContentMargins): string {
  return (
    `[gd_resource type="StyleBoxTexture" load_steps=2 format=3]\n\n` +
    `[ext_resource type="Texture2D" path="${texturePath}" id="1_tex"]\n\n` +
    `[resource]\n` +
    `texture = ExtResource("1_tex")\n` +
    `${styleBoxMarginLines(patch, contentMargins)}\n`
  );
}

export interface ThemeWidgetInput {
  type: WidgetType;
  /** res:// path per state that has an exported texture */
  texturePaths: Partial<Record<StateId, string>>;
  patch: NinePatch;
  contentMargins: ContentMargins;
  /** icon id -> res:// path (e.g. { arrow: 'res://ui/optionbutton_arrow.png' }) */
  iconPaths?: Record<string, string>;
}

/**
 * One combined Godot Theme resource covering every widget that has a theme
 * type — a StyleBoxTexture subresource per state, wired to
 * `<ThemeType>/styles/<state>`, plus icons at `<ThemeType>/icons/<id>`.
 * Widgets with no themeType (freeform) are silently skipped — their PNGs are
 * still exported, just not wired into this Theme.
 */
export function themeTres(widgets: ThemeWidgetInput[]): string {
  const extLines: string[] = [];
  const subLines: string[] = [];
  const resourceLines: string[] = [];
  let extCounter = 0;
  let subCounter = 0;

  function addExt(path: string): string {
    extCounter++;
    const id = `tex_${extCounter}`;
    extLines.push(`[ext_resource type="Texture2D" path="${path}" id="${id}"]`);
    return id;
  }

  for (const w of widgets) {
    const spec = specFor(w.type);
    if (!spec.themeType) continue;

    for (const [state, path] of Object.entries(w.texturePaths)) {
      if (!path) continue;
      const extId = addExt(path);
      subCounter++;
      const subId = `style_${subCounter}`;
      subLines.push(
        `[sub_resource type="StyleBoxTexture" id="${subId}"]\n` +
          `texture = ExtResource("${extId}")\n` +
          styleBoxMarginLines(w.patch, w.contentMargins),
      );
      resourceLines.push(`${spec.themeType}/styles/${state} = SubResource("${subId}")`);
    }

    for (const [iconId, path] of Object.entries(w.iconPaths ?? {})) {
      const extId = addExt(path);
      const iconSpec = spec.icons?.find((i) => i.id === iconId);
      const key = iconSpec?.themeKey ?? `${spec.themeType}/icons/${iconId}`;
      resourceLines.push(`${key} = ExtResource("${extId}")`);
    }
  }

  const loadSteps = extLines.length + subLines.length + 1;
  const parts = [`[gd_resource type="Theme" load_steps=${loadSteps} format=3]`, ''];
  if (extLines.length) parts.push(extLines.join('\n'), '');
  if (subLines.length) parts.push(subLines.join('\n\n'), '');
  parts.push('[resource]', resourceLines.join('\n'), '');
  return parts.join('\n');
}
