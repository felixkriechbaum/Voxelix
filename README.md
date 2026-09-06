# Voxelix

Fast, browser-based 3D voxel editor for game assets. Per-object `.glb` export.

## Stack

Vite + Vue 3 + TypeScript + Pinia, Three.js for rendering. Greedy meshing runs
in a Web Worker, one 16³ chunk at a time. The same mesh code is reused for export.

## Develop

```bash
bun install
bun run dev        # http://localhost:5173
bun run build      # type-check + production build
bun run typecheck
```

## Concepts

- **Project** (`.voxproj`): an object list + one shared 256-colour palette.
- **Object**: its own voxel grid, up to 64³, one active at a time.
- **Extend**: a linked overlay object. It stores only the diff (added / removed /
  recoloured voxels) over its base; base changes propagate on the next resolve.
  While editing an extension the base shows dimmed and locked underneath. Export
  merges base + overlay into one `.glb`.
- **Duplicate**: an independent, unlinked copy.

## Controls

- Camera: MMB orbit · Shift+MMB pan · wheel zoom · RMB + WASD/QE fly · `F` frame
- Tools: `1` place · `2` erase · `3` box · `4` paint · `5` eyedropper
- `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo (per object)
- RMB click (no drag) → context menu

## Status

**Done:** chunked storage, worker greedy mesher, Godot-style camera, tools
(place/erase/box/paint/eyedropper), build planes XY/XZ/YZ, shape dialog
(box/sphere/cylinder/pyramid), 256-colour palette, outliner
(add/rename/duplicate/extend/delete/resize), per-object undo/redo, extend/overlay
objects, viewport + outliner context menus (pick colour, erase voxel/region, fill
region, object ops), `.voxproj` save, single-object `.glb` export.

**Next:** select tool + selection ops, IndexedDB autosave + recent projects, PWA,
batch folder export, ortho camera + preset views.
