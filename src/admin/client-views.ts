import type { ManagementView } from '../shared/management';

export const localViews: Record<string, ManagementView | 'assistant'> = {
  'local-workspace': 'workspace', 'local-creation': 'creation', workflows: 'tasks',
  memory: 'memory', 'structured-content': 'memory', 'local-cover': 'cover',
  'local-settings': 'project', backups: 'transfer', storage: 'transfer',
  'local-trash': 'trash', 'local-search': 'assistant'
};
