import type { ProjectState } from '../shared/types';

export function pendingSource(project: ProjectState, file: string) {
  const chapter = file.match(/^07_.*第(\d+)章/);
  return project.stale.includes(file) || !!chapter && project.chapters[Number(chapter[1])] === 'stale';
}

export function sameStoryText(before: string, after: string) {
  const normalize = (text: string) => text.replace(/\r\n/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).join('\n');
  return normalize(before) === normalize(after);
}
