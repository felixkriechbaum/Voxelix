import * as THREE from 'three';

export interface CursorBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  color: number;
}

/** Grid / bbox colours per theme: [cell, voxel, bbox]. */
const GRID_DARK = { cell: 0x2a2f3d, cellLine: 0x23272f, voxel: 0x3a4252, voxelLine: 0x2a2f3d, bbox: 0x4a5568 };
const GRID_LIGHT = { cell: 0xcfd3db, cellLine: 0xdadde3, voxel: 0xb2b8c4, voxelLine: 0xcfd3db, bbox: 0x9aa1af };

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
  private cursor: THREE.LineSegments;
  private cursorFill: THREE.Mesh;
  private selection: THREE.LineSegments;
  private selectionFill: THREE.Mesh;
  private frontLabel: THREE.Sprite;
  private leftLabel: THREE.Sprite;

  constructor() {
    this.bbox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.6 }),
    );
    this.group.add(this.bbox);

    this.axes = buildAxes();
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
  }

  setCursor(box: CursorBox | null): void {
    this.applyBox(this.cursor, box);
    this.applyBox(this.cursorFill, box);
  }

  setSelection(box: CursorBox | null): void {
    this.applyBox(this.selection, box);
    this.applyBox(this.selectionFill, box);
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

function buildAxes(): THREE.Group {
  const g = new THREE.Group();
  const mk = (dir: THREE.Vector3, color: number) => {
    const geom = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), dir]);
    return new THREE.Line(geom, new THREE.LineBasicMaterial({ color }));
  };
  g.add(mk(new THREE.Vector3(4, 0, 0), 0xff4d4d));
  g.add(mk(new THREE.Vector3(0, 4, 0), 0x4dff88));
  g.add(mk(new THREE.Vector3(0, 0, 4), 0x4d9bff));
  return g;
}
