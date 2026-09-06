import { Project } from '@/core/project/Project';
import type { ProjectJson } from '@/core/project/types';

export function serializeProject(project: Project): string {
  return JSON.stringify(project.toJSON());
}

export function deserializeProject(text: string): Project {
  const json = JSON.parse(text) as ProjectJson;
  return Project.fromJSON(json);
}
