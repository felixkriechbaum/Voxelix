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
    project/       Project, VoxelObject, resolve.ts (extend resolution),
                   types (.voxproj schema)
    shapes/        primitive voxelisation (box/sphere/cylinder/pyramid)
    export/        exportGlb.ts — merge chunks, pivot/scale/up-axis, GLTFExporter
    ops/           flood.ts and future selection ops
    io/            projectFile, fileSystem (File System Access + fallbacks),
                   serialize (LE base64 for chunk arrays)
    history/       History (per-object undo stack of voxel diffs) + HistoryStore
    palette.ts     256 sRGB hex slots; paletteToLinearArray for meshing/export
  viewport/        Three.js. Viewport composes GodotControls, Gizmos, Picker,
                   ChunkMeshView (one mesh per non-empty chunk)
  tools/           Tool implementations + ToolContext interface
  editor/          ToolRunner (pointer input → tool → history → viewport),
                   session.ts (shared refs to the mounted viewport/runner)
  stores/          Pinia: editor.ts holds the Project (markRaw) + reactive
                   version counters (structureVersion / activeVersion /
                   paletteVersion) that components watch
  components/      Vue SFCs
```

### Data flow

- The Pinia store holds a `markRaw(Project)`. Vue never deep-proxies voxel data.
  Components react to integer `*Version` refs bumped on mutation.
- Editing: `ViewportCanvas` forwards pointer events to `ToolRunner`, which
  implements `ToolContext`, applies voxel writes, records `{x,y,z,prev,next}`
  diffs, pushes history batches, and tells the `Viewport` to re-mesh.
- Meshing is always off-thread. A chunk is re-meshed when its voxels or a
  neighbour's border voxels change (`VoxelData.dirty`).

### Coordinate conventions

- Voxel `(x,y,z)` fills the unit cube `[x, x+1]`. Meshes sit at the origin.
- Build planes: XZ (ground, default), XY, YZ, with an integer offset.
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
- **Next — iter 3:** select tool + selection ops (move/recolour/duplicate),
  IndexedDB autosave + recent-projects list, PWA (manifest from `public/icon.png`,
  service worker), batch export to a folder, ortho camera + preset views.
