export type ExpressionMode = 'discussion' | 'draft' | 'planning' | 'title' | 'title_market' | 'prose' | 'revision' | 'review' | 'record';

export interface ExpressionBinding {
  version: string;
  policyVersion: string;
  libraryHash: string;
  promptHash: string;
  mode: ExpressionMode;
  modules: string[];
  ruleIds: string[];
}

export interface ExpressionCatalog {
  version: string;
  ruleCount: number;
  modules: { id: string; title: string; layer: string; count: number }[];
}
