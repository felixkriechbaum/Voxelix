import * as THREE from 'three';
import { GodotControls, type PresetView, type ProjectionMode } from './GodotControls';
import { Gizmos, type CursorBox } from './Gizmos';
import { Picker, type BuildPlane, type PickResult } from './Picker';
import { ChunkMeshView } from './ChunkMeshView';
import { SmoothMeshView } from './SmoothMeshView';
import { ChunkMesher } from '@/core/mesh/ChunkMesher';
import type { ActiveRender } from '@/core/project/resolve';
import type { SmoothLayer } from '@/core/project/parts';
import type { VoxelData } from '@/core/voxel/VoxelData';
import { adjustPaletteLinear } from '@/core/palette';
import type { ColorAdjust } from '@/core/project/types';
import type { ViewRay } from '@/core/ops/visibility';

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
  /** un-voxeled parts of the active object, by `objectId/partId` */
  private smoothViews = new Map<string, SmoothMeshView>();
  private timer = new THREE.Timer();
  private raf = 0;
  private paletteLinear: Float32Array<ArrayBufferLike> = new Float32Array(256 * 4);
  private activeColorAdjust: ColorAdjust | null = null;
  private xray = false;
  /** the three scene lights at their normal strength, for the screenshot brightness slider */
  private lights: Array<{ light: THREE.Light; base: number }> = [];
  private background = new THREE.Color(0x181b23);

  constructor(private canvas: HTMLCanvasElement) {
    this.scene.background = this.background;

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
    this.lights = [hemi, key, fill].map((light) => ({ light, base: light.intensity }));
    this.scene.add(this.gizmos.group);

    this.mesher.onResult((r) => {
      this.editableView?.applyResult(r);
      this.baseView?.applyResult(r);
    });
    this.mesher.onSmoothResult((r) => this.smoothViews.get(r.key)?.apply(r));

    this.resize();
    this.loop();
  }

  setPalette(paletteLinear: Float32Array<ArrayBufferLike>): void {
    this.paletteLinear = paletteLinear;
    this.mesher.setPalette(paletteLinear);
    this.editableView?.setPaletteOverride(this.colorAdjustOverride());
    this.baseView?.setPaletteOverride(this.colorAdjustOverride());
    for (const v of this.smoothViews.values()) v.remesh(this.smoothPalette());
  }

  /** The palette smooth surfaces are coloured from — the active object's shift applied. */
  private smoothPalette(): Float32Array {
    return (this.colorAdjustOverride() ?? this.paletteLinear) as Float32Array;
  }

  /** The active object's saturation/brightness shift applied to a copy of the
   *  current palette, or null when it has none — the palette itself is never
   *  mutated, so other objects sharing its slots are unaffected. */
  private colorAdjustOverride(): Float32Array | null {
    const adj = this.activeColorAdjust;
    if (!adj || (adj.saturation === 0 && adj.brightness === 0)) return null;
    return adjustPaletteLinear(this.paletteLinear, adj.saturation, adj.brightness);
  }

  /** Install / refresh the active render bundle (editable grid + optional locked base). */
  setActiveRender(render: ActiveRender): void {
    this.activeColorAdjust = render.colorAdjust;
    if (this.editableView && this.editableView.id === render.editableId) {
      this.editableView.setData(render.editableData);
      this.editableView.setPaletteOverride(this.colorAdjustOverride());
    } else {
      this.editableView?.dispose();
      this.editableView = new ChunkMeshView(render.editableId, render.editableData, this.mesher);
      this.editableView.setXray(this.xray);
      this.scene.add(this.editableView.group);
      this.editableView.setPaletteOverride(this.colorAdjustOverride());
    }
    this.editableView.setCage(render.cage);

    if (render.baseContext) {
      // under a cage the context is the finished object — shown as-is, not dimmed
      const baseId = `${render.editableId}::${render.cage ? 'result' : 'base'}`;
      if (this.baseView && this.baseView.id === baseId) {
        this.baseView.setData(render.baseContext);
        this.baseView.setPaletteOverride(this.colorAdjustOverride());
      } else {
        this.baseView?.dispose();
        this.baseView = new ChunkMeshView(baseId, render.baseContext, this.mesher, { dimmed: !render.cage });
        this.baseView.setXray(this.xray);
        this.scene.add(this.baseView.group);
        this.baseView.setPaletteOverride(this.colorAdjustOverride());
      }
    } else {
      this.baseView?.dispose();
      this.baseView = null;
    }

    this.syncSmooth(render.smooth, render.smoothDimmed, render.detail);

    const d = render.editableData;
    const b = render.baseContext;
    this.gizmos.setObjectSize(
      Math.max(d.sizeX, b?.sizeX ?? 0),
      Math.max(d.sizeY, b?.sizeY ?? 0),
      Math.max(d.sizeZ, b?.sizeZ ?? 0),
      render.detail,
    );
  }

  flush(): void {
    this.editableView?.flush();
  }

  /** Show exactly these smooth surfaces: new ones are created, gone ones dropped, the rest re-meshed. */
  private syncSmooth(layers: SmoothLayer[], dimmed: boolean, detail: number): void {
    const keep = new Set(layers.map((l) => l.key));
    for (const [key, view] of this.smoothViews) {
      if (keep.has(key) && view.dimmed === dimmed) continue;
      view.dispose();
      this.smoothViews.delete(key);
    }
    for (const layer of layers) {
      let view = this.smoothViews.get(layer.key);
      if (!view) {
        view = new SmoothMeshView(layer.key, this.mesher, detail, dimmed);
        this.smoothViews.set(layer.key, view);
        this.scene.add(view.group);
      }
      view.setData(layer.data, layer.strength, detail, this.smoothPalette());
    }
  }

  /** Re-mesh some smooth surfaces after an edit of their voxels. */
  refreshSmooth(layers: SmoothLayer[], detail: number): void {
    for (const layer of layers) this.smoothViews.get(layer.key)?.setData(layer.data, layer.strength, detail, this.smoothPalette());
  }

  /** Swap only the editable grid (extend overlay re-resolve) without touching the base. */
  refreshEditable(data: VoxelData): void {
    this.editableView?.setData(data);
  }

  /** Swap only the locked base-context grid (extend overlay punched new holes). */
  refreshBase(data: VoxelData): void {
    this.baseView?.setData(data);
  }

  private ndc(clientX: number, clientY: number): THREE.Vector2 {
    const rect = this.canvas.getBoundingClientRect();
    return new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
  }

  pick(clientX: number, clientY: number, buildPlane: BuildPlane, buildOffset: number): PickResult | null {
    const d = this.editableView?.data;
    const size = d
      ? { x: d.sizeX, y: d.sizeY, z: d.sizeZ }
      : { x: 16, y: 16, z: 16 };
    const targets: THREE.Object3D[] = [
      ...(this.editableView?.raycastTargets() ?? []),
      ...(this.baseView?.raycastTargets() ?? []),
    ];
    return this.picker.pick(this.ndc(clientX, clientY), this.controls.camera, targets, size, buildPlane, buildOffset);
  }

  /** Cell where the ray crosses the plane at `planeCoord`, axis forced to `cellValue`. */
  pickOnPlane(
    clientX: number,
    clientY: number,
    axis: 0 | 1 | 2,
    planeCoord: number,
    cellValue: number,
  ): THREE.Vector3 | null {
    return this.picker.pickPlane(this.ndc(clientX, clientY), this.controls.camera, axis, planeCoord, cellValue);
  }

  /** Camera position + direction, for voxel visibility tests. */
  viewRay(): ViewRay {
    const cam = this.controls.camera;
    cam.updateMatrixWorld();
    const eye = new THREE.Vector3().setFromMatrixPosition(cam.matrixWorld);
    const dir = cam.getWorldDirection(new THREE.Vector3());
    return { eye: [eye.x, eye.y, eye.z], dir: [dir.x, dir.y, dir.z], ortho: this.controls.mode === 'ortho' };
  }

  /** See-through voxel meshes (select tool X-ray). */
  setXray(on: boolean): void {
    this.xray = on;
    this.editableView?.setXray(on);
    this.baseView?.setXray(on);
  }

  get projection(): ProjectionMode {
    return this.controls.mode;
  }

  setProjection(mode: ProjectionMode): void {
    this.controls.setMode(mode);
  }

  /** Match the editor theme — viewport background + grid colours. */
  setDark(dark: boolean): void {
    this.background.setHex(dark ? 0x181b23 : 0xe4e7ec);
    this.gizmos.setDark(dark);
  }

  setView(view: PresetView): void {
    this.controls.setView(view);
  }

  setCursor(box: CursorBox | null, mirrored: CursorBox[] = []): void {
    this.gizmos.setCursor(box, mirrored);
  }

  /** Highlight the axes of the plane being built on. */
  setBuildPlane(plane: BuildPlane): void {
    this.gizmos.setBuildPlane(plane);
  }

  /** Show the active mirror planes (indexed by the axis each one flips). */
  setMirror(axes: readonly [boolean, boolean, boolean]): void {
    this.gizmos.setMirror(axes);
  }

  setSelectionBox(box: CursorBox | null, cells?: Array<[number, number, number]>): void {
    this.gizmos.setSelection(box, cells);
  }

  frameActive(): void {
    const f = this.activeFraming();
    if (f) this.controls.frame(f.center, Math.max(f.radius, 3));
  }

  /** Centre + rough radius of what's filled in the active object (the grid if it's empty). */
  private activeFraming(): { center: THREE.Vector3; radius: number; bounds: THREE.Box3 } | null {
    const d = this.editableView?.data;
    if (!d) return null;
    const b = d.filledBounds() ?? this.baseView?.data.filledBounds() ?? null;
    // filled bounds are already in world units (max exclusive: a voxel spans [x, x + 1])
    let bounds = b
      ? new THREE.Box3(new THREE.Vector3(b.min.x, b.min.y, b.min.z), new THREE.Vector3(b.max.x, b.max.y, b.max.z))
      : null;
    // smooth surfaces aren't in either grid — a screenshot of an all-smooth object still has to frame them
    for (const v of this.smoothViews.values()) {
      const sb = v.bounds();
      if (sb) bounds = bounds ? bounds.union(sb) : sb;
    }
    bounds ??= new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(d.sizeX, d.sizeY, d.sizeZ));
    const center = bounds.getCenter(new THREE.Vector3());
    const size = bounds.getSize(new THREE.Vector3());
    return { center, radius: Math.max(size.x, size.y, size.z) * 0.5, bounds };
  }

  // ---- screenshot mode ---------------------------------------------------

  /** Hide every editor helper (grid, axes, cursor, selection) and lock mouse navigation. */
  setScreenshotMode(on: boolean): void {
    this.gizmos.group.visible = !on;
    this.controls.enabled = !on;
    if (!on) this.setLightScale(1);
  }

  /** Scale all scene lights (1 = normal). */
  setLightScale(k: number): void {
    for (const { light, base } of this.lights) light.intensity = base * k;
  }

  /**
   * Aim the camera at the active object for a screenshot. `zoom` 1 fits the
   * whole object inside the square crop; 2 is twice as close.
   */
  applyShot(o: { yaw: number; pitch: number; zoom: number; mode: ProjectionMode }): void {
    const f = this.activeFraming();
    if (!f) return;
    this.controls.setMode(o.mode);
    // the bounding sphere of the filled box, so no view direction clips a corner
    const sphere = f.bounds.getBoundingSphere(new THREE.Sphere());
    const halfFov = (this.camera.fov * Math.PI) / 360;
    // the square crop is as tall as the viewport, or as wide on a portrait one
    const cropScale = Math.min(1, this.camera.aspect);
    const fit = (sphere.radius * 1.08) / (Math.tan(halfFov) * cropScale);
    this.controls.setOrbit({
      target: sphere.center,
      distance: Math.max(2, fit / Math.max(0.05, o.zoom)),
      yaw: o.yaw,
      pitch: o.pitch,
    });
  }

  /**
   * Render the square crop of the current view to a PNG, `size` pixels on a
   * side, helpers hidden. Transparent: only the object, no background.
   */
  async renderShot(size: number, transparent: boolean): Promise<Blob | null> {
    const cam = this.shotCamera();
    const target = new THREE.WebGLRenderTarget(size, size, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const helpersVisible = this.gizmos.group.visible;
    const prevBackground = this.scene.background;
    const prevClear = this.renderer.getClearColor(new THREE.Color());
    const prevAlpha = this.renderer.getClearAlpha();
    try {
      this.gizmos.group.visible = false;
      if (transparent) {
        this.scene.background = null;
        this.renderer.setClearColor(0x000000, 0);
      }
      this.renderer.setRenderTarget(target);
      this.renderer.clear();
      this.renderer.render(this.scene, cam);
      const px = new Uint8Array(size * size * 4);
      this.renderer.readRenderTargetPixels(target, 0, 0, size, size, px);

      const out = document.createElement('canvas');
      out.width = out.height = size;
      const g = out.getContext('2d');
      if (!g) return null;
      const img = g.createImageData(size, size);
      // GL rows run bottom-up; edge pixels come out premultiplied — undo both
      for (let y = 0; y < size; y++) {
        const src = (size - 1 - y) * size * 4;
        const dst = y * size * 4;
        for (let x = 0; x < size * 4; x += 4) {
          const a = px[src + x + 3];
          const k = a > 0 && a < 255 ? 255 / a : 1;
          img.data[dst + x] = Math.min(255, px[src + x] * k);
          img.data[dst + x + 1] = Math.min(255, px[src + x + 1] * k);
          img.data[dst + x + 2] = Math.min(255, px[src + x + 2] * k);
          img.data[dst + x + 3] = a;
        }
      }
      g.putImageData(img, 0, 0);
      return await new Promise<Blob | null>((resolve) => out.toBlob(resolve, 'image/png'));
    } finally {
      this.renderer.setRenderTarget(null);
      this.scene.background = prevBackground;
      this.renderer.setClearColor(prevClear, prevAlpha);
      this.gizmos.group.visible = helpersVisible;
      target.dispose();
    }
  }

  /** A square-aspect copy of the live camera that sees exactly the crop frame. */
  private shotCamera(): THREE.Camera {
    const live = this.controls.camera;
    const aspect = this.camera.aspect;
    if (live instanceof THREE.OrthographicCamera) {
      const half = live.top * Math.min(1, aspect);
      const cam = new THREE.OrthographicCamera(-half, half, half, -half, live.near, live.far);
      cam.position.copy(live.position);
      cam.quaternion.copy(live.quaternion);
      cam.updateProjectionMatrix();
      cam.updateMatrixWorld();
      return cam;
    }
    const p = live as THREE.PerspectiveCamera;
    // on a portrait viewport the crop is as wide as the view, so narrow the fov to match
    const halfFov = Math.atan(Math.tan((p.fov * Math.PI) / 360) * Math.min(1, aspect));
    const cam = new THREE.PerspectiveCamera((halfFov * 360) / Math.PI, 1, p.near, p.far);
    cam.position.copy(p.position);
    cam.quaternion.copy(p.quaternion);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    return cam;
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
    this.timer.update();
    this.controls.update(this.timer.getDelta());
    this.renderer.render(this.scene, this.controls.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.editableView?.dispose();
    this.baseView?.dispose();
    for (const v of this.smoothViews.values()) v.dispose();
    this.smoothViews.clear();
    this.gizmos.dispose();
    this.mesher.dispose();
    this.renderer.dispose();
  }
}
