import { shallowRef } from 'vue';
import type { PixelRunner } from './PixelRunner';

const runner = shallowRef<PixelRunner | null>(null);

/** Live reference to the mounted pixel tool runner, shared across components. */
export function usePixelSession() {
  return { runner };
}

export function setPixelSession(r: PixelRunner | null): void {
  runner.value = r;
}
