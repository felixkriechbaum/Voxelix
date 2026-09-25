import type { ContentMargins, NinePatch } from '@/core/pixel/types';

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

/** One entry in a Theme's `[resource]` block. */
export type ThemeItem =
  | {
      kind: 'style';
      /** theme item name, e.g. 'hover', 'fill' */
      name: string;
      /** null = a StyleBoxEmpty — deliberately nothing, rather than Godot's default grey */
      texturePath: string | null;
      patch: NinePatch;
      contentMargins: ContentMargins;
    }
  | { kind: 'icon'; name: string; texturePath: string };

export interface ThemeColor {
  /** theme item name, e.g. 'font_hover_color' */
  name: string;
  /** packed RGBA8 (r in the low byte) */
  rgba: number;
  /** written under this type instead of the widget's own (TooltipLabel for a tooltip's text) */
  themeType?: string;
}

export interface ThemeTypeInput {
  /** Godot theme type, e.g. 'HSlider' */
  themeType: string;
  items: ThemeItem[];
  colors?: ThemeColor[];
}

/** Godot `Color(r, g, b, a)` literal from packed RGBA8 — sRGB floats, trimmed to 4 decimals. */
export function godotColor(rgba: number): string {
  const f = (shift: number) => {
    const v = Math.round((((rgba >>> shift) & 0xff) / 255) * 10000) / 10000;
    return String(v);
  };
  return `Color(${f(0)}, ${f(8)}, ${f(16)}, ${f(24)})`;
}

/**
 * One combined Godot Theme resource: a StyleBoxTexture subresource per style
 * item wired to `<ThemeType>/styles/<name>`, icons at `<ThemeType>/icons/<name>`,
 * colours (font colours per state, …) at `<ThemeType>/colors/<name>`.
 * Textures used by several items (a hover state falling back to normal's
 * image) are referenced once.
 */
export function themeTres(inputs: ThemeTypeInput[]): string {
  const extLines: string[] = [];
  const extIds = new Map<string, string>();
  const subLines: string[] = [];
  const resourceLines: string[] = [];
  let subCounter = 0;

  function ext(path: string): string {
    let id = extIds.get(path);
    if (!id) {
      id = `tex_${extIds.size + 1}`;
      extIds.set(path, id);
      extLines.push(`[ext_resource type="Texture2D" path="${path}" id="${id}"]`);
    }
    return id;
  }

  for (const input of inputs) {
    for (const c of input.colors ?? []) {
      resourceLines.push(`${c.themeType ?? input.themeType}/colors/${c.name} = ${godotColor(c.rgba)}`);
    }
    for (const item of input.items) {
      if (item.kind === 'icon') {
        resourceLines.push(`${input.themeType}/icons/${item.name} = ExtResource("${ext(item.texturePath)}")`);
        continue;
      }
      subCounter++;
      const subId = `style_${subCounter}`;
      subLines.push(
        item.texturePath === null
          ? `[sub_resource type="StyleBoxEmpty" id="${subId}"]`
          : `[sub_resource type="StyleBoxTexture" id="${subId}"]\n` +
              `texture = ExtResource("${ext(item.texturePath)}")\n` +
              styleBoxMarginLines(item.patch, item.contentMargins),
      );
      resourceLines.push(`${input.themeType}/styles/${item.name} = SubResource("${subId}")`);
    }
  }

  const loadSteps = extLines.length + subLines.length + 1;
  const parts = [`[gd_resource type="Theme" load_steps=${loadSteps} format=3]`, ''];
  if (extLines.length) parts.push(extLines.join('\n'), '');
  if (subLines.length) parts.push(subLines.join('\n\n'), '');
  parts.push('[resource]', resourceLines.join('\n'), '');
  return parts.join('\n');
}
