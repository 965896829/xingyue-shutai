import type { NativeWebSearchState } from './web-search';

/** Verified public directory headings, never manuscript facts or platform popularity claims. */
export interface VolumeCatalogue {
  title: string;
  author: string;
  url: string;
  categories: string[];
  synopsis: string;
  volumes: string[];
  checkedAt: string;
  contentHash: string;
}

export interface VolumeMarketResearch {
  status: 'searching' | 'ready' | 'unavailable' | 'disabled';
  provider: 'native' | 'public' | 'none';
  genre: string;
  tags: string[];
  query: string;
  alternativeQuery?: string;
  startedAt: string;
  checkedAt?: string;
  message: string;
  webSearch?: NativeWebSearchState;
  sources: VolumeCatalogue[];
  reads: { url: string; startedAt: string; finishedAt?: string; elapsedMs?: number;
    status: 'reading' | 'complete' | 'unavailable'; reason?: string }[];
}

export interface VolumeNaming {
  version: 1 | 2;
  /** A new, explicit naming edit may research around a preserved older candidate. */
  authorRevision?: true;
  research?: VolumeMarketResearch;
  /** Frozen outline for an explicit names-only edit. */
  renameOnly?: { content: string; hash: string; memoryHash: string };
}
