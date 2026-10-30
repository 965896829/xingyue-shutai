export interface ChapterNaming {
  version: 1;
  source?: { path: string; hash: string; chapter: number; title: string };
  renameOnly?: { documents: { path: string; content: string; hash: string }[]; memoryHash: string };
}
