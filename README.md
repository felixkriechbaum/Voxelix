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
- Views: Numpad `1`/`3`/`7` front/right/top (Shift = opposite), `5` toggles ortho;
  also a Persp/Ortho + preset-view panel in the viewport
- Tools: `1`/`W` place · `2`/`E` erase · `3`/`R` box · `4`/`T` paint ·
  `5`/`G` bucket · `6`/`Q` eyedropper · `7`/`V` select
- Hold `Shift` while drawing to lock the stroke to one axis (straight line)
- Bucket: click to reflood a same-colour region with the current colour. Spread
  mode (toolbar): `Volume` 3D flood · `Face` the clicked surface layer ·
  `Outline` just that layer's border ring. `Shift`+click ignores connectivity
  (every matching voxel in scope)
- Rotate a whole object 90° about the vertical axis from the outliner buttons
  or either context menu
- Select: drag a box, drag inside it to slide the voxels, arrow keys nudge
  (`Shift`+↕ for Y), `Del` clears, `Esc` deselects
- `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo (per object)
- RMB click (no drag) → context menu

Projects autosave to the browser (IndexedDB) 5 s after the last edit and show up
on the start screen as recent projects; installable as a PWA, works offline.

## Status

**Done:** chunked storage, worker greedy mesher, Godot-style camera with
perspective/ortho + preset views, tools (place/erase/box/paint/eyedropper/select
with move·recolour·duplicate·delete), straight-line draw, live re-mesh while
dragging, build planes XY/XZ/YZ, shape dialog (box/sphere/cylinder/pyramid),
256-colour palette, outliner (add/rename/duplicate/extend/delete/resize),
per-object undo/redo, extend/overlay objects, viewport + outliner context menus,
`.voxproj` save, IndexedDB autosave + recent projects, single-object and batch
`.glb` export, PWA / offline.

**Next:** copy/paste selections across objects, per-object export-settings dialog,
grid snapping, mirror modelling.
