import type { CameraState } from '@/viewport/GodotControls';

/** Per-project camera view, remembered in localStorage so a reload keeps it. */
const key = (projectId: string) => `voxelix.cam.${projectId}`;

export function loadCameraState(projectId: string): CameraState | null {
  try {
    const raw = localStorage.getItem(key(projectId));
    if (!raw) return null;
    const s = JSON.parse(raw) as CameraState;
    if (s && Array.isArray(s.target) && Number.isFinite(s.distance) && Number.isFinite(s.yaw)) {
      return s;
    }
  } catch {
    /* corrupt or storage disabled */
  }
  return null;
}

/** A debounced writer bound to one project; call flush() before unload. */
export function makeCameraSaver(projectId: string) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = (s: CameraState) => {
    try {
      localStorage.setItem(key(projectId), JSON.stringify(s));
    } catch {
      /* storage disabled */
    }
  };
  return {
    save(state: CameraState) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => write(state), 300);
    },
    flush(state: CameraState) {
      if (timer) clearTimeout(timer);
      write(state);
    },
  };
}
