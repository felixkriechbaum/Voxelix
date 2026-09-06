import * as THREE from 'three';

export interface CursorBox {
  min: THREE.Vector3;
  max: THREE.Vector3;
  color: number;
}

/** Ground grid, object bounding box, axis lines and the edit cursor. */
export class Gizmos {
  readonly group = new THREE.Group();
  private grid: THREE.GridHelper | null = null;
  private bbox: THREE.LineSegments;
  private axes: THREE.Group;
  private cursor: THREE.LineSegments;
  private selection: THREE.LineSegments;

  constructor() {
    this.bbox = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x4a5568, transparent: true, opacity: 0.6 }),
    );
    this.group.add(this.bbox);

    this.axes = buildAxes();
    this.group.add(this.axes);

    this.cursor = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xffffff }),
    );
    this.cursor.visible = false;
    this.cursor.renderOrder = 2;
    (this.cursor.material as THREE.LineBasicMaterial).depthTest = false;
    this.group.add(this.cursor);

    this.selection = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0x7cff9b }),
    );
    this.selection.visible = false;
    this.selection.renderOrder = 1;
    (this.selection.material as THREE.LineBasicMaterial).depthTest = false;
    this.group.add(this.selection);

    this.setObjectSize(16, 16, 16);
  }

  setObjectSize(x: number, y: number, z: number): void {
    this.bbox.scale.set(x, y, z);
    this.bbox.position.set(x / 2, y / 2, z / 2);

    if (this.grid) {
      this.group.remove(this.grid);
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    const span = Math.max(x, z);
    this.grid = new THREE.GridHelper(span, span, 0x3a4252, 0x2a2f3d);
    this.grid.position.set(x / 2, 0, z / 2);
    this.group.add(this.grid);
  }

  setCursor(box: CursorBox | null): void {
    this.applyBox(this.cursor, box);
  }

  setSelection(box: CursorBox | null): void {
    this.applyBox(this.selection, box);
  }

  private applyBox(target: THREE.LineSegments, box: CursorBox | null): void {
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
