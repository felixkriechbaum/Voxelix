import * as THREE from 'three';

export interface CursorBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  color: number;
}

/** Ground grid, object bounding box, axis lines and the edit cursor. */
export class Gizmos {
  readonly group = new THREE.Group();
  private gridFine: THREE.GridHelper | null = null;
  private gridBlock: THREE.GridHelper | null = null;
  private bbox: THREE.LineSegments;
  private axes: THREE.Group;
  private cursor: THREE.LineSegments;
  private cursorFill: THREE.Mesh;
  private selection: THREE.LineSegments;
  private selectionFill: THREE.Mesh;

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

    this.setObjectSize(16, 16, 16);
  }

  /**
   * @param subdivision grid cells per block edge. The whole gizmo group is drawn
   *   at 1 / subdivision so one block reads as one world unit; a brighter grid
   *   marks the block boundaries when subdivision > 1.
   */
  setObjectSize(x: number, y: number, z: number, subdivision = 1): void {
    this.group.scale.setScalar(1 / subdivision);
    this.axes.scale.setScalar(subdivision); // keep the axis gnomon a constant size

    this.bbox.scale.set(x, y, z);
    this.bbox.position.set(x / 2, y / 2, z / 2);

    for (const g of [this.gridFine, this.gridBlock]) {
      if (!g) continue;
      this.group.remove(g);
      g.geometry.dispose();
      (g.material as THREE.Material).dispose();
    }

    const span = Math.max(x, z);
    this.gridFine = new THREE.GridHelper(span, span, 0x3a4252, 0x2a2f3d);
    this.gridFine.position.set(x / 2, 0, z / 2);
    this.group.add(this.gridFine);

    if (subdivision > 1) {
      const blocks = Math.max(1, Math.round(span / subdivision));
      this.gridBlock = new THREE.GridHelper(blocks * subdivision, blocks, 0x5b6a86, 0x4a5468);
      this.gridBlock.position.set(x / 2, 0.002, z / 2);
      this.group.add(this.gridBlock);
    } else {
      this.gridBlock = null;
    }
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
    this.group.clear();
  }
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
