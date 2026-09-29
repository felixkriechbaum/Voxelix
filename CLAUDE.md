# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**Voxelix** — a fast, browser-based 3D voxel editor for game assets (think kitchen
placeables: counter, sink, fridge). Each object exports individually as a `.glb`.
Pure client-side SPA, no backend. Design was worked out up front; see the roadmap
at the bottom.

## Commands

```bash
bun install
bun run dev        # vite dev server, http://localhost:5173
bun run build      # vue-tsc --noEmit && vite build
bun run typecheck  # vue-tsc --noEmit
```

There is no test runner configured. For quick logic checks, write a throwaway
`scratch.test.ts` at the repo root (the `@/` alias resolves under `bun`), run it
with `bun scratch.test.ts`, then delete it.

Always run `bun run typecheck` **and** `bun run build` before committing — the
build catches worker/bundler issues the typecheck misses.

## Conventions

- **Commits: never add a `Co-Authored-By` / `Claude-Session` trailer.** The owner
  has asked for this explicitly and repeatedly.
- TypeScript strict, `noUnusedLocals`/`noUnusedParameters` on. Path alias `@/` → `src/`.
- The typed-array lib generics are strict here: palette buffers flowing to the
  worker are typed `Float32Array<ArrayBufferLike>`.
- UI tokens live in `src/style.css`: slate surfaces, the brand mint as the one
  accent, `--axis-x/y/z` for anything spatial (plane / mirror / size fields,
  matching the viewport gizmo). Chakra Petch for headings, IBM Plex Sans for UI.
  Editor layout: `Toolbar` (project + file actions) on top, `ToolRail` (tools)
  left, `ToolOptions` floating in the viewport, objects + palette right
  (width draggable via the handle in the gap, 240–560 px, localStorage
  `voxelix.voxelSide`).
- Keep `core/` free of Three.js and Vue — it is pure logic and must stay testable
  in `bun` without a DOM.

## Architecture

```
src/
  core/            pure logic, no Three, no Vue
    voxel/         VoxelData — sparse 16^3 chunk grid, max 64^3/object
                   cell value: 0 = empty, else paletteIndex+1; REMOVED (0xffff)
                   is an overlay-only "explicitly deleted" marker
    mesh/          greedyMesh (shared by editor + export), mesher.worker,
                   ChunkMesher (owns the worker)
    project/       Project (has a stable id), VoxelObject, parts.ts (VoxelPart +
                   array modifier, mergeParts), resolve.ts (extend resolution),
                   types (.voxproj schema)
    shapes/        primitive voxelisation: solids (box/sphere/dome/cylinder/
                   cone/pyramid/wedge/tube) + flat shapes (plane/circle/ring)
                   laid on a chosen XZ/XY/YZ plane
    export/        exportGlb.ts — per-object merge + pivot/scale/up-axis via
                   GLTFExporter; exportProjectToGlbs() for batch export
    ops/           flood.ts, selection.ts (Selection box + region helpers)
    io/            projectFile, fileSystem (File System Access + fallbacks incl.
                   pickDirectory), serialize (LE base64), projectStore
                   (IndexedDB: autosave target + recent-projects source)
    history/       History (per-object undo stack of voxel diffs) + HistoryStore
    palette.ts     256 sRGB hex slots, "#rrggbb" or "#rrggbbaa" (see-through);
                   paletteToLinearArray → 256 × RGBA (linear rgb + alpha)
  viewport/        Three.js. Viewport composes GodotControls (perspective + ortho
                   off one orbit state), Gizmos, Picker, ChunkMeshView (one mesh
                   per non-empty chunk)
  tools/           Tool implementations (incl. SelectTool) + ToolContext interface
  editor/          ToolRunner (pointer input → tool → history → viewport),
                   session.ts (shared refs to the mounted viewport/runner),
                   autosave.ts (debounced IndexedDB save), selectionOps.ts
                   (move/recolour/duplicate/delete via ToolContext),
                   save.ts (manual .voxproj save, shared by button + Ctrl+S),
                   theme.ts (light/dark/system, [data-theme] on <html>),
                   viewstate.ts (per-project camera, localStorage),
                   toasts.ts (module-state queue; toast() from anywhere,
                   rendered by Toasts.vue — use it instead of alert())
  stores/          Pinia: editor.ts holds the Project (markRaw) + reactive
                   version counters (structureVersion / activeVersion /
                   paletteVersion / editVersion) that components watch, plus
                   selection + autosave status
  components/      Vue SFCs
```

### Data flow

- The Pinia store holds a `markRaw(Project)`. Vue never deep-proxies voxel data.
  Components react to integer `*Version` refs bumped on mutation. `editVersion`
  is bumped by `ToolRunner` on every committed edit / undo / redo (the other
  counters miss plain voxel writes) and is what `useAutosave()` watches.
- Editing: `ViewportCanvas` forwards pointer events to `ToolRunner`, which
  implements `ToolContext`, applies voxel writes, records `{x,y,z,prev,next}`
  diffs, pushes history batches, and tells the `Viewport` to re-mesh. During a
  drag the batch re-meshes once per frame (rAF-coalesced) so strokes show live.
- Switching to an object with nothing rendered (a fresh one, or one fully
  erased) refits the camera. `Picker.pick` only accepts a click that lands
  inside the active grid's bounds, so a camera still framed on a larger object
  leaves a small new one silently unclickable — no hit, no error, nothing.
- The ortho camera renders a symmetric ±4000 depth slab around its eye, and
  zooming moves the eye in, so close up it sits inside the object. `Picker`
  therefore starts ortho rays at the near plane (`aim`), not at the eye —
  otherwise clicks from some sides miss the visible faces.
- See-through colours (palette alpha < 1, glass): `greedyMesh` returns
  `{ opaque, glass }` per chunk. Opaque faces show against empty *or* glass
  neighbours (a wall behind a pane is kept); glass faces show against empty or
  a different glass colour only. `ChunkMeshView` renders glass with its own
  blended, depth-write-free material (still raycastable). Export keeps ONE mesh
  with two primitives — the glass one gets alphaMode BLEND; COLOR_0 is RGBA.
- Meshing is always off-thread. A chunk is re-meshed when its voxels or a
  neighbour's border voxels change (`VoxelData.dirty`).
- Autosave writes the whole project (+ a viewport JPEG thumbnail) to IndexedDB
  5s after the last edit; the StartScreen lists those records as recent projects.
- `App.vue` reopens the last project on boot (`localStorage 'voxelix.lastProject'`
  → its IndexedDB record). The toolbar folder button (`store.closeProject`) goes
  back to the StartScreen. Camera view is remembered per project in localStorage.

### Coordinate conventions

- Voxel `(x,y,z)` fills the unit cube `[x, x+1]`. Meshes sit at the origin.
- Build planes: XZ (ground, default), XY, YZ, with an integer offset.
- `VoxelObject.detail` = grid cells per voxel edge: 1 (coarse) or `CELLS_PER_VOXEL`
  (=6) once subdivided. `store.ensureDetail` runs the first time a sub-voxel brush
  is used on a coarse object: `VoxelData.upscale` blows each cell into a 6³ block
  (lossless, shape unchanged), one-way. `ActiveRender.detail` drives the per-voxel
  grid overlay + the export cell scale; an `extend` overlay follows its base.
  No viewport rescaling — the object grows in cell space and `frameActive` refits.
- Brush (`editor.ts` `voxelFraction` 1/2/3/6): places a `detail / fraction`-cell
  cube, grid-aligned — a full voxel, a half, a third, or a single cell (1/6).
  The toolbar shows it as a row of squares. Switching it never mutates existing
  voxels. Outliner size input and the shape dialog are in voxels (× detail
  internally).
- Meshing is batched: `ChunkMesher.meshChunks` posts every dirty chunk in one
  worker message (a 6× grid has 216 chunks for a 16-voxel object).
- Drag strokes lock to a plane (`Picker.pickPlane` / `ToolContext.pickOnPlane`)
  so they can't wander onto another face or drill inward. Which plane differs
  by tool, on purpose:
  - place/erase/paint lock to **the face the stroke started on** (`lockPlane`)
    — they are surface-drawing tools, so following the clicked face is right.
  - box locks to **the toolbar's Plane setting** (`planeNormalAxis`), at the
    depth of the first corner. Deriving it from the clicked face made the box
    orientation depend on where the ray happened to land, which reads as random.

  Shift adds a straight-line constraint on top (place/erase/paint).
- Export scale: `ExportSettings.refVoxels` voxels = `refMeters` metres
  (`metersPerVoxel`); default 16 voxels = 1 m. Legacy `unitsPerVoxel` files load
  as `{refVoxels: 1, refMeters: <value>}`.
- Export pivot `bottom-center`: X/Z centred on the filled bounds, Y=0 at the base.
- Export up-axis: glTF-native Y-up, or a baked Y→Z rotation for Blender.
- Export wraps the mesh in a `THREE.Scene` named after the object. Handing
  `GLTFExporter` a loose Object3D makes it invent its own wrapper hardcoded to
  `AuxScene`, which is the name Godot then gives the imported scene's root.

### Parts (several meshes per object)

A `VoxelObject` holds `parts: VoxelPart[]` — each its own `VoxelData` in the
object's shared grid (same size + detail) plus a non-destructive modifier
stack, applied top to bottom (`evaluatePart`), UI in `ModifierStack.vue`:
- array: count / axis / direction ± / gap ≥ 0 voxels, step = part extent + gap
- mirror: across the grid-centre plane that flips an axis
- move: whole-voxel offset (× detail)
- radial: 2 (180°) or 4 (90°) copies about Y through the grid centre
- smooth: `radius` in voxels (0.25–6, fractions ok; old files' `level` 1–3
  load as that many voxels) = total blur reach; 2× separable box blur of
  the occupancy. A new cell needs blur > 0.5, an existing one > 0.5 × the
  local peak (so thin rods/plates keep their thickness). New cells take the
  nearest original colour. Adding it subdivides a coarse object
  (`ensureDetail`). While a smoothed part is active, `ActiveRender.cage`: the
  finished object shows undimmed and the part's raw voxels draw over it as a
  faint cage (`ChunkMeshView.setCage`); mid-stroke the result isn't
  regenerated (too slow per frame), only on commit.
Everything generated is clipped at the grid. A 90° object rotation turns each
modifier with it (`rotateModifierY`); `normalizeModifier` clamps edits + loads
(a modifier without a `type` is a pre-stack array). `obj.data` is a getter for the **active
part**, so tools, `ToolRunner` and overlays keep working on one grid; undo
stacks are keyed `objectId/partId`. Anything that changes the grid as a whole
(resize, rotate, subdivide) must loop over `obj.parts`.
- `obj.merged()` = all parts, modifiers applied, later parts win — what
  `resolveEffectiveData` returns for a normal object, so export gets ONE mesh.
- `buildActiveRender`: the active part is the editable mesh; other parts and all
  generated copies (`mergeParts(..., skip = active)`) are the dimmed context.
  `ToolRunner.afterEdit` regenerates that context live when the active part
  has modifiers.
- Extend overlays are always single-part; `setExtendBase` flattens first.
- File format: `data` is always the merged look (older versions still open it);
  `parts` / `activePartId` are only written when there's more than one plain part.
- Select tool → "Move to new part" splits the selection into its own part.

### Extend / overlay objects (the subtle part)

An `extend` object (`VoxelObject.kind === 'extend'`, `baseId` set) stores **only a
diff** in its own `VoxelData`: colour values for added/recoloured voxels, and
`REMOVED` sentinel cells for base voxels it deletes. Empty cells inherit the base.

- `resolveEffectiveData(obj, project)` — recursive (cycle-guarded) merge of the
  resolved base with this overlay. Used for export and the tool read-view.
- `buildActiveRender(obj, project)` — splits into `editableData` (overlay-only,
  the bright editable mesh) and `baseContext` (resolved base minus overlay-touched
  cells, the dimmed locked mesh).
- `overlayWriteValue(value, baseResolved, x, y, z)` — an erase (`value === 0`)
  becomes `REMOVED` only where the base actually has a voxel, else a plain
  delete. A colour write that **matches the base** stores `0` (inherit), never a
  redundant copy: tools read the *resolved* grid, so a broad op (bucket flood,
  box fill, moved selection) would otherwise write every resolved cell back and
  bake the whole base into the overlay — after which nothing renders as locked
  base and base edits stop propagating. `compactOverlay()` repairs an overlay
  that already got baked (drops redundant cells, resolved look unchanged);
  `store.resyncOverlay` exposes it as "Re-sync overlay with base".
- `ToolRunner.revertToBase(cells)` (on `ToolContext`) clears the overlay's own
  entries at those cells so they inherit again — writing 0 would instead record
  an explicit `REMOVED`, so reverting needs its own path. Reached from the
  viewport context menu (voxel / connected region) and the selection panel's
  "Give back to base", which walks the whole box so deletions are revertible.
- `ToolRunner` keeps a live resolved read-view in lockstep with overlay writes so
  tools see "what's visually there" while writes target the overlay.

## Roadmap

- **Done — iter 1:** chunked storage, worker greedy mesher, Godot camera, tools
  (place/erase/box/paint/eyedropper), build planes, shape dialog, palette,
  outliner, per-object undo/redo, `.voxproj` save, single-object GLB export.
- **Done — iter 2:** extend/overlay objects, viewport + outliner context menus,
  flood ops, app icon/branding.
- **Done — iter 3:** select tool + selection ops (move/recolour/duplicate/delete,
  box-drag + arrow-key nudge), IndexedDB autosave + recent-projects list with
  thumbnails, PWA (manifest + service worker, prompt-to-update), batch export to
  a folder, ortho camera + preset views (numpad 1/3/5/7). Also: live re-mesh
  during drag strokes, Shift = straight-line draw for place/erase/paint.
- **Done — iter 4 (so far):** letter tool shortcuts + RMB-erase toggle, "reset
  extend to base", fractional brush (full / half / third voxel, auto-subdivides
  on first use), plane-locked drag strokes, batched chunk meshing, GitHub Pages
  deploy. RLE chunk storage. Settings dialog with light/dark/system theme
  (viewport + gizmos follow it), Ctrl+S save, export progress overlay, tooltips.
  Font Awesome Pro icons. Shift (not Ctrl) for opposite preset views; dead-on
  top/bottom view (pole up-vector swing in `GodotControls`). Whole-object 90°
  Y-rotation (`VoxelData.rotateY` → `store.rotateActive`, drops history, rotates
  an extend base + its overlays together). Paint-bucket tool (`BucketTool`,
  spread mode volume/face/outline via `store.bucketMode`; face = coplanar cells
  whose outward side is exposed; Shift = ignore connectivity). FRONT/+Z and
  LEFT/−X sprite labels on the ground grid (`Gizmos`, theme-aware). Single-cell
  (1/6) brush size. `store.setExtendBase` — re-link / re-parent an overlay
  keeping its diff (Outliner context menu "Set base → …"), matching detail and
  auto-rotating it back into orientation via `resolve.alignOverlayToBase` (best
  90° fit of REMOVED markers onto base voxels); broken-base overlays show
  "ext ⚠". `store.rotateOverlay` — spin just an overlay's diff to re-align it by
  hand. `resolve.extendFamily` keeps a base + its whole overlay chain together
  for rotate / subdivide; `Project.remove` cascades transitively.
  Select-tool X-ray (`store.xray`, Alt+Z, only rendered while select is active):
  on → meshes go see-through and a box drag reaches through the whole grid
  along the start face's normal; off → the box is narrowed to camera-visible
  voxels (`ops/visibility.ts`, grid-marched sight lines) and becomes a cell
  selection, highlighted per voxel by `Gizmos`.
  Mirror modelling (`store.mirror`, indexed by flipped axis: YZ/XZ/XY toolbar
  toggles): planes run through the grid centre (`core/ops/mirror.ts`). A batch
  opts in via `begin(label, 'draw' | 'recolour')` — place/erase/box/RMB-erase
  draw, paint/bucket recolour (mirrored cell only if already solid). Mirroring
  happens per cell in `ToolRunner.write`, so brush blocks, overlays and undo
  follow for free; selection ops / shapes / context menu stay unmirrored.
  `Gizmos` draws the active planes (axis-coloured) + ghost cursors. The build
  plane is a toolbar toggle (XZ/XY/YZ); `Gizmos.setBuildPlane` lights up the
  two axes it spans (glow bars along the grid edges), the normal axis fades.
  Screenshot mode (`store.screenshotMode`, camera key in `ToolRail`, Esc
  leaves): `ScreenshotPanel` drives the camera via `Viewport.applyShot`
  (view / tilt / zoom / light / projection, settings in localStorage), gizmos
  hidden, mouse nav + tools off, an overlay shows merged with its base. The
  square crop is drawn in the viewport; `Viewport.renderShot` renders exactly
  that square to a PNG (MSAA render target, un-premultiplied) named after the
  object. The modelling camera is restored on exit.
- **Done — iter 5:** UI redesign (brand mint, tool rail, floating tool
  options, axis colours throughout), shape dialog (more solids + flat shapes,
  voxel size, remembered input), screenshot mode, parts + modifier stack
  (array / mirror / move / radial), see-through palette colours (glass).
- **Later — iter 4 ideas:** selection copy/paste across objects, marquee in
  screen space, per-object up-axis/pivot in the export dialog.
