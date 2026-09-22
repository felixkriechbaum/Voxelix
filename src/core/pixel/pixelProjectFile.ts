import { PixelProject } from '@/core/pixel/PixelProject';
import type { PixelProjectJson } from '@/core/pixel/types';

export function serializePixelProject(project: PixelProject): string {
  return JSON.stringify(project.toJSON());
}

export function deserializePixelProject(text: string): PixelProject {
  const json = JSON.parse(text) as PixelProjectJson;
  return PixelProject.fromJSON(json);
}
