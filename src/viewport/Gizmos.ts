import * as THREE from 'three';
import type { BuildPlane } from './Picker';

export interface CursorBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  color: number;
}

/** Grid / bbox colours per theme: [cell, voxel, bbox]. */
const GRID_DARK = { cell: 0x2a2f3d, cellLine: 0x23272f, voxel: 0x3a4252, voxelLine: 0x2a2f3d, bbox: 0x4a5568 };
const GRID_LIGHT = { cell: 0xcfd3db, cellLine: 0xdadde3, voxel: 0xb2b8c4, voxelLine: 0xcfd3db, bbox: 0x9aa1af };

/** X / Y / Z colours, shared by the axis lines, their build-plane glow and the mirror planes. */
const AXIS_COLORS = [0xff4d4d, 0x4dff88, 0x4d9bff] as const;
const MIRROR_COLORS = AXIS_COLORS;

/** The two axes a build plane spans. */
const PLANE_AXES: Record<BuildPlane, [0 | 1 | 2, 0 | 1 | 2]> = { xz: [0, 2], xy: [0, 1], yz: [1, 2] };

/** Ground-edge orientation labels: FRONT sits on the +Z edge, LEFT on the -X edge. */
const LABEL_INK = { dark: '#9aa3b7', light: '#5b6473' };

/** Ground grid, object bounding box, axis lines and the edit cursor. */
export class Gizmos {
  readonly group = new THREE.Group();
  private gridCell: THREE.GridHelper | null = null;
  private gridVoxel: THREE.GridHelper | null = null;
  private lastSize: [number, number, number] = [16, 16, 16];
  private lastDetail = 1;
  private theme = GRID_DARK;
  private bbox: THREE.LineSegments;
  private axes: THREE.Group;
  /** per axis: the short line at the origin + a glowing bar shown while it spans the build plane */
  private axisLines: THREE.Line[] = [];
  private axisGlow: THREE.Mesh[] = [];
  private buildPlane: BuildPlane = 'xz';
  private cursor: THREE.LineSegments;
  private cursorFill: THREE.Mesh;
  private selection: THREE.LineSegments;
  private selectionFill: THREE.Mesh;
  /** per-voxel highlight for a cell-exact selection (visible-only / flood) */
  private selectionCells: THREE.Mesh;
  private frontLabel: THREE.Sprite;
  private leftLabel: THREE.Sprite;
  /** mirrored copies of the cursor, one per mirror image (max 7) */
  private ghosts: Array<{ line: THREE.LineSegments; fill: THREE.Mesh }> = [];
  /** one translucent quad + outline per mirror plane, indexed by flipped axis */
  private mirrorPlanes: Array<{ fill: THREE.Mesh; edge: THREE.LineLoop }> = [];
  private mirrorAxes: readonly [boolean, boolean, boolean] = [false, false, false];

  constructor() {
    this.bbox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.6 }),
    );
    this.group.add(this.bbox);

    this.axes = new THREE.Group();
    for (let a = 0; a < 3; a++) {
      const dir = new THREE.Vector3().setComponent(a, 4);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), dir]),
        new THREE.LineBasicMaterial({ color: AXIS_COLORS[a], transparent: true }),
      );
      const glow = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({
          color: AXIS_COLORS[a],
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      glow.renderOrder = 960;
      this.axes.add(line, glow);
      this.axisLines.push(line);
      this.axisGlow.push(glow);
    }
    this.group.add(this.axes);

    this.cursorFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.22,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.cursorFill.visible = false;
    this.cursorFill.renderOrder = 1000;
    this.group.add(this.cursorFill);

    this.cursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: 0xffffff,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.cursor.visible = false;
    this.cursor.renderOrder = 1001;
    this.group.add(this.cursor);

    // translucent fill so the selection reads as a solid volume, not a hairline
    this.selectionFill = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({
        color: 0x28e0ff,
        transparent: true,
        opacity: 0.16,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        side: THREE.DoubleSide,
      }),
    );
    this.selectionFill.visible = false;
    this.selectionFill.renderOrder = 998;
    this.group.add(this.selectionFill);

    this.selectionCells = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.MeshBasicMaterial({
        color: 0x28e0ff,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -4,
      }),
    );
    this.selectionCells.visible = false;
    this.selectionCells.renderOrder = 998;
    this.group.add(this.selectionCells);

    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({
        color: 0x28e0ff,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    this.selection.visible = false;
    this.selection.renderOrder = 999;
    this.group.add(this.selection);

    for (let a = 0; a < 3; a++) {
      const fill = new THREE.Mesh(
        new THREE.BufferGeometry(),
        new THREE.MeshBasicMaterial({
          color: MIRROR_COLORS[a],
          transparent: true,
          opacity: 0.1,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      fill.renderOrder = 950;
      // the frame ignores depth so the plane's extent reads even where voxels cover it
      const edge = new THREE.LineLoop(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: MIRROR_COLORS[a],
          transparent: true,
          opacity: 0.85,
          depthTest: false,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      edge.renderOrder = 951;
      fill.visible = edge.visible = false;
      this.group.add(fill, edge);
      this.mirrorPlanes.push({ fill, edge });
    }

    this.frontLabel = makeLabelSprite();
    this.leftLabel = makeLabelSprite();
    for (const s of [this.frontLabel, this.leftLabel]) this.group.add(s);
    this.redrawLabels();

    this.setObjectSize(16, 16, 16);
  }

  /** Repaint the FRONT / LEFT label textures in the current theme colour. */
  private redrawLabels(): void {
    const ink = this.theme === GRID_DARK ? LABEL_INK.dark : LABEL_INK.light;
    for (const [sprite, text] of [
      [this.frontLabel, 'FRONT'],
      [this.leftLabel, 'LEFT'],
    ] as const) {
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.map?.dispose();
      const { texture, aspect } = makeLabelTexture(text, ink);
      mat.map = texture;
      mat.needsUpdate = true;
      sprite.userData.aspect = aspect;
    }
    this.layoutLabels();
  }

  /** Park the labels just outside the ground grid, scaled to the object. */
  private layoutLabels(): void {
    const [x, , z] = this.lastSize;
    const span = Math.max(x, z);
    const em = Math.min(4.5, Math.max(1.5, span * 0.05));
    const margin = Math.max(1.5, span * 0.045);
    for (const sprite of [this.frontLabel, this.leftLabel]) {
      const aspect = (sprite.userData.aspect as number) ?? 3;
      sprite.scale.set(em * aspect, em, 1);
    }
    this.frontLabel.position.set(x / 2, 0.02, z + margin + em / 2);
    this.leftLabel.position.set(-margin - em / 2, 0.02, z / 2);
  }

  /**
   * @param detail cells per voxel edge. The main grid is drawn per voxel; when
   *   detail > 1 a fainter grid shows the sub-voxel cells underneath.
   */
  setDark(dark: boolean): void {
    this.theme = dark ? GRID_DARK : GRID_LIGHT;
    (this.bbox.material as THREE.LineBasicMaterial).color.setHex(this.theme.bbox);
    this.redrawLabels();
    this.setObjectSize(...this.lastSize, this.lastDetail);
  }

  setObjectSize(x: number, y: number, z: number, detail = this.lastDetail): void {
    this.lastSize = [x, y, z];
    this.lastDetail = detail;
    this.bbox.scale.set(x, y, z);
    this.bbox.position.set(x / 2, y / 2, z / 2);

    for (const g of [this.gridCell, this.gridVoxel]) {
      if (!g) continue;
      this.group.remove(g);
      g.geometry.dispose();
      (g.material as THREE.Material).dispose();
    }

    const step = Math.max(1, Math.round(detail));
    const span = Math.max(x, z);
    const t = this.theme;

    if (step > 1) {
      this.gridCell = new THREE.GridHelper(span, span, t.cell, t.cellLine);
      this.gridCell.position.set(x / 2, 0, z / 2);
      this.group.add(this.gridCell);
    } else {
      this.gridCell = null;
    }

    const voxels = Math.max(1, Math.round(span / step));
    this.gridVoxel = new THREE.GridHelper(voxels * step, voxels, t.voxel, t.voxelLine);
    this.gridVoxel.position.set(x / 2, 0.01, z / 2);
    this.group.add(this.gridVoxel);

    this.layoutLabels();
    this.layoutMirror();
    this.layoutAxes();
  }

  /** Light up the two axes the build plane spans; the one it's normal to fades. */
  setBuildPlane(plane: BuildPlane): void {
    this.buildPlane = plane;
    this.layoutAxes();
  }

  private layoutAxes(): void {
    const active = PLANE_AXES[this.buildPlane];
    const size = this.lastSize;
    // thick enough to read at any zoom, thin enough to stay a line
    const t = Math.max(0.08, Math.max(...size) * 0.006);
    for (let a = 0; a < 3; a++) {
      const on = active.includes(a as 0 | 1 | 2);
      (this.axisLines[a].material as THREE.LineBasicMaterial).opacity = on ? 1 : 0.3;
      const glow = this.axisGlow[a];
      glow.visible = on;
      if (!on) continue;
      // run the bar along the whole grid edge, so the plane's extent reads too
      const len = size[a];
      glow.scale.set(t, t, t).setComponent(a, len);
      glow.position.set(0, 0, 0).setComponent(a, len / 2);
    }
  }

  /** Show the mirror planes whose flipped axis is on; each cuts the grid centre. */
  setMirror(axes: readonly [boolean, boolean, boolean]): void {
    this.mirrorAxes = axes;
    this.layoutMirror();
  }

  private layoutMirror(): void {
    const size = this.lastSize;
    this.mirrorPlanes.forEach(({ fill, edge }, a) => {
      const on = this.mirrorAxes[a];
      fill.visible = edge.visible = on;
      if (!on) return;
      const corners = mirrorQuad(a as 0 | 1 | 2, size);
      fill.geometry.dispose();
      fill.geometry = new THREE.BufferGeometry().setFromPoints(corners);
      fill.geometry.setIndex([0, 1, 2, 0, 2, 3]);
      edge.geometry.dispose();
      edge.geometry = new THREE.BufferGeometry().setFromPoints(corners);
    });
  }

  /** The edit cursor, plus dimmer copies at its mirror positions. */
  setCursor(box: CursorBox | null, mirrored: CursorBox[] = []): void {
    this.applyBox(this.cursor, box);
    this.applyBox(this.cursorFill, box);
    while (this.ghosts.length < mirrored.length) this.ghosts.push(this.makeGhost());
    this.ghosts.forEach((g, i) => {
      const b = box ? (mirrored[i] ?? null) : null;
      this.applyBox(g.line, b);
      this.applyBox(g.fill, b);
    });
  }

  private makeGhost(): { line: THREE.LineSegments; fill: THREE.Mesh } {
    const line = this.cursor.clone();
    line.material = (this.cursor.material as THREE.LineBasicMaterial).clone();
    (line.material as THREE.LineBasicMaterial).opacity = 0.55;
    const fill = this.cursorFill.clone();
    fill.material = (this.cursorFill.material as THREE.MeshBasicMaterial).clone();
    (fill.material as THREE.MeshBasicMaterial).opacity = 0.1;
    line.visible = fill.visible = false;
    this.group.add(line, fill);
    return { line, fill };
  }

  /** Selection outline; with `cells`, those voxels are highlighted instead of the whole box. */
  setSelection(box: CursorBox | null, cells?: Array<[number, number, number]>): void {
    this.applyBox(this.selection, box);
    this.applyBox(this.selectionFill, box && !cells ? box : null);
    this.selectionCells.geometry.dispose();
    this.selectionCells.geometry = box && cells ? cellFacesGeometry(cells) : new THREE.BufferGeometry();
    this.selectionCells.visible = !!(box && cells);
    if (box) (this.selectionCells.material as THREE.MeshBasicMaterial).color.setHex(box.color);
  }

  private applyBox(target: THREE.LineSegments | THREE.Mesh, box: CursorBox | null): void {
    if (!box) {
      target.visible = false;
      return;
    }
    target.visible = true;
    target.scale.set(
      Math.max(0.001, box.max.x - box.min.x),
      Math.max(0.001, box.max.y - box.min.y),
      Math.max(0.001, box.max.z - box.min.z),
    );
    target.position.set(
      (box.min.x + box.max.x) / 2,
      (box.min.y + box.max.y) / 2,
      (box.min.z + box.max.z) / 2,
    );
    (target.material as THREE.LineBasicMaterial).color.setHex(box.color);
  }

  dispose(): void {
    (this.frontLabel.material as THREE.SpriteMaterial).map?.dispose();
    (this.leftLabel.material as THREE.SpriteMaterial).map?.dispose();
    this.group.clear();
  }
}

/** Corners of the mirror plane that flips `axis`, spanning the grid at its centre. */
function mirrorQuad(axis: 0 | 1 | 2, [x, y, z]: [number, number, number]): THREE.Vector3[] {
  if (axis === 0) {
    const c = x / 2;
    return [new THREE.Vector3(c, 0, 0), new THREE.Vector3(c, y, 0), new THREE.Vector3(c, y, z), new THREE.Vector3(c, 0, z)];
  }
  if (axis === 1) {
    const c = y / 2;
    return [new THREE.Vector3(0, c, 0), new THREE.Vector3(x, c, 0), new THREE.Vector3(x, c, z), new THREE.Vector3(0, c, z)];
  }
  const c = z / 2;
  return [new THREE.Vector3(0, 0, c), new THREE.Vector3(x, 0, c), new THREE.Vector3(x, y, c), new THREE.Vector3(0, y, c)];
}

/** The outer faces of a set of cells (faces between two selected cells are skipped). */
function cellFacesGeometry(cells: Array<[number, number, number]>): THREE.BufferGeometry {
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  const set = new Set(cells.map(([x, y, z]) => key(x, y, z)));
  // per face: outward normal + its 4 corners as offsets from the cell origin
  const faces: Array<[[number, number, number], number[]]> = [
    [[1, 0, 0], [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1]],
    [[-1, 0, 0], [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0]],
    [[0, 1, 0], [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0]],
    [[0, -1, 0], [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1]],
    [[0, 0, 1], [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]],
    [[0, 0, -1], [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0]],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [x, y, z] of cells) {
    for (const [n, c] of faces) {
      if (set.has(key(x + n[0], y + n[1], z + n[2]))) continue;
      const base = pos.length / 3;
      for (let i = 0; i < 12; i += 3) pos.push(x + c[i], y + c[i + 1], z + c[i + 2]);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

function makeLabelSprite(): THREE.Sprite {
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      transparent: true,
      opacity: 0.9,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  sprite.renderOrder = 900;
  return sprite;
}

function makeLabelTexture(text: string, color: string): { texture: THREE.CanvasTexture; aspect: number } {
  const font = '600 48px "Josefin Sans", system-ui, sans-serif';
  const pad = 14;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = font;
  const w = Math.ceil(probe.measureText(text).width) + pad * 2;
  const h = 48 + pad * 2;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d')!;
  g.font = font;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = color;
  g.fillText(text, w / 2, h / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { texture, aspect: w / h };
}
