# PixelEditor — implementation plan

A second, independent workspace inside Voxelix for pixel-art UI widgets
(buttons, panels, etc.) with nine-patch preview and Godot `.tres` export.
Not a general-purpose Aseprite clone: no layers, no animation (for now),
no tilemaps.

Reached from the start screen, alongside the existing voxel-project list —
its own tab, its own IndexedDB store, its own Pinia store. The voxel editor
is untouched except for small, additive changes noted below.

## Why this shape

- **Separate workspace, not a new `VoxelObject.kind`.** A flat RGBA grid has
  nothing to do with a sparse 16³ chunk grid, and bolting a second kind onto
  every `store.active*` / outliner / export-dialog path would spread the
  blast radius across the whole voxel editor for a feature that shares no
  data with it. `App.vue`'s `!!store.project` boolean becomes a workspace
  discriminator (`'voxel' | 'pixel' | null`); the voxel store, viewport and
  tools are not otherwise touched.
- **RGBA8, not a palette index.** Palette indices are right for voxels
  (import/export by index, 256 shared colours) but wrong for pixel UI: no
  alpha means no rounded corners, no soft shadows, no translucent panels,
  and a "gradient tool" over an index buffer is just dithering. The
  `Palette` type (`core/palette.ts`) is reused as a swatch shelf only —
  pixels store packed RGBA, not an index.
- **States, not animation frames — but the same structure.** "No animation"
  is right for v1, but a button unusable without `hover`/`pressed`/`disabled`/
  `focus` is not shippable. Modelling a widget as "N named states" now means
  frames are a relabelling later, not a rewrite.
- **Nine-patch is the actual differentiator.** Aseprite doesn't do nine-patch
  well and hand-typing margins into Godot after the fact is the annoying part
  this tool should remove. The live, multi-size preview (M2) is the go/no-go
  checkpoint for the whole feature — build that first, past the trivial
  canvas-with-a-pencil part.

## Data model

```ts
// core/pixel/types.ts
export type Rgba = number; // packed RGBA8, 0x00000000 = transparent

export type WidgetType =
  | 'button' | 'optionbutton' | 'checkbox' | 'panel' | 'lineedit'
  | 'progressbar' | 'freeform';

export type StateId = 'normal' | 'hover' | 'pressed' | 'disabled' | 'focus';

export interface NinePatch { left: number; top: number; right: number; bottom: number }

export interface PixelLayerJson {
  pixels: string; // RLE-base64 of the Uint32 pixel array, row-major
}

export interface PixelWidgetJson {
  id: string;
  name: string;
  type: WidgetType;
  width: number;
  height: number;
  patch: NinePatch;
  states: Partial<Record<StateId, PixelLayerJson>>; // missing states visually inherit 'normal'
  icons?: Record<string, PixelLayerJson>;            // e.g. the OptionButton arrow
}

export interface PixelProjectJson {
  format: 'voxelix-pixel';
  version: 1;
  id: string;
  name: string;
  palette: Palette;       // swatch shelf, reused from core/palette.ts
  widgets: PixelWidgetJson[];
  activeWidgetId: string | null;
}

export const PIXEL_FILE_EXT = '.voxui';
```

```ts
// core/pixel/widgets.ts
export interface WidgetSpec {
  type: WidgetType;
  label: string;
  defaultSize: [number, number];
  states: StateId[];              // display order; [] = single image, no states
  themeType: string | null;       // Godot theme type, e.g. 'Button'
  icons?: Array<{ id: string; label: string; size: [number, number]; themeKey: string }>;
}

export const WIDGET_SPECS: Record<WidgetType, WidgetSpec>;
export function specFor(type: WidgetType): WidgetSpec;
```

`button` → 5 states, `themeType: 'Button'`. `optionbutton` → same states plus
an `arrow` icon mapped to `OptionButton/icons/arrow`. `freeform` → no states,
no nine-patch requirement. This is what makes the widget-type dropdown
load-bearing rather than cosmetic.

## `PixelData`

```ts
// core/pixel/PixelData.ts — pure, DOM-free, bun-testable
export class PixelData {
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number);
  index(x: number, y: number): number;        // -1 out of bounds
  get(x: number, y: number): Rgba;             // 0 out of bounds
  set(x: number, y: number, rgba: Rgba): void;
  setRaw(i: number, rgba: Rgba): void;          // index-based, for history replay
  applyEdit(e: PixelEdit, value: Rgba): void;   // History target

  fill(rgba: Rgba): void;
  fillRect(r: PixelRect, rgba: Rgba): void;
  clone(): PixelData;
  bounds(): PixelRect | null;                   // tightest non-transparent box, null if empty
  resize(w: number, h: number, anchor?: 'topleft' | 'center'): PixelData;

  asImageBuffer(): Uint8ClampedArray;           // unpacked RGBA bytes for the renderer

  toJSON(): PixelLayerJson;
  static fromJSON(json: PixelLayerJson, w: number, h: number): PixelData;
}

export interface PixelEdit { i: number; prev: Rgba; next: Rgba }
export interface PixelRect { x: number; y: number; w: number; h: number }
```

Stored internally as `Uint32Array` (fast RLE + equality checks); packed as
host-endian, so `asImageBuffer()` explicitly unpacks R/G/B/A via shifts —
never assumed to match memory layout — once per repaint.

```ts
// core/pixel/pack.ts
export function packRgba(r: number, g: number, b: number, a: number): Rgba;
export function unpackRgba(v: Rgba): [number, number, number, number];
export function hexToRgba(hex: string, alpha?: number): Rgba;
export function rgbaToHex(v: Rgba): string;
```

## History, made generic

`History`/`HistoryStore` currently hard-code `VoxelData.setRaw(x, y, z, v)`.
Parameterise over the edit type:

```ts
// core/history/History.ts
export interface HistoryTarget<E> { applyEdit(edit: E, value: number): void }
export interface EditBatch<E> { label: string; edits: E[] }

export class History<E extends { prev: number; next: number }> {
  get canUndo(): boolean;
  get canRedo(): boolean;
  push(batch: EditBatch<E>): void;
  undo(target: HistoryTarget<E>): EditBatch<E> | null;
  redo(target: HistoryTarget<E>): EditBatch<E> | null;
  clear(): void;
}

export class HistoryStore<E extends { prev: number; next: number }> {
  for(id: string): History<E>;
  drop(id: string): void;
}
```

`VoxelData` gains a six-line `applyEdit(e: VoxelEdit, value: number)` that
calls `setRaw`. `ToolRunner`'s `histories` becomes `HistoryStore<VoxelEdit>`.
~15 lines of churn on the voxel side. (If that churn is unwanted, fork the 70
lines into `core/pixel/PixelHistory.ts` instead — also fine, just a
duplicate.)

## Storage

```ts
// core/io/projectStore.ts
const DB_VERSION = 2; // was 1
const PIXEL_STORE = 'pixelProjects';

export interface PixelProjectRecord {
  id: string; name: string; widgetCount: number;
  createdAt: number; updatedAt: number;
  json: PixelProjectJson;
  thumbnail?: string; // PNG data URL of the active widget, 2x zoom
}

export async function putPixelProjectRecord(r: PixelProjectRecord): Promise<void>;
export async function getPixelProjectRecord(id: string): Promise<PixelProjectRecord | undefined>;
export async function deletePixelProjectRecord(id: string): Promise<void>;
export async function listPixelProjectMeta(): Promise<PixelProjectMeta[]>;
```

The existing `onupgradeneeded` is already guarded with
`if (!db.objectStoreNames.contains(...))`, so this is an additive branch.

**Migration hazard:** `openDb()` currently `reject`s on `onblocked`. A second
tab left open across the deploy will block the v1→v2 upgrade and surface as
an unhandled rejection. Catch it and `toast('Please close other Voxelix
tabs', 'error')` — otherwise the first impression after this ships is a dead
app for anyone with two tabs open.

`editor/pixel/autosave.ts` mirrors `editor/autosave.ts` (5s debounce, 30s max
wait, flush on `visibilitychange`/`unload`) as its own copy — the voxel
version is wired to `viewport.captureThumbnail()` and isn't worth
generalising for one call site. Revisit only if the duplication becomes
annoying.

## Nine-patch

```ts
// core/pixel/ninepatch.ts — pure, bun-testable
export interface PatchQuad {
  sx: number; sy: number; sw: number; sh: number;
  dx: number; dy: number; dw: number; dh: number;
}

export function sliceNinePatch(
  src: { w: number; h: number }, patch: NinePatch, dst: { w: number; h: number },
): PatchQuad[]; // empty quads dropped

export function clampPatch(patch: NinePatch, w: number, h: number): NinePatch;
export function minDrawSize(patch: NinePatch): { w: number; h: number };
```

`minDrawSize` matters because a preview drawn smaller than `left+right`
overlaps corners — Godot scales down proportionally instead. The preview
panel should show a warning in that case rather than silently rendering
something the game won't.

## Tools

```ts
// tools/pixel/types.ts
export type PixelToolId = 'pencil' | 'eraser' | 'bucket' | 'picker' | 'select' | 'line' | 'rect';

export interface PixelPointer {
  clientX: number; clientY: number;
  button: number; // 0 = primary, 2 = secondary
  shiftKey: boolean; ctrlKey: boolean; altKey: boolean;
  detail: number;
}

export interface PixelToolContext {
  readonly data: PixelData;
  readonly primary: Rgba;
  readonly secondary: Rgba;
  readonly brushSize: number;       // every tool must honour this — see below
  readonly selection: PixelRect | null;
  readonly contiguous: boolean;     // bucket: 4- vs 8-connected

  cellAt(clientX: number, clientY: number): { x: number; y: number } | null;
  begin(label: string): void;
  write(x: number, y: number, rgba: Rgba): void;
  commit(): void;
  cancel(): void;
  setSelection(r: PixelRect | null): void;
  pickColor(rgba: Rgba, slot: 'primary' | 'secondary'): void;
  setPreview(quads: PixelRect[] | null): void;
}

export interface PixelTool {
  readonly id: PixelToolId;
  pointerDown(ctx: PixelToolContext, p: PixelPointer): void;
  pointerMove(ctx: PixelToolContext, p: PixelPointer): void;
  pointerUp(ctx: PixelToolContext, p: PixelPointer): void;
  clearPreview(ctx: PixelToolContext): void;
}
```

Two rules carried over from lessons learned on the voxel side
([[respect-all-brush-sizes]]):

- **`brushSize` applies to every tool**, eraser included — never silently
  fall back to one pixel, and the brush picker must be visible for any tool
  that uses it.
- **Colour comes from the mouse button, decided centrally** in
  `PixelRunner` (`rgba = button === 2 ? secondary : primary`), not
  per-tool. The eraser always writes `0`.

`PixelRunner` mirrors `ToolRunner`: holds the open batch, collects
`PixelEdit[]`, pushes to history, bumps `editVersion`, coalesces repaints via
`requestAnimationFrame`.

**RMB collision:** `EditorView.vue` suppresses `contextmenu` across the whole
editor except text inputs. The pixel editor needs the same (secondary colour
on RMB) — including the text-input exception, or name fields lose
copy/paste.

## Rendering

```ts
// pixel/PixelRenderer.ts
export interface RenderOptions {
  zoom: number;                 // integer, 1..32
  showGrid: boolean;            // auto-off below zoom 4
  patch: NinePatch | null;      // guide lines
  selection: PixelRect | null;  // marching ants
  preview: PixelRect[] | null;
}

export class PixelRenderer {
  constructor(canvas: HTMLCanvasElement);
  setSource(data: PixelData): void;
  render(opts: RenderOptions): void;
  toCell(clientX: number, clientY: number): { x: number; y: number } | null;
  hitGuide(clientX: number, clientY: number): keyof NinePatch | null; // for dragging a margin
  captureThumbnail(scale: number): string;
  dispose(): void;
}
```

Offscreen canvas at native size gets `putImageData`; the visible canvas draws
it scaled with `imageSmoothingEnabled = false`. Grid/guides/selection drawn
as lines on top. Must account for `devicePixelRatio`, or pixels blur under
Windows display scaling — which hurts more here than anywhere else in the app.

```ts
// pixel/NinePatchPainter.ts
export function paintNinePatch(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource,
  srcSize: { w: number; h: number }, patch: NinePatch,
  dest: PixelRect, scale: number,
): void;
```

`WidgetPreview.vue` calls this for **three target sizes at once** (narrow,
wide, tall) plus a 1x/2x/3x zoom toggle — a one-pixel margin error shows up
immediately instead of in-engine.

## Export

```ts
// core/pixel/export/tres.ts — string generation, DOM-free
export function styleBoxTres(texturePath: string, patch: NinePatch): string;
export function themeTres(
  widgets: Array<{ type: WidgetType; texturePaths: Partial<Record<StateId, string>>; patch: NinePatch }>,
  iconPaths: Record<string, string>,
): string;
```

Ship single `StyleBoxTexture` resources first (M4 — trivial, drag-and-drop
usable immediately); a combined `Theme` resource with subresources second
(M4b — same idea, just more `SubResource` bookkeeping to get right).

Reuses the existing file-write path as-is: `pickDirectory()` +
`writeFileToDirectory()` from `core/io/fileSystem.ts` (same as batch GLB
export), `saveTextFile()` for the `.tres`, `saveBinaryFile()`/`downloadBlob()`
as the no-File-System-Access fallback.

```ts
// pixel/encodePng.ts — needs Canvas, so lives outside core/
export async function encodePng(data: PixelData, scale?: number): Promise<Blob>;
```

## Shell wiring

`App.vue`'s `!!store.project` becomes:

```ts
type Workspace = 'voxel' | 'pixel' | null;
```

`localStorage 'voxelix.lastWorkspace'` decides which of two `lastProject`
keys is read on boot; the existing voxel key is untouched, a new
`voxelix.lastPixelProject` is added alongside it.

```vue
<div v-if="booting" class="boot" />
<StartScreen v-else-if="!workspace" />
<EditorView v-else-if="workspace === 'voxel'" />
<PixelEditorView v-else />
```

`StartScreen.vue` gets two tabs (Voxel / Pixel) above the recent list; each
tab lists its own store's records and has its own "New" flow — the pixel tab's
"New" dialog carries the widget-type dropdown and size field up front.

## File tree

```
src/core/pixel/              pure, DOM-free, bun-testable
  PixelData.ts
  PixelProject.ts             project (stable id), widgets
  types.ts
  widgets.ts                  WIDGET_SPECS
  ninepatch.ts
  pack.ts
  ops/
    flood.ts                  4/8-connected bucket
    select.ts
  export/
    tres.ts
src/pixel/                    DOM side, mirrors viewport/
  PixelRenderer.ts
  NinePatchPainter.ts
  encodePng.ts
src/tools/pixel/
  types.ts
  tools.ts
src/editor/pixel/
  PixelRunner.ts
  autosave.ts
  session.ts
src/stores/pixel.ts
src/components/pixel/
  PixelEditorView.vue
  PixelCanvas.vue
  PixelToolbar.vue
  WidgetList.vue
  WidgetPreview.vue
  NinePatchPanel.vue
  ColorPanel.vue
```

Touched outside the new tree: `App.vue` (routing), `StartScreen.vue` (tabs),
`core/io/projectStore.ts` (DB v2), `core/io/serialize.ts` (u32 RLE variant),
`core/history/History.ts` (generic), `core/voxel/VoxelData.ts` (+
`applyEdit`, ~6 lines).

## Milestones

| # | Scope | Result |
|---|---|---|
| M0 | routing, DB v2, StartScreen tabs, new/open/delete | Pixel projects can be created and found again |
| M1 | `PixelData`, generic History, renderer, pencil/eraser/picker/bucket, undo, autosave, colour panel | **Can draw** |
| M2 | `ninepatch.ts`, draggable guides, 3-size `WidgetPreview` | **Go/no-go checkpoint** |
| M3 | widget types, states, `WidgetList` | A complete button |
| M4 | PNG export + per-state `.tres`, folder picker | **Usable in Godot** |
| M4b | combined Theme `.tres` | One drag instead of five |
| M5 | select/rect/line tools, resize, palette import from a voxel project | polish |

## Deferred

Gradient and magic-wand tools (both need tolerance/dither decisions in RGBA
that are premature before M2 lands), animation (the M3 states structure
absorbs frames later without a rewrite), layers, tilemaps, `expand_margin`.

## Before committing

`bun run typecheck` **and** `bun run build` — the History generic and the new
canvas module are exactly the kind of change where typecheck passes and the
bundler trips. No `Co-Authored-By` trailer (repo convention).
