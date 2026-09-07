import * as THREE from 'three';

export type BuildPlane = 'xy' | 'xz' | 'yz';

export interface PickResult {
  /** voxel that a place action would fill */
  place: THREE.Vector3;
  /** voxel that an erase action would clear, or null when pointing at empty space */
  remove: THREE.Vector3 | null;
  /** outward face normal, integer components */
  normal: THREE.Vector3;
  hitObject: boolean;
}

export class Picker {
  private ray = new THREE.Raycaster();

  pick(
    ndc: THREE.Vector2,
    camera: THREE.Camera,
    targets: THREE.Object3D[],
    objectSize: { x: number; y: number; z: number },
    buildPlane: BuildPlane,
    buildOffset: number,
    /** grid cells per block edge; the scene is drawn at cell / subdivision */
    subdivision = 1,
  ): PickResult | null {
    this.ray.setFromCamera(ndc, camera);
    const s = Math.max(1, subdivision);

    const hits = this.ray.intersectObjects(targets, false);
    if (hits.length > 0 && hits[0].face) {
      const h = hits[0];
      const n = h.face!.normal.clone();
      n.set(Math.round(n.x), Math.round(n.y), Math.round(n.z));
      const p = h.point.clone().multiplyScalar(s); // world -> cell coords
      const solid = new THREE.Vector3(
        Math.floor(p.x - n.x * 0.5),
        Math.floor(p.y - n.y * 0.5),
        Math.floor(p.z - n.z * 0.5),
      );
      return {
        place: solid.clone().add(n),
        remove: solid,
        normal: n,
        hitObject: true,
      };
    }

    const plane = planeFor(buildPlane, buildOffset / s);
    const point = new THREE.Vector3();
    if (!this.ray.ray.intersectPlane(plane, point)) return null;
    point.multiplyScalar(s); // world -> cell coords

    const place = new THREE.Vector3(
      Math.floor(point.x),
      Math.floor(point.y),
      Math.floor(point.z),
    );
    if (buildPlane === 'xz') place.y = buildOffset;
    if (buildPlane === 'xy') place.z = buildOffset;
    if (buildPlane === 'yz') place.x = buildOffset;

    if (
      place.x < -1 || place.y < -1 || place.z < -1 ||
      place.x > objectSize.x || place.y > objectSize.y || place.z > objectSize.z
    ) {
      return null;
    }
    return { place, remove: null, normal: normalFor(buildPlane), hitObject: false };
  }
}

function planeFor(plane: BuildPlane, offset: number): THREE.Plane {
  if (plane === 'xz') return new THREE.Plane(new THREE.Vector3(0, 1, 0), -offset);
  if (plane === 'xy') return new THREE.Plane(new THREE.Vector3(0, 0, 1), -offset);
  return new THREE.Plane(new THREE.Vector3(1, 0, 0), -offset);
}

function normalFor(plane: BuildPlane): THREE.Vector3 {
  if (plane === 'xz') return new THREE.Vector3(0, 1, 0);
  if (plane === 'xy') return new THREE.Vector3(0, 0, 1);
  return new THREE.Vector3(1, 0, 0);
}
