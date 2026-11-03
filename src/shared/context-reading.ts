export interface ContextReadPlan {
  version: 1;
  scopeHash: string;
  sources: { path: string; hash: string; contentHash: string; reason: string }[];
  facts: { id: string; hash: string; label: string }[];
  observations: { label: string; status: 'unknown' | 'withheld'; reason: string }[];
  verified?: { at: string; purpose: string; sources: number; facts: number };
}
