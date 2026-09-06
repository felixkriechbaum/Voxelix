import * as THREE from 'three';

/**
 * Godot-editor-style camera navigation:
 *  - MMB drag           orbit around the focus point
 *  - Shift + MMB drag   pan the focus point
 *  - wheel              dolly in / out
 *  - RMB drag           free-look; hold and use WASD + Q/E to fly
 *  - F                  frame a target box (call frame())
 */
export class GodotControls {
  target = new THREE.Vector3(8, 8, 8);
  distance = 48;
  yaw = Math.PI * 0.25;
  pitch = Math.PI * 0.28;
  /** flip vertical orbit direction */
  invertY = false;

  private readonly minPitch = -Math.PI / 2 + 0.05;
  private readonly maxPitch = Math.PI / 2 - 0.05;
  private dragButton: number | null = null;
  private last = new THREE.Vector2();
  private keys = new Set<string>();
  private flySpeed = 16; // voxels / second

  /** RMB press-and-release without a drag / fly opens a context menu. */
  onContextClick: ((clientX: number, clientY: number) => void) | null = null;
  private rmbDownAt = new THREE.Vector2();
  private rmbDownTime = 0;
  private rmbMoved = false;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private dom: HTMLElement,
  ) {
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.apply();
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }

  /** True while a navigation drag is active — tools should ignore pointer input then. */
  get navigating(): boolean {
    return this.dragButton !== null;
  }

  frame(center: THREE.Vector3, radius: number): void {
    this.target.copy(center);
    const fov = (this.camera.fov * Math.PI) / 180;
    this.distance = Math.max(4, (radius * 1.6) / Math.sin(fov / 2));
    this.apply();
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      this.dragButton = e.button;
      this.last.set(e.clientX, e.clientY);
      this.dom.setPointerCapture(e.pointerId);
      e.preventDefault();
      if (e.button === 2) {
        this.rmbDownAt.set(e.clientX, e.clientY);
        this.rmbDownTime = performance.now();
        this.rmbMoved = false;
      }
    }
  };

  private onPointerMove = (e: PointerEvent) => {
    if (this.dragButton === null) return;
    const dx = e.clientX - this.last.x;
    const dy = e.clientY - this.last.y;
    this.last.set(e.clientX, e.clientY);
    if (this.dragButton === 2 && this.rmbDownAt.distanceTo(new THREE.Vector2(e.clientX, e.clientY)) > 4) {
      this.rmbMoved = true;
    }

    const panning = this.dragButton === 1 && e.shiftKey;
    if (panning) {
      const panScale = this.distance * 0.0015;
      const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
      this.target.addScaledVector(right, -dx * panScale);
      this.target.addScaledVector(up, dy * panScale);
    } else {
      this.yaw -= dx * 0.005;
      this.pitch += (this.invertY ? -1 : 1) * dy * 0.005;
      this.pitch = Math.max(this.minPitch, Math.min(this.maxPitch, this.pitch));
    }
    this.apply();
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button === this.dragButton) {
      if (
        e.button === 2 &&
        !this.rmbMoved &&
        performance.now() - this.rmbDownTime < 500 &&
        !this.hasFlyKey()
      ) {
        this.onContextClick?.(e.clientX, e.clientY);
      }
      this.dragButton = null;
      try {
        this.dom.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  private hasFlyKey(): boolean {
    return (
      this.keys.has('KeyW') ||
      this.keys.has('KeyA') ||
      this.keys.has('KeyS') ||
      this.keys.has('KeyD') ||
      this.keys.has('KeyQ') ||
      this.keys.has('KeyE')
    );
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const factor = Math.exp(e.deltaY * 0.001);
    this.distance = Math.max(2, Math.min(400, this.distance * factor));
    this.apply();
  };

  private onKeyDown = (e: KeyboardEvent) => {
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  /** Call once per frame with the frame delta in seconds. */
  update(dt: number): void {
    if (this.dragButton !== 2) return;
    const move = new THREE.Vector3();
    const forward = new THREE.Vector3();
    this.camera.getWorldDirection(forward);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    if (this.keys.has('KeyW')) move.add(forward);
    if (this.keys.has('KeyS')) move.sub(forward);
    if (this.keys.has('KeyD')) move.add(right);
    if (this.keys.has('KeyA')) move.sub(right);
    if (this.keys.has('KeyE')) move.y += 1;
    if (this.keys.has('KeyQ')) move.y -= 1;
    if (move.lengthSq() > 0) {
      const speed = this.flySpeed * (this.keys.has('ShiftLeft') ? 3 : 1);
      move.normalize().multiplyScalar(speed * dt);
      this.target.add(move);
      this.apply();
    }
  }

  private apply(): void {
    const cp = this.pitch;
    const offset = new THREE.Vector3(
      this.distance * Math.cos(cp) * Math.sin(this.yaw),
      this.distance * Math.sin(cp),
      this.distance * Math.cos(cp) * Math.cos(this.yaw),
    );
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
