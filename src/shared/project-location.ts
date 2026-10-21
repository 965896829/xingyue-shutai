export const projectRecycleDirectory = '.文序回收站';

// Native pickers return absolute paths. The core normalizes paths before calling this.
export function isProjectRecyclePath(directory: string) {
  return directory.split(/[\\/]/).includes(projectRecycleDirectory);
}

export function newProjectLocationError(directory: string): string | null {
  if (!isProjectRecyclePath(directory)) return null;
  return `实际选择的保存位置是「${directory}」，位于客户端回收站内。请点击“选择目录”，改选“.文序回收站”外的文件夹；已经填写的创作内容会保留。`;
}
