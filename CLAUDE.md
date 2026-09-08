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
    project/       Project (has a stable id), VoxelObject, resolve.ts (extend
                   resolution), types (.voxproj schema)
    shapes/        primitive voxelisation (box/sphere/cylinder/pyramid)
    export/        exportGlb.ts — per-object merge + pivot/scale/up-axis via
                   GLTFExporter; exportProjectToGlbs() for batch export
    ops/           flood.ts, selection.ts (Selection box + region helpers)
    io/            projectFile, fileSystem (File System Access + fallbacks incl.
                   pickDirectory), serialize (LE base64), projectStore
                   (IndexedDB: autosave target + recent-projects source)
    history/       History (per-object undo stack of voxel diffs) + HistoryStore
    palette.ts     256 sRGB hex slots; paletteToLinearArray for meshing/export
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
                   viewstate.ts (per-project camera, localStorage)
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
- Every drag stroke (place/erase/box/paint) locks to the plane of the first hit
  (`Picker.pickPlane` / `ToolContext.pickOnPlane`) so it can't wander onto
  another face or drill inward. Shift adds a straight-line constraint on top.
- Export scale: `ExportSettings.refVoxels` voxels = `refMeters` metres
  (`metersPerVoxel`); default 16 voxels = 1 m. Legacy `unitsPerVoxel` files load
  as `{refVoxels: 1, refMeters: <value>}`.
- Export pivot `bottom-center`: X/Z centred on the filled bounds, Y=0 at the base.
- Export up-axis: glTF-native Y-up, or a baked Y→Z rotation for Blender.

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
  becomes `REMOVED` only where the base actually has a voxel, else a plain delete.
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
  keeping its diff (Outliner context menu "Set base → …"); broken-base overlays
  show "ext ⚠". `resolve.extendFamily` keeps a base + its whole overlay chain
  together for rotate / subdivide; `Project.remove` cascades transitively.
- **Next — iter 4:** ideas — selection copy/paste across objects, marquee in
  screen space, per-object up-axis/pivot in the export dialog, mirror modelling.
