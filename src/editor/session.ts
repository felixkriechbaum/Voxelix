import { shallowRef } from 'vue';
import type { Viewport } from '@/viewport/Viewport';
import type { ToolRunner } from './ToolRunner';

const viewport = shallowRef<Viewport | null>(null);
const runner = shallowRef<ToolRunner | null>(null);

/** Live references to the mounted viewport + tool runner, shared across components. */
export function useSession() {
  return { viewport, runner };
}

export function setSession(v: Viewport | null, r: ToolRunner | null): void {
  viewport.value = v;
  runner.value = r;
}
