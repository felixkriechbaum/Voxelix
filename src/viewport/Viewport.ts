import * as THREE from 'three';
import { GodotControls, type PresetView, type ProjectionMode } from './GodotControls';
import { Gizmos, type CursorBox } from './Gizmos';
import { Picker, type BuildPlane, type PickResult } from './Picker';
import { ChunkMeshView } from './ChunkMeshView';
import { ChunkMesher } from '@/core/mesh/ChunkMesher';
import type { ActiveRender } from '@/core/project/resolve';
import type { VoxelData } from '@/core/voxel/VoxelData';

export class Viewport {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly orthoCamera: THREE.OrthographicCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: GodotControls;
  readonly gizmos = new Gizmos();
  readonly mesher = new ChunkMesher();
  private picker = new Picker();

  private editableView: ChunkMeshView | null = null;
  private baseView: ChunkMeshView | null = null;
  private clock = new THREE.Clock();
  private raf = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.scene.background = new THREE.Color(0x181b23);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
    // wide symmetric depth slab so an orbiting ortho camera never clips the object
    this.orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, -4000, 4000);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      // let captureThumbnail() read the frame back on demand
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.controls = new GodotControls(this.camera, this.orthoCamera, canvas);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x2b2f3a, 1.05);
    const key = new THREE.DirectionalLight(0xffffff, 1.7);
    key.position.set(28, 44, 18);
    const fill = new THREE.DirectionalLight(0xbcd0ff, 0.5);
    fill.position.set(-20, 12, -24);
    this.scene.add(hemi, key, fill);
    this.scene.add(this.gizmos.group);

    this.mesher.onResult((r) => {
      this.editableView?.applyResult(r);
      this.baseView?.applyResult(r);
    });

    this.resize();
    this.loop();
  }

  setPalette(paletteLinear: Float32Array<ArrayBufferLike>): void {
    this.mesher.setPalette(paletteLinear);
    for (const view of [this.editableView, this.baseView]) {
      if (!view) continue;
      view.data.markAllChunksDirty();
      view.flush();
    }
  }

  /** Install / refresh the active render bundle (editable grid + optional locked base). */
  setActiveRender(render: ActiveRender): void {
    if (this.editableView && this.editableView.id === render.editableId) {
      this.editableView.setData(render.editableData);
    } else {
      this.editableView?.dispose();
      this.editableView = new ChunkMeshView(render.editableId, render.editableData, this.mesher);
      this.scene.add(this.editableView.group);
      this.editableView.flush();
    }

    if (render.baseContext) {
      const baseId = `${render.editableId}::base`;
      if (this.baseView && this.baseView.id === baseId) {
        this.baseView.setData(render.baseContext);
      } else {
        this.baseView?.dispose();
        this.baseView = new ChunkMeshView(baseId, render.baseContext, this.mesher, { dimmed: true });
        this.scene.add(this.baseView.group);
        this.baseView.flush();
      }
    } else {
      this.baseView?.dispose();
      this.baseView = null;
    }

    const d = render.editableData;
    const b = render.baseContext;
    this.gizmos.setObjectSize(
      Math.max(d.sizeX, b?.sizeX ?? 0),
      Math.max(d.sizeY, b?.sizeY ?? 0),
      Math.max(d.sizeZ, b?.sizeZ ?? 0),
    );
  }

  flush(): void {
    this.editableView?.flush();
  }

  /** Swap only the editable grid (extend overlay re-resolve) without touching the base. */
  refreshEditable(data: VoxelData): void {
    this.editableView?.setData(data);
  }

  /** Swap only the locked base-context grid (extend overlay punched new holes). */
  refreshBase(data: VoxelData): void {
    this.baseView?.setData(data);
  }

  pick(clientX: number, clientY: number, buildPlane: BuildPlane, buildOffset: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const d = this.editableView?.data;
    const size = d
      ? { x: d.sizeX, y: d.sizeY, z: d.sizeZ }
      : { x: 16, y: 16, z: 16 };
    const targets: THREE.Object3D[] = [
      ...(this.editableView?.raycastTargets() ?? []),
      ...(this.baseView?.raycastTargets() ?? []),
    ];
    return this.picker.pick(ndc, this.controls.camera, targets, size, buildPlane, buildOffset);
  }

  get projection(): ProjectionMode {
    return this.controls.mode;
  }

  setProjection(mode: ProjectionMode): void {
    this.controls.setMode(mode);
  }

  setView(view: PresetView): void {
    this.controls.setView(view);
  }

  setCursor(box: CursorBox | null): void {
    this.gizmos.setCursor(box);
  }

  setSelectionBox(box: CursorBox | null): void {
    this.gizmos.setSelection(box);
  }

  frameActive(): void {
    const d = this.editableView?.data;
    if (!d) return;
    const b = d.filledBounds() ?? this.baseView?.data.filledBounds() ?? null;
    const center = b
      ? new THREE.Vector3((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2)
      : new THREE.Vector3(d.sizeX / 2, d.sizeY / 2, d.sizeZ / 2);
    const radius = b
      ? Math.max(b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z) * 0.5
      : Math.max(d.sizeX, d.sizeY, d.sizeZ) * 0.5;
    this.controls.frame(center, Math.max(radius, 3));
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.controls.setAspect(w / h);
  }

  /** Small JPEG data URL of the current view, for the recent-projects list. */
  captureThumbnail(maxEdge = 320): string | null {
    try {
      this.renderer.render(this.scene, this.controls.camera);
      const src = this.renderer.domElement;
      if (!src.width || !src.height) return null;
      const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
      const cw = Math.max(1, Math.round(src.width * scale));
      const ch = Math.max(1, Math.round(src.height * scale));
      const off = document.createElement('canvas');
      off.width = cw;
      off.height = ch;
      const g = off.getContext('2d');
      if (!g) return null;
      g.drawImage(src, 0, 0, cw, ch);
      return off.toDataURL('image/jpeg', 0.7);
    } catch {
      return null;
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    this.controls.update(this.clock.getDelta());
    this.renderer.render(this.scene, this.controls.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.editableView?.dispose();
    this.baseView?.dispose();
    this.gizmos.dispose();
    this.mesher.dispose();
    this.renderer.dispose();
  }
}
